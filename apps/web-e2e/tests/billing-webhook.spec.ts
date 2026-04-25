/**
 * Billing webhook smoke spec — wave 11.
 *
 * Boundary contract:
 *
 *   * In `not_configured` mode (no Stripe env vars), the webhook
 *     endpoint returns HTTP 503 with code `not_configured`. We do
 *     NOT exercise that here — the API unit tests cover it.
 *
 *   * In `test_mode` (STRIPE_TEST_MODE=true), the deployed API has
 *     real test-mode keys and reachable Stripe. This spec POSTs a
 *     known-bad signature to /v1/billing/webhook and asserts the
 *     server rejects it with 400 invalid_signature.
 *
 * Gated behind `E2E_ALLOW_WRITES` (per the brief — same pattern as
 * the auth spec) AND `STRIPE_TEST_MODE=true`. Either knob unset
 * skips the spec so the default smoke suite runs unaffected.
 *
 * LLM-agnostic: this spec never asserts on a provider name.
 */

import { expect, test } from '@playwright/test';

const ALLOW_WRITES = process.env.E2E_ALLOW_WRITES === 'true';
const STRIPE_TEST_MODE = process.env.STRIPE_TEST_MODE === 'true';

test.describe('billing webhook — wave 11', () => {
  test.skip(
    !ALLOW_WRITES || !STRIPE_TEST_MODE,
    'requires E2E_ALLOW_WRITES=true and STRIPE_TEST_MODE=true',
  );

  test('rejects a tampered body with HTTP 400 invalid_signature', async ({ request, baseURL }) => {
    const apiBase = process.env.E2E_API_BASE ?? baseURL ?? 'http://localhost:3001';
    const url = new URL('/v1/billing/webhook', apiBase).toString();
    const res = await request.post(url, {
      headers: {
        'Content-Type': 'application/json',
        // Intentionally bogus signature — Stripe's verifier MUST reject.
        'Stripe-Signature': 't=1,v1=deadbeef',
      },
      data: '{"id":"evt_tampered","type":"checkout.session.completed","data":{"object":{}}}',
    });
    expect(res.status()).toBe(400);
    const body = (await res.json()) as { error?: { code?: string } };
    expect(body.error?.code).toBe('invalid_signature');
  });
});
