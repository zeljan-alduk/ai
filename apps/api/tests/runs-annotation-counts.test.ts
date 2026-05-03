/**
 * Wave-19 — annotation aggregate counts on the runs list.
 *
 * Validates that GET /v1/runs hydrates `annotationCounts` per row from
 * the (annotations, annotation_reactions) tables. Suppressed when zero.
 */

import { ListRunsResponse } from '@aldo-ai/api-contract';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type TestEnv, seedRun, setupTestEnv } from './_setup.js';

let env: TestEnv;

beforeAll(async () => {
  env = await setupTestEnv();
});

afterAll(async () => {
  await env.teardown();
});

const BASE = new Date('2026-05-02T10:00:00.000Z').getTime();

async function postAnnotation(runId: string, body: string): Promise<{ id: string }> {
  const res = await env.app.request('/v1/annotations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ targetKind: 'run', targetId: runId, body }),
  });
  expect(res.status).toBe(201);
  const j = (await res.json()) as { annotation: { id: string } };
  return { id: j.annotation.id };
}

async function react(annotationId: string, kind: string): Promise<void> {
  const res = await env.app.request(
    `/v1/annotations/${encodeURIComponent(annotationId)}/reactions`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind }),
    },
  );
  expect(res.status).toBe(200);
}

describe('GET /v1/runs annotationCounts hydration', () => {
  it('omits annotationCounts when a run has no annotations', async () => {
    await seedRun(env.db, {
      id: 'no-annot-run',
      agentName: 'reviewer',
      startedAt: new Date(BASE).toISOString(),
      endedAt: new Date(BASE + 1000).toISOString(),
    });
    const res = await env.app.request('/v1/runs');
    const body = ListRunsResponse.parse(await res.json());
    const row = body.runs.find((r) => r.id === 'no-annot-run');
    expect(row).toBeDefined();
    // Suppression: zero counts should not surface a key on the wire.
    expect(row?.annotationCounts).toBeUndefined();
  });

  it('emits aggregate counts when annotations + reactions exist', async () => {
    await seedRun(env.db, {
      id: 'has-annot-run',
      agentName: 'reviewer',
      startedAt: new Date(BASE + 60_000).toISOString(),
      endedAt: new Date(BASE + 61_000).toISOString(),
    });
    // 2 comments, 1 thumbs_up, 1 thumbs_down.
    const a1 = await postAnnotation('has-annot-run', 'looks great');
    const a2 = await postAnnotation('has-annot-run', 'one nit');
    await react(a1.id, 'thumbs_up');
    await react(a2.id, 'thumbs_down');

    const res = await env.app.request('/v1/runs');
    const body = ListRunsResponse.parse(await res.json());
    const row = body.runs.find((r) => r.id === 'has-annot-run');
    expect(row?.annotationCounts).toEqual({
      thumbsUp: 1,
      thumbsDown: 1,
      comments: 2,
    });
  });

  it('counts are tenant-scoped — reactions in tenant B do not leak', async () => {
    const tenantB = '00000000-0000-0000-0000-000000000ccc';
    const headerB = await env.authFor(tenantB);
    await seedRun(env.db, {
      id: 'cross-tenant-run',
      tenantId: tenantB,
      agentName: 'reviewer',
      startedAt: new Date(BASE + 120_000).toISOString(),
      endedAt: new Date(BASE + 121_000).toISOString(),
    });
    const create = await env.app.request('/v1/annotations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headerB },
      body: JSON.stringify({
        targetKind: 'run',
        targetId: 'cross-tenant-run',
        body: 'tenant-B comment',
      }),
    });
    expect(create.status).toBe(201);
    // Tenant-A list should not see the run at all (it's in tenant B).
    const res = await env.app.request('/v1/runs');
    const body = ListRunsResponse.parse(await res.json());
    expect(body.runs.find((r) => r.id === 'cross-tenant-run')).toBeUndefined();
    // Tenant-B list sees it WITH the comment count.
    const resB = await env.app.request('/v1/runs', { headers: headerB });
    const bodyB = ListRunsResponse.parse(await resB.json());
    const row = bodyB.runs.find((r) => r.id === 'cross-tenant-run');
    expect(row?.annotationCounts?.comments).toBe(1);
  });
});
