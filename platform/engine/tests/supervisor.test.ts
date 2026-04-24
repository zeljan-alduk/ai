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

describe('supervisor node', () => {
  it('spawns 3 workers in parallel and collects their results', async () => {
    const registry = new MockRegistry();
    registry.add(
      makeSpec({ name: 'lead', spawn: { allowed: ['w1', 'w2', 'w3'] } }),
    );
    registry.add(makeSpec({ name: 'w1' }));
    registry.add(makeSpec({ name: 'w2' }));
    registry.add(makeSpec({ name: 'w3' }));

    let inflight = 0;
    let peak = 0;
    const gateway = new MockGateway(async function* (req) {
      inflight++;
      peak = Math.max(peak, inflight);
      // Tiny delay so we can observe parallelism.
      await new Promise((r) => setTimeout(r, 15));
      inflight--;
      const sys = req.messages[0]?.content[0];
      const name = sys && 'text' in sys ? (sys as { text: string }).text : '';
      // Return a tag that identifies the worker.
      const tag = name.includes('w1') ? 'r1' : name.includes('w2') ? 'r2' : name.includes('w3') ? 'r3' : 'lead';
      yield* textCompletion(tag);
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
      name: 'sup',
      root: {
        kind: 'supervisor',
        lead: { name: 'lead' },
        workers: [{ name: 'w1' }, { name: 'w2' }, { name: 'w3' }],
      },
    };
    const gr = await orch.run(graph, ['a', 'b', 'c']);
    const res = await gr.wait();
    expect(res.ok).toBe(true);
    expect(res.output).toEqual(['r1', 'r2', 'r3']);
    // The three workers ran concurrently at some point.
    expect(peak).toBeGreaterThanOrEqual(2);
  });
});
