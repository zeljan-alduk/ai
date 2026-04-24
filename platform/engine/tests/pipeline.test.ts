import { describe, expect, it } from 'vitest';
import type { Graph, TenantId } from '@meridian/types';
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
    const gateway = new MockGateway((req) => {
      const last = req.messages[req.messages.length - 1];
      const text =
        last && last.content[0] && 'text' in last.content[0]
          ? (last.content[0] as { text: string }).text
          : '';
      const agent = req.messages[0]?.content[0];
      const sys =
        agent && 'text' in agent ? (agent as { text: string }).text.slice(10, 11) : '?';
      order.push(sys);
      return textCompletion(`${text}->${sys}`);
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

    const gateway = new MockGateway((req) => {
      const sys = req.messages[0]?.content[0];
      const name = sys && 'text' in sys ? (sys as { text: string }).text : '';
      if (name.includes('fast')) return textCompletion('fast-done');
      // 'slow' never completes on its own; must be cancelled.
      return (async function* () {
        await new Promise<void>((resolve, reject) => {
          const signal = (req as unknown as { signal?: AbortSignal }).signal;
          void signal;
          // long wait; relies on cancel from the orchestrator
          const t = setTimeout(resolve, 2_000);
          t.unref?.();
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
