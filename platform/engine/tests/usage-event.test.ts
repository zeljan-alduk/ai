/**
 * Asserts that `LeafAgentRun` re-emits the gateway's terminal
 * `Delta.end.usage` as a typed `usage` `RunEvent`. This unblocks the
 * eval-sweep cost matrix and the debugger timeline; both consume
 * the persisted run_events stream.
 */

import type { AgentRef, RunEvent, TenantId } from '@aldo-ai/types';
import { describe, expect, it } from 'vitest';
import { PlatformRuntime } from '../src/runtime.js';
import { InMemoryRunStore } from '../src/stores/postgres-run-store.js';
import {
  MockGateway,
  MockRegistry,
  MockToolHost,
  MockTracer,
  makeSpec,
  textCompletion,
} from './mocks/index.js';

const TENANT = 'tenant-usage' as TenantId;

describe('LeafAgentRun usage event', () => {
  it('emits a typed usage RunEvent at end of the model turn', async () => {
    const registry = new MockRegistry();
    registry.add(makeSpec({ name: 'echo' }));
    const gateway = new MockGateway(() => textCompletion('hi', 'mock-model-7'));
    const rt = new PlatformRuntime({
      modelGateway: gateway,
      toolHost: new MockToolHost(),
      registry,
      tracer: new MockTracer(),
      tenant: TENANT,
    });

    const ref: AgentRef = { name: 'echo' };
    const run = await rt.spawn(ref, 'go');
    const collected: RunEvent[] = [];
    for await (const ev of run.events()) {
      collected.push(ev);
    }

    const usage = collected.find((e) => e.type === ('usage' as RunEvent['type']));
    expect(usage).toBeDefined();
    expect(typeof usage?.at).toBe('string');
    const payload = usage?.payload as {
      provider: string;
      model: string;
      tokensIn: number;
      tokensOut: number;
      usd: number;
      at: string;
    };
    expect(payload.provider).toBe('mock');
    expect(payload.model).toBe('mock-model-7');
    expect(payload.tokensIn).toBeGreaterThan(0);
    expect(payload.tokensOut).toBeGreaterThan(0);
    expect(payload.usd).toBeGreaterThanOrEqual(0);
    expect(typeof payload.at).toBe('string');
  });

  it('persists the usage event through the RunStore so the API can read it', async () => {
    const registry = new MockRegistry();
    registry.add(makeSpec({ name: 'echo' }));
    const gateway = new MockGateway(() => textCompletion('hi', 'mock-model-store'));
    const runStore = new InMemoryRunStore();
    const rt = new PlatformRuntime({
      modelGateway: gateway,
      toolHost: new MockToolHost(),
      registry,
      tracer: new MockTracer(),
      tenant: TENANT,
      runStore,
    });

    const ref: AgentRef = { name: 'echo' };
    const run = await rt.spawn(ref, 'go');
    for await (const _ev of run.events()) {
      // drain
    }

    const stored = await runStore.listEvents(run.id);
    const types = stored.map((e) => e.type);
    expect(types).toContain('usage');
    const usageRow = stored.find((e) => e.type === 'usage');
    expect(usageRow).toBeDefined();
    const payload = usageRow?.payload as { model: string; provider: string };
    expect(payload.model).toBe('mock-model-store');
    expect(payload.provider).toBe('mock');
  });
});
