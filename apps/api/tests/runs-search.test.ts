/**
 * `/v1/runs/search` — Wave-13 trace search tests.
 *
 * Covers the full filter matrix: free-text q, status[], cost range,
 * has_children, cursor pagination, agent name match, fuzzy substring,
 * and tenant isolation.
 *
 * LLM-agnostic: provider / model strings are opaque; the assertions
 * never branch on a specific provider name.
 */

import { ApiError, RunSearchResponse } from '@aldo-ai/api-contract';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type TestEnv, seedRun, setupTestEnv } from './_setup.js';

const TENANT_OTHER = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

let env: TestEnv;

beforeAll(async () => {
  env = await setupTestEnv();
  // Seed a comprehensive corpus.
  // 5 reviewer runs of various statuses + costs.
  for (let i = 0; i < 5; i++) {
    const startedAt = new Date(Date.UTC(2026, 3, 20 + i, 10, 0, 0)).toISOString();
    const endedAt = new Date(Date.UTC(2026, 3, 20 + i, 10, 0, (i + 1) * 10)).toISOString();
    await seedRun(env.db, {
      id: `rev-${i}`,
      agentName: 'reviewer',
      startedAt,
      endedAt,
      status: i === 4 ? 'failed' : 'completed',
      usage: [
        {
          provider: 'opaque-cloud',
          model: 'opaque-large',
          tokensIn: 100,
          tokensOut: 50,
          usd: 0.01 * (i + 1),
          at: endedAt,
        },
      ],
    });
  }
  // 3 planner runs — one running, two completed; one is composite.
  for (let i = 0; i < 3; i++) {
    const startedAt = new Date(Date.UTC(2026, 3, 22, 11, i * 10, 0)).toISOString();
    await seedRun(env.db, {
      id: `plan-${i}`,
      agentName: 'planner',
      startedAt,
      status: i === 0 ? 'running' : 'completed',
      // No usage for the running row — duration NULL.
      ...(i === 0
        ? {}
        : {
            endedAt: new Date(new Date(startedAt).getTime() + 5_000 * (i + 1)).toISOString(),
          }),
    });
  }
  // A composite parent + child to exercise has_children.
  await seedRun(env.db, {
    id: 'composite-root',
    agentName: 'principal',
    startedAt: '2026-04-23T09:00:00.000Z',
    endedAt: '2026-04-23T09:00:30.000Z',
    status: 'completed',
  });
  await seedRun(env.db, {
    id: 'composite-child',
    agentName: 'sub',
    parentRunId: 'composite-root',
    startedAt: '2026-04-23T09:00:05.000Z',
    endedAt: '2026-04-23T09:00:25.000Z',
    status: 'completed',
  });
  // A run with an event payload that contains a substring we'll search for.
  await seedRun(env.db, {
    id: 'fuzzy-1',
    agentName: 'fuzzy-agent',
    startedAt: '2026-04-24T08:00:00.000Z',
    endedAt: '2026-04-24T08:00:20.000Z',
    status: 'completed',
    events: [
      {
        id: 'fuzzy-evt-1',
        type: 'tool_call',
        payload: { tool: 'search', args: { query: 'magic-needle-token' } },
        at: '2026-04-24T08:00:05.000Z',
      },
    ],
  });
  // Cross-tenant — should never appear in seed-tenant searches.
  const otherAuth = await env.authFor(TENANT_OTHER);
  await seedRun(env.db, {
    id: 'other-tenant-run',
    agentName: 'reviewer',
    tenantId: TENANT_OTHER,
    startedAt: '2026-04-25T10:00:00.000Z',
    endedAt: '2026-04-25T10:00:10.000Z',
    status: 'completed',
  });
  void otherAuth; // synthesised tenant row is the side-effect we wanted.
});

afterAll(async () => {
  await env.teardown();
});

