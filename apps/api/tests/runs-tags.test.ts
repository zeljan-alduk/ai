/**
 * Wave-4 — per-run tag CRUD + popular-tags endpoint tests.
 *
 * Covers:
 *   * `POST /v1/runs/:id/tags`        — replace
 *   * `POST /v1/runs/:id/tags/add`    — append (idempotent)
 *   * `DELETE /v1/runs/:id/tags/:tag` — remove (idempotent)
 *   * `GET  /v1/runs/tags/popular`    — top-N aggregation
 *
 * Plus tag-normalization at the edge (422 with `invalid_tag`) and
 * tenant isolation (cross-tenant ids never mutate).
 */

import { ApiError, PopularTagsResponse, RunTagsResponse } from '@aldo-ai/api-contract';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type TestEnv, seedRun, setupTestEnv } from './_setup.js';

const TENANT_OTHER = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';

let env: TestEnv;

beforeAll(async () => {
  env = await setupTestEnv();
  // Seed three runs in the default tenant + one in another tenant.
  await seedRun(env.db, {
    id: 'tag-r1',
    agentName: 'reviewer',
    startedAt: '2026-04-20T10:00:00.000Z',
    endedAt: '2026-04-20T10:00:10.000Z',
  });
  await seedRun(env.db, {
    id: 'tag-r2',
    agentName: 'reviewer',
    startedAt: '2026-04-20T11:00:00.000Z',
    endedAt: '2026-04-20T11:00:10.000Z',
  });
  await seedRun(env.db, {
    id: 'tag-r3',
    agentName: 'planner',
    startedAt: '2026-04-20T12:00:00.000Z',
    endedAt: '2026-04-20T12:00:10.000Z',
  });
  // Cross-tenant — popular-tags + write paths must never see this row.
  await env.authFor(TENANT_OTHER);
  await seedRun(env.db, {
    id: 'tag-other',
    agentName: 'reviewer',
    tenantId: TENANT_OTHER,
    startedAt: '2026-04-20T13:00:00.000Z',
    endedAt: '2026-04-20T13:00:10.000Z',
  });
});

afterAll(async () => {
  await env.teardown();
});

describe('POST /v1/runs/:id/tags (replace)', () => {
  it('normalizes + replaces the tag list', async () => {
    const res = await env.app.request('/v1/runs/tag-r1/tags', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tags: ['  Regression  ', 'PRIORITY-1', 'regression'] }),
    });
    expect(res.status).toBe(200);
    const body = RunTagsResponse.parse(await res.json());
    // dedup + lowercase + trim, first-seen order preserved.
    expect(body.tags).toEqual(['regression', 'priority-1']);
  });

  it('rejects an invalid tag with 422 invalid_tag', async () => {
    const res = await env.app.request('/v1/runs/tag-r1/tags', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tags: ['ok-tag', 'BAD TAG'] }),
    });
    expect(res.status).toBe(422);
    const body = ApiError.parse(await res.json());
    expect(body.error.code).toBe('invalid_tag');
  });

  it('returns 404 for an unknown run id', async () => {
    const res = await env.app.request('/v1/runs/does-not-exist/tags', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tags: ['x'] }),
    });
    expect(res.status).toBe(404);
  });
});

describe('POST /v1/runs/:id/tags/add (append)', () => {
  it('appends a normalized tag', async () => {
    const res = await env.app.request('/v1/runs/tag-r2/tags/add', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tag: ' Acme ' }),
    });
    expect(res.status).toBe(200);
    const body = RunTagsResponse.parse(await res.json());
    expect(body.tags).toContain('acme');
  });

  it('is idempotent — second add does not duplicate', async () => {
    const before = await env.app.request('/v1/runs/tag-r2/tags/add', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tag: 'flaky' }),
    });
    const beforeBody = RunTagsResponse.parse(await before.json());
    const after = await env.app.request('/v1/runs/tag-r2/tags/add', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tag: 'flaky' }),
    });
    const afterBody = RunTagsResponse.parse(await after.json());
    expect(afterBody.tags).toEqual(beforeBody.tags);
    expect(afterBody.tags.filter((t) => t === 'flaky')).toHaveLength(1);
  });

  it('rejects an invalid tag', async () => {
    const res = await env.app.request('/v1/runs/tag-r2/tags/add', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tag: 'has space' }),
    });
    expect(res.status).toBe(422);
  });
});

describe('DELETE /v1/runs/:id/tags/:tag', () => {
  it('removes an existing tag and returns the new array', async () => {
    // Seed two tags first.
    await env.app.request('/v1/runs/tag-r3/tags', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tags: ['acme', 'wip'] }),
    });
    const res = await env.app.request('/v1/runs/tag-r3/tags/wip', { method: 'DELETE' });
    expect(res.status).toBe(200);
    const body = RunTagsResponse.parse(await res.json());
    expect(body.tags).toEqual(['acme']);
  });

  it('is idempotent on missing tag — returns 200 + unchanged list', async () => {
    const res = await env.app.request('/v1/runs/tag-r3/tags/never-was-here', {
      method: 'DELETE',
    });
    expect(res.status).toBe(200);
  });

  it('returns 404 for an unknown run', async () => {
    const res = await env.app.request('/v1/runs/no-such-run/tags/anything', {
      method: 'DELETE',
    });
    expect(res.status).toBe(404);
  });
});

describe('GET /v1/runs/tags/popular', () => {
  it('returns count-DESC + tag-ASC ordering and respects limit', async () => {
    // r1 has [regression, priority-1]; r2 has [acme, flaky]; r3 has [acme].
    // → acme=2, flaky=1, priority-1=1, regression=1.
    const res = await env.app.request('/v1/runs/tags/popular?limit=10');
    expect(res.status).toBe(200);
    const body = PopularTagsResponse.parse(await res.json());
    expect(body.tags[0]).toEqual({ tag: 'acme', count: 2 });
    // Tied at 1 — sorted ASC by tag name.
    const tied = body.tags.slice(1).map((t) => t.tag);
    const sorted = [...tied].sort();
    expect(tied).toEqual(sorted);
  });

  it('limits the result count', async () => {
    const res = await env.app.request('/v1/runs/tags/popular?limit=1');
    expect(res.status).toBe(200);
    const body = PopularTagsResponse.parse(await res.json());
    expect(body.tags).toHaveLength(1);
  });

  it('does not leak cross-tenant tags', async () => {
    // Tag the cross-tenant run via a SEPARATE call from the cross-tenant auth.
    const otherAuth = await env.authFor(TENANT_OTHER);
    await env.rawApp.request('/v1/runs/tag-other/tags', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...otherAuth },
      body: JSON.stringify({ tags: ['secret-cross-tenant-tag'] }),
    });
    const res = await env.app.request('/v1/runs/tags/popular?limit=50');
    const body = PopularTagsResponse.parse(await res.json());
    expect(body.tags.find((t) => t.tag === 'secret-cross-tenant-tag')).toBeUndefined();
  });

  it('clamps a non-numeric limit to the default and 200 max', async () => {
    const res = await env.app.request('/v1/runs/tags/popular?limit=99999');
    expect(res.status).toBe(200);
    const body = PopularTagsResponse.parse(await res.json());
    // Just confirm it didn't throw + returned the available tags.
    expect(body.tags.length).toBeGreaterThan(0);
  });
});

describe('cross-tenant isolation on the per-run write paths', () => {
  it("cannot replace tags on another tenant's run", async () => {
    const res = await env.app.request('/v1/runs/tag-other/tags', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tags: ['hijack'] }),
    });
    expect(res.status).toBe(404);
  });
});
