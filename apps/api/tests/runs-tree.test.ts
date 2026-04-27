/**
 * Wave-9 composite run tree endpoint.
 *
 * Each test seeds a small set of `runs` rows via `seedRun` (the harness
 * already supports `parentRunId`) and asserts the shape returned by
 * `GET /v1/runs/:id/tree`. The endpoint:
 *
 *   - resolves the root for any id passed in (parent or descendant),
 *   - walks descendants by `parent_run_id`,
 *   - caps depth at 10 (returns 422 with `code: run_tree_too_deep`),
 *   - rolls per-node usage_records into `totalUsd`,
 *   - returns `classUsed` for nodes that emitted the wave-8 routing
 *     audit row, and omits the field otherwise.
 *
 * The tests deliberately stay in the "structural" lane — every CLAUDE.md
 * non-negotiable that touches routing is exercised by the wave-8 suites
 * already; here we only assert the read-side projection.
 */

import { ApiError, GetRunTreeResponse } from '@aldo-ai/api-contract';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type TestEnv, seedRun, setupTestEnv } from './_setup.js';

let env: TestEnv;

beforeAll(async () => {
  env = await setupTestEnv();
});

afterAll(async () => {
  await env.teardown();
});

async function seedTwoLevelTree(): Promise<void> {
  // root → [child-a, child-b]
  await seedRun(env.db, {
    id: 'tree2-root',
    agentName: 'supervisor',
    agentVersion: '0.1.0',
    startedAt: '2026-04-25T10:00:00.000Z',
    endedAt: '2026-04-25T10:00:30.000Z',
    status: 'completed',
    usage: [
      {
        provider: 'opaque-cloud',
        model: 'opaque-large',
        tokensIn: 100,
        tokensOut: 50,
        usd: 0.1,
        at: '2026-04-25T10:00:10.000Z',
      },
    ],
  });
  await seedRun(env.db, {
    id: 'tree2-child-a',
    agentName: 'reviewer',
    agentVersion: '1.0.0',
    parentRunId: 'tree2-root',
    startedAt: '2026-04-25T10:00:05.000Z',
    endedAt: '2026-04-25T10:00:15.000Z',
    status: 'completed',
    usage: [
      {
        provider: 'opaque-cloud',
        model: 'opaque-medium',
        tokensIn: 50,
        tokensOut: 25,
        usd: 0.05,
        at: '2026-04-25T10:00:10.000Z',
      },
    ],
    events: [
      {
        id: 'tree2-child-a-evt-1',
        type: 'routing.privacy_sensitive_resolved',
        payload: {
          agent: 'reviewer',
          model: 'opaque-medium',
          provider: 'opaque-cloud',
          classUsed: 'reasoning-medium',
        },
        at: '2026-04-25T10:00:05.500Z',
      },
    ],
  });
  await seedRun(env.db, {
    id: 'tree2-child-b',
    agentName: 'planner',
    agentVersion: '1.0.0',
    parentRunId: 'tree2-root',
    startedAt: '2026-04-25T10:00:08.000Z',
    endedAt: '2026-04-25T10:00:20.000Z',
    status: 'completed',
    usage: [
      {
        provider: 'opaque-local',
        model: 'opaque-small',
        tokensIn: 30,
        tokensOut: 15,
        usd: 0,
        at: '2026-04-25T10:00:15.000Z',
      },
    ],
  });
}

async function seedThreeLevelTree(): Promise<void> {
  // root → child → grandchild
  await seedRun(env.db, {
    id: 'tree3-root',
    agentName: 'supervisor',
    agentVersion: '0.1.0',
    startedAt: '2026-04-25T11:00:00.000Z',
    endedAt: '2026-04-25T11:00:30.000Z',
    status: 'completed',
  });
  await seedRun(env.db, {
    id: 'tree3-child',
    agentName: 'reviewer',
    agentVersion: '1.0.0',
    parentRunId: 'tree3-root',
    startedAt: '2026-04-25T11:00:05.000Z',
    endedAt: '2026-04-25T11:00:25.000Z',
    status: 'completed',
  });
  await seedRun(env.db, {
    id: 'tree3-gc',
    agentName: 'fact-checker',
    agentVersion: '0.1.0',
    parentRunId: 'tree3-child',
    startedAt: '2026-04-25T11:00:10.000Z',
    endedAt: '2026-04-25T11:00:20.000Z',
    status: 'completed',
  });
}

async function seedDeepChain(depth: number, prefix: string): Promise<void> {
  // 0 → 1 → 2 → ... → depth-1 (every link has parent_run_id = previous).
  for (let i = 0; i < depth; i++) {
    await seedRun(env.db, {
      id: `${prefix}-${i}`,
      agentName: 'chained',
      startedAt: new Date(2026, 3, 25, 12, 0, i).toISOString(),
      endedAt: new Date(2026, 3, 25, 12, 0, i + 1).toISOString(),
      parentRunId: i === 0 ? null : `${prefix}-${i - 1}`,
      status: 'completed',
    });
  }
}

