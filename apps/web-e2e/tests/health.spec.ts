/**
 * API health spec.
 *
 * Hits the live Fly API directly (NOT through the web app). This is the
 * canary that tells us whether anything else has a chance of working.
 *
 * Required env:
 *   - `E2E_API_BASE_URL` — the API origin, e.g. https://ai.aldo.tech.
 *     If missing, falls back to `E2E_BASE_URL` (which usually points at
 *     the web app and will fail loudly — that's the intent).
 *
 * LLM-agnostic: /v1/models is asserted only by shape — we never check
 * for any specific provider, locality, or model id.
 */

import { expect, test } from '@playwright/test';

const API_BASE_URL = process.env.E2E_API_BASE_URL ?? process.env.E2E_BASE_URL ?? '';

test.describe('api health', () => {
  test.skip(!API_BASE_URL, 'E2E_API_BASE_URL (or E2E_BASE_URL) must be set');

  test('GET /health returns 200', async ({ request }) => {
    const res = await request.get(`${API_BASE_URL}/health`);
    expect(res.status(), 'GET /health should be 200').toBe(200);
    const body = (await res.json()) as { ok?: unknown; version?: unknown };
    expect(body.ok, '/health body must include ok:true').toBe(true);
    expect(typeof body.version, '/health body must include a version string').toBe('string');
  });

  test('GET /v1/models without auth returns 401 (auth gate is wired)', async ({ request }) => {
    // Wave 10 made every /v1/* endpoint auth-required. The earlier
    // assertion ("returns 200 with non-empty models") presumed a
    // pre-wave-10 world where /v1/models was accidentally public.
    // The meaningful invariant today is "the auth gate fires" —
    // responding 401 to an unauthenticated request.
    const res = await request.get(`${API_BASE_URL}/v1/models`);
    expect(res.status(), 'GET /v1/models without Authorization must 401').toBe(401);
    const body = (await res.json()) as { error?: { code?: unknown } };
    expect(typeof body.error?.code, 'response must carry the standard error envelope').toBe(
      'string',
    );
  });

  test('GET /v1/secrets without auth returns 401 (auth gate is wired)', async ({ request }) => {
    // Same fix as /v1/models above. The "secrets list must never echo
    // raw values" check is preserved as a separate test in the
    // authenticated suite (post-signup spec), not here.
    const res = await request.get(`${API_BASE_URL}/v1/secrets`);
    expect(res.status(), 'GET /v1/secrets without Authorization must 401').toBe(401);
  });

  test('GET /openapi.json is public (no auth required)', async ({ request }) => {
    // The OpenAPI spec is an explicit allow-list entry on the API's
    // bearer-token middleware. This is the canary that the
    // documentation surfaces (Scalar, Redoc) can fetch the spec
    // without a key.
    const res = await request.get(`${API_BASE_URL}/openapi.json`);
    expect(res.status(), 'GET /openapi.json must be 200 without auth').toBe(200);
    const body = (await res.json()) as { openapi?: unknown; paths?: unknown };
    expect(typeof body.openapi, 'response must declare an openapi version string').toBe('string');
    expect(typeof body.paths, 'response must include a paths object').toBe('object');
  });
});
