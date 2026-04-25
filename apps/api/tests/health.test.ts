import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type TestEnv, setupTestEnv } from './_setup.js';

let env: TestEnv;

beforeAll(async () => {
  env = await setupTestEnv({ API_VERSION: '0.0.0-test' });
});

afterAll(async () => {
  await env.teardown();
});

describe('GET /health', () => {
  it('returns 200 with ok + version', async () => {
    const res = await env.app.request('/health');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; version: string };
    expect(body).toEqual({ ok: true, version: '0.0.0-test' });
  });
});