describe('GET /v1/runs/search', () => {
  it('returns empty result + total=0 for a no-match free-text query', async () => {
    const res = await env.app.request('/v1/runs/search?q=this-string-matches-nothing');
    expect(res.status).toBe(200);
    const body = RunSearchResponse.parse(await res.json());
    expect(body.runs).toHaveLength(0);
    expect(body.total).toBe(0);
    expect(body.nextCursor).toBeNull();
  });

  it('exact agent match — agent=reviewer returns the 5 reviewer rows', async () => {
    const res = await env.app.request('/v1/runs/search?agent=reviewer');
    expect(res.status).toBe(200);
    const body = RunSearchResponse.parse(await res.json());
    expect(body.runs.every((r) => r.agentName === 'reviewer')).toBe(true);
    expect(body.runs.length).toBe(5);
    expect(body.total).toBe(5);
  });

  it('fuzzy substring match — q=magic-needle finds the event-payload run', async () => {
    const res = await env.app.request('/v1/runs/search?q=magic-needle');
    expect(res.status).toBe(200);
    const body = RunSearchResponse.parse(await res.json());
    expect(body.runs.map((r) => r.id)).toContain('fuzzy-1');
  });

  it('status filter — status=failed returns just rev-4', async () => {
    const res = await env.app.request('/v1/runs/search?status=failed');
    expect(res.status).toBe(200);
    const body = RunSearchResponse.parse(await res.json());
    expect(body.runs.every((r) => r.status === 'failed')).toBe(true);
    expect(body.runs.map((r) => r.id)).toContain('rev-4');
    expect(body.total).toBe(body.runs.length);
  });

  it('cost-range filter — cost_gte=0.04 keeps only rev-3 and rev-4', async () => {
    const res = await env.app.request('/v1/runs/search?cost_gte=0.04&agent=reviewer');
    expect(res.status).toBe(200);
    const body = RunSearchResponse.parse(await res.json());
    const ids = body.runs.map((r) => r.id).sort();
    expect(ids).toEqual(['rev-3', 'rev-4']);
    expect(body.total).toBe(2);
  });

  it('has_children=true returns the composite parent only', async () => {
    const res = await env.app.request('/v1/runs/search?has_children=true');
    expect(res.status).toBe(200);
    const body = RunSearchResponse.parse(await res.json());
    expect(body.runs.map((r) => r.id)).toContain('composite-root');
    expect(body.runs.map((r) => r.id)).not.toContain('composite-child');
  });

  it('cross-tenant isolation — seed tenant never sees other-tenant-run', async () => {
    // Search broadly enough that an unscoped query would surface it.
    const res = await env.app.request('/v1/runs/search?agent=reviewer&limit=100');
    expect(res.status).toBe(200);
    const body = RunSearchResponse.parse(await res.json());
    expect(body.runs.map((r) => r.id)).not.toContain('other-tenant-run');
    // Other tenant sees ONLY their row.
    const otherAuth = await env.authFor(TENANT_OTHER);
    const res2 = await env.app.request('/v1/runs/search?agent=reviewer&limit=100', {
      headers: otherAuth,
    });
    expect(res2.status).toBe(200);
    const body2 = RunSearchResponse.parse(await res2.json());
    expect(body2.runs.map((r) => r.id)).toEqual(['other-tenant-run']);
    expect(body2.total).toBe(1);
  });

  it('cursor pagination — limit=2 walks the reviewer corpus across pages', async () => {
    const r1 = await env.app.request('/v1/runs/search?agent=reviewer&limit=2');
    expect(r1.status).toBe(200);
    const p1 = RunSearchResponse.parse(await r1.json());
    expect(p1.runs).toHaveLength(2);
    expect(p1.nextCursor).not.toBeNull();
    expect(p1.total).toBe(5);

    const r2 = await env.app.request(
      `/v1/runs/search?agent=reviewer&limit=2&cursor=${encodeURIComponent(p1.nextCursor ?? '')}`,
    );
    expect(r2.status).toBe(200);
    const p2 = RunSearchResponse.parse(await r2.json());
    expect(p2.runs).toHaveLength(2);
    // No overlap with page 1.
    const ids1 = new Set(p1.runs.map((r) => r.id));
    expect(p2.runs.every((r) => !ids1.has(r.id))).toBe(true);
    expect(p2.total).toBe(5);
  });

  it('rejects an invalid cursor with 400 validation_error', async () => {
    const res = await env.app.request('/v1/runs/search?cursor=not-base64');
    expect(res.status).toBe(400);
    const body = ApiError.parse(await res.json());
    expect(body.error.code).toBe('validation_error');
  });
});