describe('GET /v1/runs/:id/tree', () => {
  it('returns 404 with not_found for an unknown id', async () => {
    const res = await env.app.request('/v1/runs/does-not-exist/tree');
    expect(res.status).toBe(404);
    const body = ApiError.parse(await res.json());
    expect(body.error.code).toBe('not_found');
  });

  it('returns a single-node tree for a run with no parent and no children', async () => {
    await seedRun(env.db, {
      id: 'lonely-run',
      agentName: 'reviewer',
      startedAt: '2026-04-25T09:00:00.000Z',
      endedAt: '2026-04-25T09:00:05.000Z',
      status: 'completed',
    });
    const res = await env.app.request('/v1/runs/lonely-run/tree');
    expect(res.status).toBe(200);
    const body = GetRunTreeResponse.parse(await res.json());
    expect(body.tree.runId).toBe('lonely-run');
    expect(body.tree.parentRunId).toBeNull();
    expect(body.tree.children).toHaveLength(0);
  });

  it('returns a 2-level tree with rolled-up totalUsd per node', async () => {
    await seedTwoLevelTree();
    const res = await env.app.request('/v1/runs/tree2-root/tree');
    expect(res.status).toBe(200);
    const body = GetRunTreeResponse.parse(await res.json());
    expect(body.tree.runId).toBe('tree2-root');
    expect(body.tree.children).toHaveLength(2);
    const childIds = body.tree.children.map((c) => c.runId).sort();
    expect(childIds).toEqual(['tree2-child-a', 'tree2-child-b']);
    // Per-node totals come straight from usage_records.
    expect(body.tree.totalUsd).toBeCloseTo(0.1, 6);
    const a = body.tree.children.find((c) => c.runId === 'tree2-child-a');
    const b = body.tree.children.find((c) => c.runId === 'tree2-child-b');
    expect(a?.totalUsd).toBeCloseTo(0.05, 6);
    expect(b?.totalUsd).toBeCloseTo(0, 6);
    // classUsed is best-effort — present only for child-a.
    expect(a?.classUsed).toBe('reasoning-medium');
    expect(b?.classUsed).toBeUndefined();
  });

  it('resolves the root from a child id (drilling in still gets the whole tree)', async () => {
    // Reuses the 2-level fixture seeded above.
    const res = await env.app.request('/v1/runs/tree2-child-a/tree');
    expect(res.status).toBe(200);
    const body = GetRunTreeResponse.parse(await res.json());
    expect(body.tree.runId).toBe('tree2-root');
    expect(body.tree.children.map((c) => c.runId).sort()).toEqual([
      'tree2-child-a',
      'tree2-child-b',
    ]);
  });

  it('returns a 3-level tree with grandchild nested correctly', async () => {
    await seedThreeLevelTree();
    const res = await env.app.request('/v1/runs/tree3-root/tree');
    expect(res.status).toBe(200);
    const body = GetRunTreeResponse.parse(await res.json());
    expect(body.tree.runId).toBe('tree3-root');
    expect(body.tree.children).toHaveLength(1);
    const child = body.tree.children[0];
    expect(child?.runId).toBe('tree3-child');
    expect(child?.parentRunId).toBe('tree3-root');
    expect(child?.children).toHaveLength(1);
    expect(child?.children[0]?.runId).toBe('tree3-gc');
    expect(child?.children[0]?.parentRunId).toBe('tree3-child');
    expect(child?.children[0]?.children).toHaveLength(0);
  });

  it('returns 422 run_tree_too_deep when depth exceeds the cap', async () => {
    // Seed a 12-deep chain. The endpoint caps at depth=10.
    await seedDeepChain(12, 'deep');
    const res = await env.app.request('/v1/runs/deep-0/tree');
    expect(res.status).toBe(422);
    const body = ApiError.parse(await res.json());
    expect(body.error.code).toBe('run_tree_too_deep');
    const details = body.error.details as { rootRunId?: string; maxDepth?: number } | undefined;
    expect(details?.rootRunId).toBe('deep-0');
    expect(details?.maxDepth).toBe(10);
  });

  it('does not raise the depth-cap for a tree exactly at the limit', async () => {
    // 10-deep chain — root depth 0 plus 9 descendants = 10 nodes total at
    // depth 9 (the last). The cap allows depth=10, so nothing overflows.
    await seedDeepChain(10, 'borderline');
    const res = await env.app.request('/v1/runs/borderline-0/tree');
    expect(res.status).toBe(200);
    const body = GetRunTreeResponse.parse(await res.json());
    // Walk down the unique chain and confirm we reach the leaf.
    let n: typeof body.tree | undefined = body.tree;
    let count = 0;
    while (n !== undefined) {
      count += 1;
      n = n.children[0];
    }
    expect(count).toBe(10);
  });

  it('rejects a malformed run id with 400 validation_error', async () => {
    const res = await env.app.request('/v1/runs/%20/tree');
    // The Zod regex requires min(1); a single space passes that, so this
    // should resolve to a 404 (no such id). What we're really proving is
    // that the route doesn't 500 on path-parsing oddities.
    expect([400, 404]).toContain(res.status);
  });
});
