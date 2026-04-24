import type { Graph, TenantId } from '@meridian/types';
import { describe, expect, it } from 'vitest';
import { PlatformOrchestrator } from '../src/orchestrator.js';
import { PlatformRuntime } from '../src/runtime.js';
import { InProcessEventBus } from '../src/stores/event-bus.js';
import {
  MockGateway,
  MockRegistry,
  MockToolHost,
  MockTracer,
  makeSpec,
  textCompletion,
} from './mocks/index.js';

const TENANT = 'tenant-a' as TenantId;

describe('pipeline node', () => {
  it('runs 3 steps in order, passing outputs forward', async () => {
    const registry = new MockRegistry();
    registry.add(makeSpec({ name: 'a' }));
    registry.add(makeSpec({ name: 'b' }));
    registry.add(makeSpec({ name: 'c' }));

    // Each agent echoes its input back with its own name appended.
    const order: string[] = [];
    const gateway = new MockGateway((req, ctx) => {
      const last = req.messages[req.messages.length - 1];
      const text =
        last?.content[0] && 'text' in last.content[0]
          ? (last.content[0] as { text: string }).text
          : '';
      order.push(ctx.agentName);
      return textCompletion(`${text}->${ctx.agentName}`);
    });

    const rt = new PlatformRuntime({
      modelGateway: gateway,
      toolHost: new MockToolHost(),
      registry,
      tracer: new MockTracer(),
      tenant: TENANT,
    });
    const orch = new PlatformOrchestrator({ runtime: rt, eventBus: new InProcessEventBus() });
    const graph: Graph = {
      name: 'pipeline',
      root: {
        kind: 'pipeline',
        steps: [
          { kind: 'agent', agent: { name: 'a' } },
          { kind: 'agent', agent: { name: 'b' } },
          { kind: 'agent', agent: { name: 'c' } },
        ],
      },
    };
    const gr = await orch.run(graph, 'start');
    const res = await gr.wait();
    expect(res.ok).toBe(true);
    expect(order).toEqual(['a', 'b', 'c']);
    expect(String(res.output)).toContain('->a->b->c');
  });
});

describe('parallel node — first', () => {
  it('resolves as soon as one branch completes', async () => {
    const registry = new MockRegistry();
    registry.add(makeSpec({ name: 'fast' }));
    registry.add(makeSpec({ name: 'slow' }));

    const gateway = new MockGateway((_req, ctx) => {
      if (ctx.agentName === 'fast') return textCompletion('fast-done');
      // 'slow' never completes on its own; must be cancelled.
      const signal = (ctx as unknown as { signal?: AbortSignal }).signal;
      return (async function* () {
        await new Promise<void>((resolve, reject) => {
          const t = setTimeout(resolve, 2_000);
          t.unref?.();
          signal?.addEventListener('abort', () => reject(signal.reason ?? new Error('aborted')), {
            once: true,
          });
        });
        yield* textCompletion('slow-done');
      })();
    });

    const rt = new PlatformRuntime({
      modelGateway: gateway,
      toolHost: new MockToolHost(),
      registry,
      tracer: new MockTracer(),
      tenant: TENANT,
    });
    const orch = new PlatformOrchestrator({ runtime: rt, eventBus: new InProcessEventBus() });
    const graph: Graph = {
      name: 'p',
      root: {
        kind: 'parallel',
        join: 'first',
        branches: [
          { kind: 'agent', agent: { name: 'fast' } },
          { kind: 'agent', agent: { name: 'slow' } },
        ],
      },
    };
    const gr = await orch.run(graph, null);
    const started = Date.now();
    const res = await gr.wait();
    expect(Date.now() - started).toBeLessThan(1_500);
    expect(res.ok).toBe(true);
    expect(String(res.output)).toContain('fast-done');
  });
});
