import { Hono } from 'hono';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { healthRoutes } from '../src/routes/health.js';
import { type TestEnv, setupTestEnv } from './_setup.js';

let env: TestEnv;

beforeAll(async () => {
  env = await setupTestEnv({ API_VERSION: '0.0.0-test' });
});

afterAll(async () => {
  await env.teardown();
});

describe('GET /health', () => {
  it('returns 200 with ok + version + db ping (ok)', async () => {
    const res = await env.app.request('/health');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      status: 'ok' | 'degraded';
      api: 'ok';
      db: 'ok' | 'down';
      version: string;
      timestamp: string;
    };
    // Live test pglite is up — db ping must succeed.
    expect(body.ok).toBe(true);
    expect(body.status).toBe('ok');
    expect(body.api).toBe('ok');
    expect(body.db).toBe('ok');
    expect(body.version).toBe('0.0.0-test');
    expect(typeof body.timestamp).toBe('string');
    // Sanity: ISO-8601 parses.
    expect(Number.isNaN(Date.parse(body.timestamp))).toBe(false);
  });

  it('reports db: down + status: degraded when the DB ping throws', async () => {
    // Build the route with a synthetic deps bag whose `db.query()`
    // always throws. The endpoint must STILL answer 200 with a
    // structured `db: 'down'` body — never a 503 — because operators
    // read the body to drive dashboards and a 503 would knock the
    // whole API out of the uptime-monitor success-rate metric for
    // what is a partial degradation.
    const stubDeps = {
      ...env.deps,
      db: {
        async query() {
          throw new Error('connection lost');
        },
        async exec() {
          /* noop */
        },
        async close() {
          /* noop */
        },
      },
    } as unknown as typeof env.deps;
    const app = new Hono();
    app.route('/', healthRoutes(stubDeps));
    const res = await app.request('/health');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      status: string;
      api: string;
      db: string;
    };
    expect(body.ok).toBe(false);
    expect(body.status).toBe('degraded');
    expect(body.api).toBe('ok');
    expect(body.db).toBe('down');
  });
});
