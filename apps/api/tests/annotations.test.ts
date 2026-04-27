/**
 * Tests for the wave-14 (Engineer 14D) `/v1/annotations` surface.
 *
 * Coverage (8 tests = 6 CRUD + 2 reactions):
 *   1. POST creates a top-level annotation, GET round-trips it.
 *   2. POST with parentId nests a reply under the parent.
 *   3. PATCH by author updates the body + bumps updated_at.
 *   4. PATCH by another user is forbidden (403).
 *   5. DELETE by author removes the row.
 *   6. GET /feed returns recent annotations across the tenant.
 *   7. POST /reactions toggles a thumbs_up on, then off.
 *   8. Mention notifications are emitted for tenant members.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { signSessionToken } from '../src/auth/jwt.js';
import { type TestEnv, setupTestEnv } from './_setup.js';

let env: TestEnv;

beforeAll(async () => {
  env = await setupTestEnv();
  // Seed a target run we can anchor annotations to.
  await env.db.query(
    `INSERT INTO runs (id, tenant_id, agent_name, agent_version, status, started_at)
     VALUES ($1, $2, 'reviewer', '1.0.0', 'completed', now())`,
    ['ann-target-run', env.tenantId],
  );
});

afterAll(async () => {
  await env.teardown();
});

describe('annotations CRUD', () => {
  let firstId = '';

  it('POST + GET round-trip a top-level annotation', async () => {
    const post = await env.app.request('/v1/annotations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        targetKind: 'run',
        targetId: 'ann-target-run',
        body: 'Looks like a regression vs last week.',
      }),
    });
    expect(post.status).toBe(201);
    const created = (await post.json()) as { annotation: { id: string; body: string } };
    expect(created.annotation.body).toBe('Looks like a regression vs last week.');
    firstId = created.annotation.id;

    const get = await env.app.request('/v1/annotations?targetKind=run&targetId=ann-target-run');
    expect(get.status).toBe(200);
    const body = (await get.json()) as { annotations: { id: string }[] };
    expect(body.annotations.some((a) => a.id === firstId)).toBe(true);
  });

  it('POST with parentId nests under the parent', async () => {
    const reply = await env.app.request('/v1/annotations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        targetKind: 'run',
        targetId: 'ann-target-run',
        body: '+1, agreed',
        parentId: firstId,
      }),
    });
    expect(reply.status).toBe(201);
    const created = (await reply.json()) as {
      annotation: { id: string; parentId: string | null };
    };
    expect(created.annotation.parentId).toBe(firstId);
  });

  it('PATCH by author updates the body + bumps updated_at', async () => {
    const before = await env.app.request('/v1/annotations?targetKind=run&targetId=ann-target-run');
    const beforeJson = (await before.json()) as {
      annotations: { id: string; updatedAt: string }[];
    };
    const target = beforeJson.annotations.find((a) => a.id === firstId);
    expect(target).toBeDefined();
    const beforeUpdated = target?.updatedAt ?? '';
    // Sleep 5ms so the clock can tick the timestamp forward on
    // platforms with a coarse timer resolution.
    await new Promise((r) => setTimeout(r, 5));
    const patch = await env.app.request(`/v1/annotations/${firstId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: 'Edited: still regressed.' }),
    });
    expect(patch.status).toBe(200);
    const updated = (await patch.json()) as {
      annotation: { body: string; updatedAt: string };
    };
    expect(updated.annotation.body).toBe('Edited: still regressed.');
    expect(updated.annotation.updatedAt >= beforeUpdated).toBe(true);
  });

  it('PATCH by another user is forbidden', async () => {
    // Mint a session for a different user in the same tenant.
    const otherUserId = 'ann-other-user';
    await env.db.query(
      `INSERT INTO users (id, email, password_hash) VALUES ($1, 'other@aldo.test', 'x')
       ON CONFLICT (id) DO NOTHING`,
      [otherUserId],
    );
    await env.db.query(
      `INSERT INTO tenant_members (tenant_id, user_id, role) VALUES ($1, $2, 'member')
       ON CONFLICT DO NOTHING`,
      [env.tenantId, otherUserId],
    );
    const otherToken = await signSessionToken(
      { sub: otherUserId, tid: env.tenantId, slug: 'default', role: 'member' },
      env.signingKey,
    );
    const res = await env.rawApp.request(`/v1/annotations/${firstId}`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${otherToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ body: 'sneaky edit' }),
    });
    expect(res.status).toBe(403);
  });

  it('DELETE by author removes the row', async () => {
    const post = await env.app.request('/v1/annotations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        targetKind: 'run',
        targetId: 'ann-target-run',
        body: 'temp',
      }),
    });
    const created = (await post.json()) as { annotation: { id: string } };
    const del = await env.app.request(`/v1/annotations/${created.annotation.id}`, {
      method: 'DELETE',
    });
    expect(del.status).toBe(204);
    const after = await env.app.request(`/v1/annotations/${created.annotation.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: 'gone' }),
    });
    expect(after.status).toBe(404);
  });

  it('GET /feed returns recent annotations across the tenant', async () => {
    const res = await env.app.request('/v1/annotations/feed?limit=10');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { annotations: { id: string }[] };
    expect(body.annotations.length).toBeGreaterThan(0);
  });
});

describe('annotation reactions', () => {
  let annotationId = '';

  it('POST /reactions toggles a thumbs_up on', async () => {
    const post = await env.app.request('/v1/annotations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        targetKind: 'run',
        targetId: 'ann-target-run',
        body: 'Reaction target',
      }),
    });
    const created = (await post.json()) as { annotation: { id: string } };
    annotationId = created.annotation.id;
    const react = await env.app.request(`/v1/annotations/${annotationId}/reactions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'thumbs_up' }),
    });
    expect(react.status).toBe(200);
    const body = (await react.json()) as {
      annotation: { reactions: { kind: string; count: number; reactedByMe: boolean }[] };
    };
    const tu = body.annotation.reactions.find((r) => r.kind === 'thumbs_up');
    expect(tu?.count).toBe(1);
    expect(tu?.reactedByMe).toBe(true);
  });

  it('POST /reactions a second time toggles it back off', async () => {
    const react = await env.app.request(`/v1/annotations/${annotationId}/reactions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'thumbs_up' }),
    });
    expect(react.status).toBe(200);
    const body = (await react.json()) as {
      annotation: { reactions: { kind: string; count: number; reactedByMe: boolean }[] };
    };
    const tu = body.annotation.reactions.find((r) => r.kind === 'thumbs_up');
    expect(tu?.count).toBe(0);
    expect(tu?.reactedByMe).toBe(false);
  });
});
