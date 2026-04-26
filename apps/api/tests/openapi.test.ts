/**
 * Smoke tests for the public `GET /openapi.json` + `GET /openapi.yaml`
 * endpoints. These are the integrator-facing entry points: any failure
 * here breaks Swagger UI / Redoc / openapi-generator workflows.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resetOpenApiCache } from '../src/routes/openapi.js';
import { type TestEnv, setupTestEnv } from './_setup.js';

let env: TestEnv;

beforeAll(async () => {
  resetOpenApiCache();
  env = await setupTestEnv({ API_VERSION: '0.0.0-openapi-test' });
});

afterAll(async () => {
  await env.teardown();
  resetOpenApiCache();
});

describe('GET /openapi.json', () => {
  it('returns 200 with application/json + cache headers', async () => {
    const res = await env.rawApp.request('/openapi.json');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(res.headers.get('cache-control')).toContain('public');
  });

  it('is a syntactically valid OpenAPI 3.1 root', async () => {
    const res = await env.rawApp.request('/openapi.json');
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.openapi).toBe('3.1.0');
    expect(body.info).toBeDefined();
    expect((body.info as { version: string }).version).toBe('0.0.0-openapi-test');
    expect(body.paths).toBeDefined();
    expect(body.components).toBeDefined();
  });

  it('does not require auth (skips bearer middleware)', async () => {
    // No Authorization header — should still resolve.
    const res = await env.rawApp.request('/openapi.json');
    expect(res.status).toBe(200);
  });

  it('lists at least 50 operations', async () => {
    const res = await env.rawApp.request('/openapi.json');
    const body = (await res.json()) as { paths: Record<string, Record<string, unknown>> };
    let n = 0;
    for (const item of Object.values(body.paths)) {
      for (const _ of Object.values(item)) n++;
    }
    expect(n).toBeGreaterThanOrEqual(50);
  });
});

describe('GET /openapi.yaml', () => {
  it('returns 200 with YAML media type', async () => {
    const res = await env.rawApp.request('/openapi.yaml');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('yaml');
    const body = await res.text();
    expect(body).toContain("openapi: '3.1.0'");
    expect(body).toContain('paths:');
    expect(body).toContain('components:');
  });

  it('returns the same version stamp as /openapi.json', async () => {
    const jsonRes = await env.rawApp.request('/openapi.json');
    const json = (await jsonRes.json()) as { info: { version: string } };
    const yamlRes = await env.rawApp.request('/openapi.yaml');
    const yaml = await yamlRes.text();
    expect(yaml).toContain(json.info.version);
  });
});
