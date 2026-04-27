/**
 * Wave-13 — notifications + activity feed + SSE tests.
 *
 * Coverage matrix:
 *   - notifications CRUD: list / mark-read / mark-all-read / kind filter / unread-count (5 tests)
 *   - SSE streaming: notifications channel, run-events channel, invalid stream selector (3 tests)
 *   - activity events: insert + list / cursor pagination / actor + verb filter / cross-tenant isolation (4 tests)
 *
 * The SSE tests open the stream, write a row, drain a couple of events,
 * then abort the connection. We deliberately read with a short timeout
 * so the test suite never hangs on a stuck poll.
 */

import { ListActivityResponse, ListNotificationsResponse } from '@aldo-ai/api-contract';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  emitActivity,
  emitNotification,
  listActivity,
  listNotifications,
} from '../src/notifications.js';
import { type TestEnv, setupTestEnv } from './_setup.js';

let env: TestEnv;

beforeAll(async () => {
  env = await setupTestEnv();
});

afterAll(async () => {
  await env.teardown();
});

const userId = 'test-user-seed';

async function freshTenant(): Promise<{
  tenantId: string;
  userId: string;
  auth: { Authorization: string };
}> {
  // Each test gets its own tenant id so we don't leak rows across cases.
  const tenantId = `00000000-0000-0000-0000-${Math.floor(Math.random() * 1e12)
    .toString()
    .padStart(12, '0')}`;
  const auth = await env.authFor(tenantId);
  // Pull the userId out of the seeded membership row.
  const res = await env.db.query<{ user_id: string }>(
    'SELECT user_id FROM tenant_members WHERE tenant_id = $1 ORDER BY user_id LIMIT 1',
    [tenantId],
  );
  const uid = res.rows[0]?.user_id ?? userId;
  return { tenantId, userId: uid, auth };
}

