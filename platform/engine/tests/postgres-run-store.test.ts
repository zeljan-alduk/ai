/**
 * PostgresRunStore round-trip — verifies that a 3-step pipeline run
 * lands N rows in `run_events` with the correct types and ordering.
 * Also exercises `recordRunStart` + `recordRunEnd` so the `runs` table
 * carries the full lifecycle.
 *
 * Uses pglite so this runs without Docker.
 */

import { fromDatabaseUrl, migrate } from '@aldo-ai/storage';
import type { Graph, TenantId } from '@aldo-ai/types';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PostgresCheckpointer } from '../src/checkpointer/index.js';
import { PlatformOrchestrator } from '../src/orchestrator.js';
import { PlatformRuntime } from '../src/runtime.js';
import { InProcessEventBus } from '../src/stores/event-bus.js';
import { PostgresRunStore } from '../src/stores/postgres-run-store.js';
import {
  MockGateway,
  MockRegistry,
  MockToolHost,
  MockTracer,
  makeSpec,
  textCompletion,
} from './mocks/index.js';

// Wave-10: every runs/run_events row now carries a NOT NULL tenant_id
// with a FK to tenants(id). The test inserts a fixed tenant row up
// front so the engine's INSERTs satisfy the constraint without
// running the full auth flow.
const TENANT = '00000000-0000-0000-0000-000000000001' as TenantId;

const clientP = (async () => {
  const c = await fromDatabaseUrl({ driver: 'pglite' });
  await migrate(c);
  await c.query(
    `INSERT INTO tenants (id, slug, name) VALUES ($1, $2, $3)
     ON CONFLICT (id) DO NOTHING`,
    [TENANT, 'tenant-a', 'Tenant A'],
  );
  return c;
})();

afterAll(async () => {
  const c = await clientP;
  await c.close();
});

describe('PostgresRunStore', () => {
  it('persists every event from a 3-step pipeline run', async () => {
    const client = await clientP;
    const runStore = new PostgresRunStore({ client });
    const checkpointer = new PostgresCheckpointer({ client });

    const registry = new MockRegistry();
    registry.add(makeSpec({ name: 'a' }));
    registry.add(makeSpec({ name: 'b' }));
    registry.add(makeSpec({ name: 'c' }));

    const gateway = new MockGateway((_req, ctx) => textCompletion(`out-${ctx.agentName}`));

    const rt = new PlatformRuntime({
      modelGateway: gateway,
      toolHost: new MockToolHost(),
      registry,
      tracer: new MockTracer(),
      tenant: TENANT,
      checkpointer,
      runStore,
    });

    const orch = new PlatformOrchestrator({ runtime: rt, eventBus: new InProcessEventBus() });
    const graph: Graph = {
      name: 'pipe-three',
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

    // Every leaf agent run must show up in `runs` with status 'completed'.
    const runRows = await client.query<{ id: string; status: string; agent_name: string }>(
      'SELECT id, status, agent_name FROM runs ORDER BY agent_name ASC',
    );
    const names = runRows.rows.map((r) => r.agent_name).sort();
    expect(names).toEqual(['a', 'b', 'c']);
    expect(runRows.rows.every((r) => r.status === 'completed')).toBe(true);

    // Total events: every leaf emits at minimum
    //   run.started, checkpoint(pre), message(assistant), run.completed
    // → 4 events × 3 agents = 12 events. We assert the lower bound and
    // also check ordering within a single run.
    const total = await client.query<{ count: string | number }>(
      'SELECT count(*)::text AS count FROM run_events',
    );
    expect(Number(total.rows[0]?.count)).toBeGreaterThanOrEqual(12);

    // Per-run ordering: the first event must be `run.started` and the last
    // must be `run.completed` for each agent.
    for (const r of runRows.rows) {
      const events = await runStore.listEvents(r.id as never);
      expect(events.length).toBeGreaterThan(0);
      expect(events[0]?.type).toBe('run.started');
      expect(events[events.length - 1]?.type).toBe('run.completed');
      const types = events.map((e) => e.type);
      expect(types).toContain('checkpoint');
      expect(types).toContain('message');
    }
  });
});
