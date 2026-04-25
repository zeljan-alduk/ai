/**
 * Golden-path browser flow.
 *
 * Drives the deployed web app against the live API. Loads the home page,
 * walks the sidebar, then exercises the secrets surface end-to-end (create
 * → list → delete).
 *
 * Mutation steps (POST/DELETE /v1/secrets) are gated behind
 * `E2E_ALLOW_WRITES=true` so we never leave test rows lying around in
 * production. CI flips that flag on for ephemeral preview environments
 * only.
 *
 * LLM-agnostic: this file never asserts on a provider name. /v1/models is
 * checked for shape only (non-empty `models` array).
 */

import { expect, test } from '@playwright/test';

const ALLOW_WRITES = process.env.E2E_ALLOW_WRITES === 'true';
const API_BASE_URL = process.env.E2E_API_BASE_URL ?? process.env.E2E_BASE_URL ?? '';

test.describe('golden path — public reads', () => {
  test('home redirects, sidebar shows ALDO AI branding', async ({ page }) => {
    await page.goto('/');
    // The home page is a server redirect to /runs; either landing page is
    // fine, but the branding must render. Use `exact: true` for "control
    // plane" because the footer also contains the substring
    // ("v0 control plane. Read-only.") and a loose match would trip
    // Playwright's strict-mode locator check.
    await expect(page.getByText('ALDO AI', { exact: true })).toBeVisible();
    await expect(page.getByText('control plane', { exact: true })).toBeVisible();
  });

  test('sidebar walk: /runs, /agents, /models', async ({ page }) => {
    await page.goto('/runs');
    await expect(page).toHaveURL(/\/runs(\/|$|\?)/);
    await expect(page.getByText('ALDO AI', { exact: true })).toBeVisible();

    // Use the sidebar nav links (each is a top-level <a>) instead of typing
    // URLs — that's what a user does, and it catches client-routing
    // regressions that direct goto() would miss.
    await page.getByRole('link', { name: 'Agents', exact: true }).click();
    await expect(page).toHaveURL(/\/agents(\/|$|\?)/);

    await page.getByRole('link', { name: 'Models', exact: true }).click();
    await expect(page).toHaveURL(/\/models(\/|$|\?)/);

    await page.getByRole('link', { name: 'Runs', exact: true }).click();
    await expect(page).toHaveURL(/\/runs(\/|$|\?)/);
  });

  test('/secrets page loads (or is gracefully missing)', async ({ page }) => {
    // The secrets UI may not be wired into the sidebar yet; we still want
    // the route to either render or 404 cleanly — never 500. Treat both
    // 200 and 404 as acceptable; fail on 5xx.
    const response = await page.goto('/secrets', { waitUntil: 'domcontentloaded' });
    const status = response?.status() ?? 0;
    expect(status, `/secrets returned ${status}`).toBeLessThan(500);
    // Branding still visible regardless of route status — the layout
    // chrome is shared.
    await expect(page.getByText('ALDO AI', { exact: true })).toBeVisible();
  });
});

test.describe('golden path — secrets CRUD (writes)', () => {
  test.skip(
    !ALLOW_WRITES,
    'E2E_ALLOW_WRITES is not "true" — refusing to mutate target environment',
  );
  test.skip(
    !API_BASE_URL,
    'E2E_API_BASE_URL is not set — cannot reach the API for the secrets CRUD path',
  );

  test('create, list, delete a fresh secret', async ({ page, request }) => {
    const name = `E2E_TEST_${randomSuffix()}`;
    const value = `e2e-value-${randomSuffix()}`;

    // Sanity: the row should not pre-exist.
    const before = await listSecretNames(request);
    expect(before, `secret ${name} should not pre-exist`).not.toContain(name);

    let createdName: string | undefined;
    try {
      // CREATE — POST returns the SecretSummary (no raw value).
      const createRes = await request.post(`${API_BASE_URL}/v1/secrets`, {
        data: { name, value },
      });
      expect(createRes.status(), 'POST /v1/secrets should be 200').toBe(200);
      const summary = (await createRes.json()) as {
        name: string;
        fingerprint: string;
        preview: string;
        referencedBy: string[];
      };
      expect(summary.name).toBe(name);
      expect(summary.fingerprint, 'fingerprint must be non-empty').toBeTruthy();
      expect(summary.preview, 'preview must be non-empty').toBeTruthy();
      // Preview is intentionally a redacted form of the original value —
      // it must NOT echo the raw value back.
      expect(summary.preview).not.toBe(value);
      expect(Array.isArray(summary.referencedBy)).toBe(true);
      createdName = name;

      // LIST — the new row must appear with the same preview.
      const after = await request.get(`${API_BASE_URL}/v1/secrets`);
      expect(after.status()).toBe(200);
      const afterBody = (await after.json()) as {
        secrets: Array<{ name: string; preview: string }>;
      };
      const found = afterBody.secrets.find((s) => s.name === name);
      expect(found, `${name} must appear in /v1/secrets`).toBeTruthy();
      expect(found?.preview).toBe(summary.preview);

      // Visit the /secrets web page (best-effort) — the row may or may
      // not render depending on whether the UI is wired up yet, but the
      // page must not 500.
      const pageResponse = await page.goto('/secrets', { waitUntil: 'domcontentloaded' });
      expect(pageResponse?.status() ?? 0).toBeLessThan(500);

      // DELETE — must succeed, and the row must be gone afterward.
      const delRes = await request.delete(`${API_BASE_URL}/v1/secrets/${encodeURIComponent(name)}`);
      expect([200, 204], `DELETE /v1/secrets/${name} status`).toContain(delRes.status());
      createdName = undefined;

      const final = await listSecretNames(request);
      expect(final, `${name} must be gone after DELETE`).not.toContain(name);
    } finally {
      // Belt-and-braces cleanup — if any assertion above fired before we
      // got to DELETE, still try to remove the row so we don't pollute
      // shared infra.
      if (createdName) {
        await request
          .delete(`${API_BASE_URL}/v1/secrets/${encodeURIComponent(createdName)}`)
          .catch(() => {
            /* best-effort */
          });
      }
    }
  });
});

async function listSecretNames(
  request: import('@playwright/test').APIRequestContext,
): Promise<string[]> {
  const res = await request.get(`${API_BASE_URL}/v1/secrets`);
  expect(res.status(), 'GET /v1/secrets should be 200').toBe(200);
  const body = (await res.json()) as { secrets: Array<{ name: string }> };
  return body.secrets.map((s) => s.name);
}

function randomSuffix(): string {
  // 12 hex chars — plenty of entropy, no provider/library imports.
  return Array.from({ length: 12 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
}
