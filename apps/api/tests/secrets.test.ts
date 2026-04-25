/**
 * Tests for `/v1/secrets`.
 *
 * Spins up the test harness with an `InMemorySecretStore` and exercises
 * the round-trip: list (empty) -> set -> list (has the entry, no
 * value) -> delete -> 404.
 *
 * Validation errors (bad name, bad body) and missing-secret 404s use
 * the shared `ApiError` envelope.
 */

import { ApiError, ListSecretsResponse, SetSecretResponse } from '@aldo-ai/api-contract';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type TestEnv, setupTestEnv } from './_setup.js';

let env: TestEnv;

beforeAll(async () => {
  env = await setupTestEnv();
});

afterAll(async () => {
  await env.teardown();
});

describe('GET /v1/secrets', () => {
  it('returns the empty list on a fresh store', async () => {
    const res = await env.app.request('/v1/secrets');
    expect(res.status).toBe(200);
    const body = ListSecretsResponse.parse(await res.json());
    expect(body.secrets).toEqual([]);
  });
});

describe('POST /v1/secrets', () => {
  it('creates a secret and returns its summary (no value)', async () => {
    const res = await env.app.request('/v1/secrets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'API_KEY', value: 'sk-not-real-1234' }),
    });
    expect(res.status).toBe(200);
    const body = SetSecretResponse.parse(await res.json());
    expect(body.name).toBe('API_KEY');
    expect(body.preview).toBe('1234');
    expect(body.fingerprint.length).toBeGreaterThan(0);
    // The raw value never appears in the response.
    expect(JSON.stringify(body)).not.toContain('sk-not-real-1234');
  });

  it('subsequent list shows the new secret (without the value)', async () => {
    const res = await env.app.request('/v1/secrets');
    const body = ListSecretsResponse.parse(await res.json());
    expect(body.secrets.find((s) => s.name === 'API_KEY')).toBeDefined();
    expect(JSON.stringify(body)).not.toContain('sk-not-real-1234');
  });

  it('updates an existing secret on duplicate POST', async () => {
    const res = await env.app.request('/v1/secrets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'API_KEY', value: 'sk-rotated-zzzz' }),
    });
    expect(res.status).toBe(200);
    const body = SetSecretResponse.parse(await res.json());
    expect(body.preview).toBe('zzzz');
  });

  it('400s on malformed body', async () => {
    const res = await env.app.request('/v1/secrets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-json',
    });
    expect(res.status).toBe(400);
    const err = ApiError.parse(await res.json());
    expect(err.error.code).toBe('validation_error');
  });

  it('400s on lowercase / non-conforming name', async () => {
    const res = await env.app.request('/v1/secrets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'lower_case', value: 'x' }),
    });
    expect(res.status).toBe(400);
    const err = ApiError.parse(await res.json());
    expect(err.error.code).toBe('validation_error');
  });

  it('400s when value is missing', async () => {
    const res = await env.app.request('/v1/secrets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'NEEDS_VALUE' }),
    });
    expect(res.status).toBe(400);
  });
});

describe('DELETE /v1/secrets/:name', () => {
  it('204s on a known secret', async () => {
    // Create one first so we know it exists.
    await env.app.request('/v1/secrets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'GONER', value: 'plaintext-1234' }),
    });
    const res = await env.app.request('/v1/secrets/GONER', { method: 'DELETE' });
    expect(res.status).toBe(204);
    // Body must be empty.
    expect(await res.text()).toBe('');
  });

  it('404s on an unknown secret', async () => {
    const res = await env.app.request('/v1/secrets/NEVER_SET', { method: 'DELETE' });
    expect(res.status).toBe(404);
    const err = ApiError.parse(await res.json());
    expect(err.error.code).toBe('not_found');
  });

  it('400s on a malformed name (lower-case)', async () => {
    const res = await env.app.request('/v1/secrets/lower', { method: 'DELETE' });
    expect(res.status).toBe(400);
  });
});
