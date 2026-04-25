/**
 * PostgresCheckpointer round-trip — verifies that a checkpoint written
 * to Postgres deserialises back into a structurally identical record.
 *
 * Uses pglite so this runs without Docker or a live database.
 */

import { fromDatabaseUrl, migrate } from '@aldo-ai/storage';
import type { CheckpointId, Message, RunId } from '@aldo-ai/types';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Checkpoint } from '../src/checkpointer/index.js';
import { PostgresCheckpointer } from '../src/checkpointer/postgres.js';

// Wave-10: checkpoints rows now carry NOT NULL tenant_id with a FK to
// tenants(id). The PostgresCheckpointer resolves the tenant via the
// parent runs row, so the test seeds (a) a tenant and (b) the run rows
// the test references before any save() call.
const TENANT_ID = '00000000-0000-0000-0000-000000000001';
const RUN_A = '00000000-0000-0000-0000-00000000aaaa';
const RUN_B = '00000000-0000-0000-0000-00000000bbbb';

const clientP = (async () => {
  const c = await fromDatabaseUrl({ driver: 'pglite' });
  await migrate(c);
  await c.query(
    `INSERT INTO tenants (id, slug, name) VALUES ($1, $2, $3)
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_ID, 'tenant-cp', 'Tenant CP'],
  );
  // Seed runs rows so the checkpointer's INSERT ... SELECT FROM runs
  // pattern resolves their tenant_id.
  for (const id of [RUN_A, RUN_B]) {
    await c.query(
      `INSERT INTO runs (id, tenant_id, agent_name, agent_version, status)
       VALUES ($1, $2, 'a', '1', 'running')
       ON CONFLICT (id) DO NOTHING`,
      [id, TENANT_ID],
    );
  }
  return c;
})();

afterAll(async () => {
  const c = await clientP;
  await c.close();
});

describe('PostgresCheckpointer', () => {
  it('writes a checkpoint and reads it back with identical fields', async () => {
    const client = await clientP;
    const cp = new PostgresCheckpointer({ client });

    const runId = RUN_A as RunId;
    const messages: Message[] = [
      {
        role: 'user',
        content: [{ type: 'text', text: 'hello' }],
      },
    ];

    const id: CheckpointId = await cp.save({
      runId,
      nodePath: ['root', 'agent'],
      phase: 'pre',
      messages,
      toolResults: { 'call-1': { ok: true, value: 42 } },
      rngSeed: 1234,
      io: { input: 'hello' },
      state: { stepCount: 1 },
      overrides: { capabilityClass: 'reasoning-large', model: 'big-1' },
    });
    expect(id).toBeTruthy();

    const loaded = await cp.load(id);
    expect(loaded).not.toBeNull();
    if (!loaded) throw new Error('checkpoint missing');

    expect(loaded.id).toBe(id);
    expect(loaded.runId).toBe(runId);
    expect(loaded.nodePath).toEqual(['root', 'agent']);
    expect(loaded.phase).toBe('pre');
    expect(loaded.messages).toEqual(messages);
    expect(loaded.toolResults).toEqual({ 'call-1': { ok: true, value: 42 } });
    expect(loaded.rngSeed).toBe(1234);
    expect(loaded.io).toEqual({ input: 'hello' });
    expect(loaded.state).toEqual({ stepCount: 1 });
    expect(loaded.overrides).toEqual({ capabilityClass: 'reasoning-large', model: 'big-1' });
    expect(typeof loaded.at).toBe('string');
    expect(() => new Date(loaded.at)).not.toThrow();
  });

  it('lists every checkpoint for a run, isolated from other runs', async () => {
    const client = await clientP;
    const cp = new PostgresCheckpointer({ client });
    const runId = RUN_B as RunId;

    const baseline: Omit<Checkpoint, 'id' | 'at'> = {
      runId,
      nodePath: ['root'],
      phase: 'pre',
      messages: [],
      toolResults: {},
      rngSeed: 0,
      io: null,
      state: {},
    };

    const ids = [
      await cp.save(baseline),
      await cp.save({ ...baseline, phase: 'post', io: { result: 1 } }),
      await cp.save({ ...baseline, nodePath: ['root', 'child'], phase: 'pre' }),
    ];

    const all = await cp.listByRun(runId);
    expect(all.length).toBe(3);
    // Order is by created_at + id; multiple inserts within the same
    // millisecond can swap places, so assert membership rather than
    // strict positional order.
    expect(new Set(all.map((c) => c.id))).toEqual(new Set(ids));
    expect(all.every((c) => c.runId === runId)).toBe(true);

    // A different run shouldn't share rows.
    const empty = await cp.listByRun('99999999-9999-9999-9999-999999999999' as RunId);
    expect(empty).toHaveLength(0);
  });

  it('returns null for an unknown checkpoint id', async () => {
    const client = await clientP;
    const cp = new PostgresCheckpointer({ client });
    const got = await cp.load('00000000-0000-0000-0000-00000000ffff' as CheckpointId);
    expect(got).toBeNull();
  });
});