describe('notifications', () => {
  it('list + unread-count after emit', async () => {
    const { tenantId, userId, auth } = await freshTenant();
    await emitNotification(env.db, {
      tenantId,
      userId,
      kind: 'run_completed',
      title: 'Run completed: foo',
      body: 'Run abc finished.',
      link: '/runs/abc',
      metadata: { runId: 'abc' },
    });
    await emitNotification(env.db, {
      tenantId,
      userId,
      kind: 'run_failed',
      title: 'Run failed: foo',
      body: 'Run def failed.',
    });
    const res = await env.app.request('/v1/notifications', { headers: auth });
    expect(res.status).toBe(200);
    const body = ListNotificationsResponse.parse(await res.json());
    expect(body.notifications.length).toBe(2);
    expect(body.unreadCount).toBe(2);
    // newest first
    expect(body.notifications[0]?.kind).toBe('run_failed');
    expect(body.notifications[1]?.kind).toBe('run_completed');
    expect(body.notifications[1]?.metadata.runId).toBe('abc');
  });

  it('unread_only filter hides read rows', async () => {
    const { tenantId, userId, auth } = await freshTenant();
    const a = await emitNotification(env.db, {
      tenantId,
      userId,
      kind: 'run_completed',
      title: 'A',
      body: 'a',
    });
    await emitNotification(env.db, {
      tenantId,
      userId,
      kind: 'run_completed',
      title: 'B',
      body: 'b',
    });
    const markRes = await env.app.request(`/v1/notifications/${a.id}/mark-read`, {
      method: 'POST',
      headers: auth,
    });
    expect(markRes.status).toBe(200);
    const res = await env.app.request('/v1/notifications?unreadOnly=true', { headers: auth });
    const body = ListNotificationsResponse.parse(await res.json());
    expect(body.notifications.length).toBe(1);
    expect(body.notifications[0]?.title).toBe('B');
    expect(body.unreadCount).toBe(1);
  });

  it('mark-all-read flips every unread row', async () => {
    const { tenantId, userId, auth } = await freshTenant();
    for (const i of [1, 2, 3]) {
      await emitNotification(env.db, {
        tenantId,
        userId,
        kind: 'sweep_completed',
        title: `Sweep ${i}`,
        body: 'b',
      });
    }
    const res = await env.app.request('/v1/notifications/mark-all-read', {
      method: 'POST',
      headers: auth,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { markedCount: number };
    expect(body.markedCount).toBe(3);
    const list = await env.app.request('/v1/notifications', { headers: auth });
    const listBody = ListNotificationsResponse.parse(await list.json());
    expect(listBody.unreadCount).toBe(0);
    expect(listBody.notifications.every((n) => n.readAt !== null)).toBe(true);
  });

  it('kind filter narrows results', async () => {
    const { tenantId, userId, auth } = await freshTenant();
    await emitNotification(env.db, {
      tenantId,
      userId,
      kind: 'run_failed',
      title: 'x',
      body: 'x',
    });
    await emitNotification(env.db, {
      tenantId,
      userId,
      kind: 'sweep_completed',
      title: 'y',
      body: 'y',
    });
    const res = await env.app.request('/v1/notifications?kind=run_failed', { headers: auth });
    const body = ListNotificationsResponse.parse(await res.json());
    expect(body.notifications.length).toBe(1);
    expect(body.notifications[0]?.kind).toBe('run_failed');
  });

  it('cross-tenant isolation: another tenant cannot see notifications', async () => {
    const a = await freshTenant();
    const b = await freshTenant();
    await emitNotification(env.db, {
      tenantId: a.tenantId,
      userId: a.userId,
      kind: 'run_completed',
      title: 'tenant A row',
      body: 'a',
    });
    const resB = await env.app.request('/v1/notifications', { headers: b.auth });
    const bodyB = ListNotificationsResponse.parse(await resB.json());
    expect(bodyB.notifications.length).toBe(0);
    expect(bodyB.unreadCount).toBe(0);
  });

  it('mark-read for a notification id from another tenant 404s', async () => {
    const a = await freshTenant();
    const b = await freshTenant();
    const n = await emitNotification(env.db, {
      tenantId: a.tenantId,
      userId: a.userId,
      kind: 'run_completed',
      title: 'a',
      body: 'a',
    });
    const res = await env.app.request(`/v1/notifications/${n.id}/mark-read`, {
      method: 'POST',
      headers: b.auth,
    });
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// SSE
// ---------------------------------------------------------------------------

describe('GET /v1/sse/events', () => {
  it('rejects an invalid stream selector', async () => {
    const res = await env.app.request('/v1/sse/events?stream=garbage');
    expect(res.status).toBe(400);
  });

  it('streams a notification frame on the notifications channel', async () => {
    const { tenantId, userId, auth } = await freshTenant();
    const ac = new AbortController();
    const resPromise = env.app.request('/v1/sse/events?stream=notifications', {
      headers: auth,
      signal: ac.signal,
    });
    // Give the long-poll a moment to arm.
    await sleep(50);
    await emitNotification(env.db, {
      tenantId,
      userId,
      kind: 'run_completed',
      title: 'live',
      body: 'live body',
    });
    const res = await resPromise;
    const reader = (res.body as ReadableStream).getReader();
    let received = '';
    const start = Date.now();
    try {
      while (Date.now() - start < 4000) {
        const { value, done } = await reader.read();
        if (done) break;
        received += new TextDecoder().decode(value);
        if (
          received.includes('"event":"notification"') ||
          received.includes('event: notification')
        ) {
          break;
        }
      }
    } finally {
      ac.abort();
      try {
        reader.cancel();
      } catch {}
    }
    expect(received).toContain('event: notification');
    expect(received).toContain('"title":"live"');
  }, 10000);

  it('streams a run_event frame on the run/<id> channel', async () => {
    const { tenantId, auth } = await freshTenant();
    // Seed the run + one pre-existing event so the prime-step has
    // something to anchor against.
    const runId = `run_${Math.random().toString(36).slice(2, 10)}`;
    await env.db.query(
      `INSERT INTO runs (id, tenant_id, agent_name, agent_version, status, started_at)
       VALUES ($1, $2, 'agent-x', '1.0.0', 'running', now())`,
      [runId, tenantId],
    );
    await env.db.query(
      `INSERT INTO run_events (id, run_id, tenant_id, type, payload_jsonb, at)
       VALUES ($1, $2, $3, 'message', '{"hello":"world"}'::jsonb, now())`,
      [`ev_seed_${runId}`, runId, tenantId],
    );
    const ac = new AbortController();
    const resPromise = env.app.request(`/v1/sse/events?stream=run/${runId}`, {
      headers: auth,
      signal: ac.signal,
    });
    await sleep(80);
    // Insert AFTER prime; this is the row we expect to stream.
    await env.db.query(
      `INSERT INTO run_events (id, run_id, tenant_id, type, payload_jsonb, at)
       VALUES ($1, $2, $3, 'tool_call', '{"name":"foo"}'::jsonb, now())`,
      [`ev_after_${runId}`, runId, tenantId],
    );
    const res = await resPromise;
    const reader = (res.body as ReadableStream).getReader();
    let received = '';
    const start = Date.now();
    try {
      while (Date.now() - start < 4000) {
        const { value, done } = await reader.read();
        if (done) break;
        received += new TextDecoder().decode(value);
        if (received.includes('event: run_event')) break;
      }
    } finally {
      ac.abort();
      try {
        reader.cancel();
      } catch {}
    }
    expect(received).toContain('event: run_event');
    expect(received).toContain('"type":"tool_call"');
  }, 10000);
});

// ---------------------------------------------------------------------------
// Activity feed
// ---------------------------------------------------------------------------

describe('activity feed', () => {
  it('emit + list newest first', async () => {
    const { tenantId, userId, auth } = await freshTenant();
    await emitActivity(env.db, {
      tenantId,
      actorUserId: userId,
      verb: 'ran',
      objectKind: 'agent',
      objectId: 'architect',
      metadata: { runId: 'r1' },
    });
    await emitActivity(env.db, {
      tenantId,
      actorUserId: userId,
      verb: 'updated',
      objectKind: 'agent',
      objectId: 'principal',
    });
    const res = await env.app.request('/v1/activity', { headers: auth });
    expect(res.status).toBe(200);
    const body = ListActivityResponse.parse(await res.json());
    expect(body.events.length).toBe(2);
    expect(body.events[0]?.verb).toBe('updated');
    expect(body.events[1]?.verb).toBe('ran');
    expect(body.events[1]?.actorUserId).toBe(userId);
  });

  it('cursor pagination returns disjoint pages', async () => {
    const { tenantId, userId, auth } = await freshTenant();
    for (let i = 0; i < 5; i++) {
      await emitActivity(env.db, {
        tenantId,
        actorUserId: userId,
        verb: 'ran',
        objectKind: 'agent',
        objectId: `a${i}`,
      });
      // Force monotonic creation timestamps.
      await sleep(2);
    }
    const r1 = await env.app.request('/v1/activity?limit=2', { headers: auth });
    const b1 = ListActivityResponse.parse(await r1.json());
    expect(b1.events.length).toBe(2);
    expect(b1.hasMore).toBe(true);
    const r2 = await env.app.request(
      `/v1/activity?limit=2&cursor=${encodeURIComponent(b1.nextCursor ?? '')}`,
      { headers: auth },
    );
    const b2 = ListActivityResponse.parse(await r2.json());
    expect(b2.events.length).toBe(2);
    const ids1 = new Set(b1.events.map((e) => e.id));
    for (const e of b2.events) expect(ids1.has(e.id)).toBe(false);
  });

  it('actor + verb filter narrows results', async () => {
    const { tenantId, userId, auth } = await freshTenant();
    const otherUser = `user-other-${Math.random().toString(36).slice(2, 8)}`;
    await env.db.query(
      `INSERT INTO users (id, email, password_hash) VALUES ($1, $2, 'x') ON CONFLICT (id) DO NOTHING`,
      [otherUser, `${otherUser}@aldo.test`],
    );
    await emitActivity(env.db, {
      tenantId,
      actorUserId: userId,
      verb: 'ran',
      objectKind: 'agent',
      objectId: 'a',
    });
    await emitActivity(env.db, {
      tenantId,
      actorUserId: otherUser,
      verb: 'ran',
      objectKind: 'agent',
      objectId: 'b',
    });
    await emitActivity(env.db, {
      tenantId,
      actorUserId: userId,
      verb: 'updated',
      objectKind: 'agent',
      objectId: 'c',
    });
    const res = await env.app.request(
      `/v1/activity?actorUserId=${encodeURIComponent(userId)}&verb=ran`,
      { headers: auth },
    );
    const body = ListActivityResponse.parse(await res.json());
    expect(body.events.length).toBe(1);
    expect(body.events[0]?.objectId).toBe('a');
  });

  it('cross-tenant isolation', async () => {
    const a = await freshTenant();
    const b = await freshTenant();
    await emitActivity(env.db, {
      tenantId: a.tenantId,
      actorUserId: a.userId,
      verb: 'ran',
      objectKind: 'agent',
      objectId: 'tenant-a-only',
    });
    const res = await env.app.request('/v1/activity', { headers: b.auth });
    const body = ListActivityResponse.parse(await res.json());
    expect(body.events.length).toBe(0);
    // And the direct read confirms tenant scoping at the helper level.
    const directA = await listActivity(env.db, { tenantId: a.tenantId, limit: 50 });
    expect(directA.events.length).toBe(1);
    const directB = await listActivity(env.db, { tenantId: b.tenantId, limit: 50 });
    expect(directB.events.length).toBe(0);
  });
});

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// Reference imports so tsc doesn't drop them.
void listNotifications;
