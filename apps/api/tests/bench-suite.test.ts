/**
 * Tests for `/v1/bench/suite` SSE + `/v1/bench/suites` listing +
 * `/v1/models/discover` + `/v1/models/scan`.
 *
 * The bench engine itself is unit-tested in @aldo-ai/bench-suite; here
 * we cover the HTTP contract: route registration, validation, SSE
 * frame ordering, suite-id resolution against the server-side root.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type TestEnv, setupTestEnv } from './_setup.js';

describe('GET /v1/bench/suites', () => {
  let env: TestEnv;
  beforeAll(async () => {
    env = await setupTestEnv({});
  });
  afterAll(async () => {
    await env.teardown();
  });

  it('lists every suite under agency/eval/<id>/suite.yaml', async () => {
    const res = await env.app.request('/v1/bench/suites', { headers: env.authHeader });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      suites: Array<{ id: string; name: string; version: string; caseCount: number }>;
    };
    expect(Array.isArray(body.suites)).toBe(true);
    // local-model-rating is the v0 suite shipped with the repo.
    const lmr = body.suites.find((s) => s.id === 'local-model-rating');
    expect(lmr).toBeDefined();
    expect(lmr?.name).toBe('local-model-rating');
    expect(lmr?.caseCount).toBeGreaterThan(0);
  });
});

describe('POST /v1/bench/suite', () => {
  let env: TestEnv;
  let originalFetch: typeof fetch;
  beforeAll(async () => {
    env = await setupTestEnv({});
  });
  afterAll(async () => {
    await env.teardown();
  });

  function fakeSse(content: string): Response {
    const frames: unknown[] = [
      { choices: [{ delta: { content } }] },
      { usage: { prompt_tokens: 10, completion_tokens: content.length } },
    ];
    const body = new ReadableStream({
      start(c) {
        for (const f of frames) c.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(f)}\n`));
        c.enqueue(new TextEncoder().encode('data: [DONE]\n'));
        c.close();
      },
    });
    return new Response(body, {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    });
  }

  it('streams SSE frames for each case + a final summary', async () => {
    originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => fakeSse('BENCH_TOKEN')) as unknown as typeof fetch;
    try {
      // Inline a tiny suite to keep the test independent of the
      // shipped local-model-rating fixture's case count.
      const yaml = `name: probe-suite
version: 0.1.0
description: tiny inline suite
agent: __bench__
passThreshold: 0.5
cases:
  - id: a
    input: "Reply with: BENCH_TOKEN"
    expect:
      kind: contains
      value: BENCH_TOKEN
  - id: b
    input: "Reply with: BENCH_TOKEN"
    expect:
      kind: contains
      value: BENCH_TOKEN
`;
      const res = await env.app.request('/v1/bench/suite', {
        method: 'POST',
        headers: {
          ...env.authHeader,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          yaml,
          model: 'fake-model',
          baseUrl: 'http://fake.local',
        }),
      });
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type') ?? '').toContain('text/event-stream');
      const text = await res.text();
      // SSE frames: start + 2x case + summary + done
      const frames = text
        .split(/\n\n/)
        .filter((s) => s.length > 0)
        .map((block) => {
          const lines = block.split('\n');
          const eventLine = lines.find((l) => l.startsWith('event:'));
          const dataLine = lines.find((l) => l.startsWith('data:'));
          return {
            event: eventLine?.slice(6).trim() ?? 'message',
            data: dataLine?.slice(5).trim() ?? '',
          };
        });
      const events = frames.map((f) => f.event);
      expect(events).toContain('frame');
      expect(events).toContain('done');
      // Find the summary frame and assert shape.
      const summaryFrame = frames.find((f) => {
        if (f.event !== 'frame') return false;
        try {
          const parsed = JSON.parse(f.data) as { type?: string };
          return parsed.type === 'summary';
        } catch {
          return false;
        }
      });
      expect(summaryFrame).toBeDefined();
      const sum = JSON.parse(summaryFrame?.data ?? '{}') as {
        type: string;
        result: { cases: Array<{ id: string; passed: boolean }>; summary: { total: number } };
      };
      expect(sum.result.cases.map((c) => c.id)).toEqual(['a', 'b']);
      expect(sum.result.summary.total).toBe(2);
      expect(sum.result.cases.every((c) => c.passed)).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('rejects requests with neither suiteId nor yaml', async () => {
    const res = await env.app.request('/v1/bench/suite', {
      method: 'POST',
      headers: { ...env.authHeader, 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'm', baseUrl: 'http://fake' }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects requests with both suiteId and yaml', async () => {
    const res = await env.app.request('/v1/bench/suite', {
      method: 'POST',
      headers: { ...env.authHeader, 'content-type': 'application/json' },
      body: JSON.stringify({
        suiteId: 'local-model-rating',
        yaml: 'name: x',
        model: 'm',
        baseUrl: 'http://fake',
      }),
    });
    expect(res.status).toBe(400);
  });
});

describe('GET /v1/models/scan', () => {
  let env: TestEnv;
  let originalFetch: typeof fetch;
  beforeAll(async () => {
    env = await setupTestEnv({});
  });
  afterAll(async () => {
    await env.teardown();
  });

  it('returns models found by the port scan', async () => {
    originalFetch = globalThis.fetch;
    globalThis.fetch = (async (url: unknown) => {
      const u = String(url);
      if (u.includes(':5000/v1/models')) {
        return new Response(JSON.stringify({ data: [{ id: 'scanned-a' }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response('', { status: 404 });
    }) as unknown as typeof fetch;
    try {
      const res = await env.app.request('/v1/models/scan?ports=5000,5001', {
        headers: env.authHeader,
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        scan: string;
        models: Array<{ id: string; source: string; baseUrl: string | null }>;
      };
      expect(body.scan).toBe('custom');
      expect(body.models.map((m) => m.id)).toContain('scanned-a');
      expect(body.models.find((m) => m.id === 'scanned-a')?.source).toBe('openai-compat');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
