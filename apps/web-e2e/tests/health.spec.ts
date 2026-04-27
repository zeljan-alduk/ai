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

  test('GET /v1/models returns 200 with non-empty models array', async ({ request }) => {
    const res = await request.get(`${API_BASE_URL}/v1/models`);
    expect(res.status(), 'GET /v1/models should be 200').toBe(200);
    const body = (await res.json()) as { models?: unknown };
    expect(Array.isArray(body.models), '/v1/models.models must be an array').toBe(true);
    const models = body.models as unknown[];
    expect(models.length, '/v1/models.models must be non-empty').toBeGreaterThan(0);

    // Shape check on the first row — we deliberately do NOT inspect
    // `provider` or `model` string values to keep this LLM-agnostic.
    const first = models[0] as Record<string, unknown>;
    expect(typeof first.id).toBe('string');
    expect(typeof first.provider).toBe('string');
    expect(typeof first.locality).toBe('string');
    expect(Array.isArray(first.privacyAllowed)).toBe(true);
  });

  test('GET /v1/secrets returns 200 with a secrets array (may be empty)', async ({ request }) => {
    const res = await request.get(`${API_BASE_URL}/v1/secrets`);
    expect(res.status(), 'GET /v1/secrets should be 200').toBe(200);
    const body = (await res.json()) as { secrets?: unknown };
    expect(Array.isArray(body.secrets), '/v1/secrets.secrets must be an array').toBe(true);
    // Each row (if any) must have name + redacted preview, never a raw
    // value field. Empty list is also a valid response.
    for (const row of body.secrets as Array<Record<string, unknown>>) {
      expect(typeof row.name).toBe('string');
      expect(typeof row.preview).toBe('string');
      expect('value' in row, 'secrets list must never echo raw values').toBe(false);
    }
  });
});
