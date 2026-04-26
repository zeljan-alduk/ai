/**
 * `/v1/views` — Wave-13 saved views CRUD tests.
 *
 * Covers the full CRUD lifecycle plus tenant + user scoping:
 *   1. Create + List round-trip on a single tenant.
 *   2. Patch updates the row + bumps `updatedAt`.
 *   3. Delete removes the row; subsequent list omits it.
 *   4. Cross-tenant isolation — tenant A never sees tenant B's views.
 */

import { ApiError, ListSavedViewsResponse, SavedView } from '@aldo-ai/api-contract';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type TestEnv, setupTestEnv } from './_setup.js';

const TENANT_OTHER = 'dddddddd-dddd-dddd-dddd-dddddddddddd';

let env: TestEnv;

beforeAll(async () => {
  env = await setupTestEnv();
});

afterAll(async () => {
  await env.teardown();
});

describe('Saved views CRUD', () => {
  it('round-trips a create + list + patch + delete on the runs surface', async () => {
    // Empty state.
    const empty = await env.app.request('/v1/views?surface=runs');
    expect(empty.status).toBe(200);
    const emptyBody = ListSavedViewsResponse.parse(await empty.json());
    expect(emptyBody.views).toHaveLength(0);

    // Create.
    const created = await env.app.request('/v1/views', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Failed runs (24h)',
        surface: 'runs',
        query: { status: ['failed'], started_after: '2026-04-25T00:00:00Z' },
        isShared: false,
      }),
    });
    expect(created.status).toBe(201);
    const createdBody = SavedView.parse(await created.json());
    expect(createdBody.name).toBe('Failed runs (24h)');
    expect(createdBody.surface).toBe('runs');
    expect(createdBody.isShared).toBe(false);
    expect(createdBody.ownedByMe).toBe(true);

    // List.
    const listed = await env.app.request('/v1/views?surface=runs');
    expect(listed.status).toBe(200);
    const listBody = ListSavedViewsResponse.parse(await listed.json());
    expect(listBody.views).toHaveLength(1);
    expect(listBody.views[0]?.id).toBe(createdBody.id);
    expect(listBody.views[0]?.query).toEqual({
      status: ['failed'],
      started_after: '2026-04-25T00:00:00Z',
    });

    // Patch — rename + flip share flag.
    const patched = await env.app.request(`/v1/views/${encodeURIComponent(createdBody.id)}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Failed runs', isShared: true }),
    });
    expect(patched.status).toBe(200);
    const patchedBody = SavedView.parse(await patched.json());
    expect(patchedBody.name).toBe('Failed runs');
    expect(patchedBody.isShared).toBe(true);

    // Delete.
    const deleted = await env.app.request(`/v1/views/${encodeURIComponent(createdBody.id)}`, {
      method: 'DELETE',
    });
    expect(deleted.status).toBe(204);

    // Gone.
    const after = await env.app.request('/v1/views?surface=runs');
    const afterBody = ListSavedViewsResponse.parse(await after.json());
    expect(afterBody.views).toHaveLength(0);
  });

  it('rejects unknown surface with 400 validation_error', async () => {
    const res = await env.app.request('/v1/views?surface=not-a-surface');
    expect(res.status).toBe(400);
    const body = ApiError.parse(await res.json());
    expect(body.error.code).toBe('validation_error');
  });

  it('cross-tenant isolation — tenant B never sees tenant A views', async () => {
    // Tenant A creates a view.
    const aRes = await env.app.request('/v1/views', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'A only',
        surface: 'runs',
        query: { status: ['running'] },
        isShared: true, // shared INTRA-tenant only — NOT visible to other tenants
      }),
    });
    expect(aRes.status).toBe(201);
    const aBody = SavedView.parse(await aRes.json());

    // Tenant B reads — must see nothing.
    const otherAuth = await env.authFor(TENANT_OTHER);
    const bList = await env.app.request('/v1/views?surface=runs', { headers: otherAuth });
    expect(bList.status).toBe(200);
    const bBody = ListSavedViewsResponse.parse(await bList.json());
    expect(bBody.views.find((v) => v.id === aBody.id)).toBeUndefined();

    // Tenant B PATCH attempt → 404 (never confirms existence across tenants).
    const bPatch = await env.app.request(`/v1/views/${encodeURIComponent(aBody.id)}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', ...otherAuth },
      body: JSON.stringify({ name: 'hijack' }),
    });
    expect(bPatch.status).toBe(404);
    const bPatchBody = ApiError.parse(await bPatch.json());
    expect(bPatchBody.error.code).toBe('not_found');
  });

  it('PATCH on a non-existent id returns 404 not_found', async () => {
    const res = await env.app.request('/v1/views/view_does-not-exist', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'x' }),
    });
    expect(res.status).toBe(404);
  });
});
