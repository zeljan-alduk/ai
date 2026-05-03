/**
 * `/v1/threads` — wave-19 (Backend + Frontend Engineer).
 *
 * Covers list / detail / timeline + tenant isolation + the empty case.
 */

import {
  GetThreadResponse,
  GetThreadTimelineResponse,
  ListThreadsResponse,
} from '@aldo-ai/api-contract';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type TestEnv, seedAgent, seedRun, setupTestEnv } from './_setup.js';

let env: TestEnv;

beforeAll(async () => {
  env = await setupTestEnv();
  await seedAgent(env.db, {
    name: 'chat-agent',
    owner: 'tester',
    version: '1.0.0',
    team: 'qa',
  });
});

afterAll(async () => {
  await env.teardown();
});

const BASE = new Date('2026-05-01T10:00:00.000Z').getTime();

async function seedThreadOf(
  threadId: string,
  count: number,
  agentName = 'chat-agent',
  withEvents = true,
): Promise<void> {
  for (let i = 0; i < count; i++) {
    const startedAt = new Date(BASE + i * 60_000).toISOString();
    const endedAt = new Date(BASE + i * 60_000 + 30_000).toISOString();
    await seedRun(env.db, {
      id: `${threadId}-r${i}`,
      agentName,
      threadId,
      startedAt,
      endedAt,
      status: 'completed',
      usage: [
        {
          provider: 'opaque-cloud',
          model: 'opaque-large',
          tokensIn: 100,
          tokensOut: 200,
          usd: 0.01,
          at: startedAt,
        },
      ],
      events: withEvents
        ? [
            {
              id: `${threadId}-r${i}-ev0`,
              type: 'message',
              payload: { role: 'user', text: `turn ${i} prompt` },
              at: startedAt,
            },
            {
              id: `${threadId}-r${i}-ev1`,
              type: 'message',
              payload: { role: 'assistant', text: `turn ${i} reply` },
              at: endedAt,
            },
          ]
        : [],
    });
  }
}

describe('GET /v1/threads', () => {
  it('returns an empty list when no runs have a thread_id', async () => {
    // Seed a non-thread run — should not appear in /v1/threads.
    await seedRun(env.db, {
      id: 'standalone-1',
      agentName: 'chat-agent',
      startedAt: new Date(BASE - 600_000).toISOString(),
      endedAt: new Date(BASE - 590_000).toISOString(),
    });
    const res = await env.app.request('/v1/threads');
    expect(res.status).toBe(200);
    const body = ListThreadsResponse.parse(await res.json());
    expect(body.threads).toEqual([]);
    expect(body.hasMore).toBe(false);
    expect(body.nextCursor).toBeNull();
  });

  it('aggregates run count + first/last activity + cost across a thread', async () => {
    await seedThreadOf('thread-aggregates', 3);
    const res = await env.app.request('/v1/threads');
    expect(res.status).toBe(200);
    const body = ListThreadsResponse.parse(await res.json());
    const t = body.threads.find((x) => x.id === 'thread-aggregates');
    expect(t).toBeDefined();
    expect(t?.runCount).toBe(3);
    // 3 runs * $0.01 each = $0.03 (within float tolerance).
    expect(t?.totalUsd).toBeCloseTo(0.03, 5);
    expect(t?.agentNames).toEqual(['chat-agent']);
    expect(t?.lastStatus).toBe('completed');
    // First / last activity timestamps in ISO order.
    expect(t!.firstActivityAt < t!.lastActivityAt).toBe(true);
  });

  it('paginates by (last_activity_at, thread_id) with strict-tuple cursor', async () => {
    await seedThreadOf('paged-a', 1);
    await seedThreadOf('paged-b', 1);
    const r1 = await env.app.request('/v1/threads?limit=1');
    expect(r1.status).toBe(200);
    const p1 = ListThreadsResponse.parse(await r1.json());
    expect(p1.threads.length).toBe(1);
    expect(p1.hasMore).toBe(true);
    expect(p1.nextCursor).not.toBeNull();
    const r2 = await env.app.request(
      `/v1/threads?limit=1&cursor=${encodeURIComponent(p1.nextCursor!)}`,
    );
    expect(r2.status).toBe(200);
    const p2 = ListThreadsResponse.parse(await r2.json());
    expect(p2.threads.length).toBe(1);
    expect(p2.threads[0]?.id).not.toBe(p1.threads[0]?.id);
  });

  it('rejects an invalid cursor with HTTP 400', async () => {
    const res = await env.app.request('/v1/threads?cursor=not-base64');
    expect(res.status).toBe(400);
  });
});

describe('GET /v1/threads/:id', () => {
  it('returns 404 for an unknown thread id (no info leak)', async () => {
    const res = await env.app.request('/v1/threads/does-not-exist');
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).toBe('thread not found');
  });

  it('returns the thread head + every run, ordered oldest-first', async () => {
    await seedThreadOf('thread-detail', 3);
    const res = await env.app.request('/v1/threads/thread-detail');
    expect(res.status).toBe(200);
    const body = GetThreadResponse.parse(await res.json());
    expect(body.thread.id).toBe('thread-detail');
    expect(body.runs).toHaveLength(3);
    // Strict ASC order on startedAt.
    expect(body.runs[0]?.id).toBe('thread-detail-r0');
    expect(body.runs[2]?.id).toBe('thread-detail-r2');
    for (const r of body.runs) {
      expect(r.threadId).toBe('thread-detail');
    }
  });

  it('is tenant-scoped — a thread in tenant B is invisible to tenant A', async () => {
    const tenantB = '00000000-0000-0000-0000-000000000bbb';
    const headerB = await env.authFor(tenantB);
    await seedRun(env.db, {
      id: 'tenant-b-run',
      tenantId: tenantB,
      agentName: 'chat-agent',
      threadId: 'tenant-b-thread',
      startedAt: new Date(BASE).toISOString(),
      endedAt: new Date(BASE + 1000).toISOString(),
    });
    // tenant-A caller (default header) cannot see it.
    const r1 = await env.app.request('/v1/threads/tenant-b-thread');
    expect(r1.status).toBe(404);
    // tenant-B caller can.
    const r2 = await env.app.request('/v1/threads/tenant-b-thread', {
      headers: headerB,
    });
    expect(r2.status).toBe(200);
  });
});

describe('GET /v1/threads/:id/timeline', () => {
  it('returns events from every run in the thread, oldest first', async () => {
    await seedThreadOf('thread-timeline', 2);
    const res = await env.app.request('/v1/threads/thread-timeline/timeline');
    expect(res.status).toBe(200);
    const body = GetThreadTimelineResponse.parse(await res.json());
    // 2 runs * 2 events per run = 4 events.
    expect(body.events).toHaveLength(4);
    // Oldest-first ordering across runs.
    for (let i = 1; i < body.events.length; i++) {
      const prev = body.events[i - 1]!;
      const cur = body.events[i]!;
      expect(prev.at <= cur.at).toBe(true);
    }
    // Each event carries its source runId.
    expect(body.events[0]?.runId).toBe('thread-timeline-r0');
    expect(body.events[3]?.runId).toBe('thread-timeline-r1');
  });

  it('returns 404 for an unknown thread id', async () => {
    const res = await env.app.request('/v1/threads/does-not-exist/timeline');
    expect(res.status).toBe(404);
  });
});
