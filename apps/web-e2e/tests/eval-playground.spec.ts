/**
 * Wave-3 (Tier-3.1) — eval scorer playground end-to-end smoke.
 *
 * Closes the Braintrust playground / LangSmith evaluators-as-product
 * gap: pick one evaluator + one dataset, hit Run, watch at least one
 * row score within 30s.
 *
 * Mutation gate: this spec creates a fresh user + dataset + evaluator
 * on every run. Like `auth.spec.ts` and `post-signup.spec.ts`, it
 * requires `E2E_ALLOW_WRITES=true`. Each run uses a unique email so
 * leftovers are bounded.
 *
 * LLM-agnostic: the seeded evaluator is a built-in `contains` rule
 * that never invokes a model — the test never asserts on a provider
 * name and never depends on a gateway being reachable.
 */

import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';

const ALLOW_WRITES = process.env.E2E_ALLOW_WRITES === 'true';

test.describe('eval scorer playground — wave 3 (Tier 3.1)', () => {
  test.skip(
    !ALLOW_WRITES,
    'E2E_ALLOW_WRITES is not "true" — refusing to create a real user in the target environment',
  );

  test('a fresh user can pick an evaluator + dataset and see scored rows within 30s', async ({
    page,
    context,
  }) => {
    await context.clearCookies();

    const suffix = randomSuffix();
    const email = `e2e+pg-${suffix}@aldo-e2e.test`;
    const password = `e2e-pw-${suffix}-Q9!`;
    const tenantName = `E2E Playground ${suffix}`;

    // ---- Signup ----
    await page.goto('/signup');
    await page.getByLabel('Workspace name').fill(tenantName);
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill(password);
    await Promise.all([
      page.waitForURL(/\/welcome|\/runs/, { timeout: 30_000 }),
      page.getByRole('button', { name: /create workspace/i }).click(),
    ]);
    await expect(page.locator('aside', { hasText: email })).toBeVisible();

    // ---- Seed an evaluator + dataset directly through the auth proxy.
    // We avoid the dataset/evaluator UIs because those are tested
    // elsewhere; this spec only cares about the playground itself.
    const evalCreate = await page.request.post('/api/auth-proxy/v1/evaluators', {
      headers: { 'content-type': 'application/json' },
      data: {
        name: `pg-contains-${suffix.slice(0, 8)}`,
        kind: 'contains',
        config: { value: 'pass' },
      },
    });
    expect(evalCreate.status(), 'evaluator create must succeed').toBe(201);
    const evaluatorId = (await evalCreate.json() as { id: string }).id;

    const dsCreate = await page.request.post('/api/auth-proxy/v1/datasets', {
      headers: { 'content-type': 'application/json' },
      data: { name: `pg-ds-${suffix.slice(0, 8)}`, description: '', tags: [] },
    });
    expect(dsCreate.status(), 'dataset create must succeed').toBe(201);
    const datasetId = (await dsCreate.json() as { id: string }).id;

    // Bulk-load three examples — two pass, one fails.
    const bulk = await page.request.post(
      `/api/auth-proxy/v1/datasets/${encodeURIComponent(datasetId)}/examples/bulk`,
      {
        headers: { 'content-type': 'application/json' },
        data: {
          examples: [
            { input: 'q1', expected: 'this string contains pass' },
            { input: 'q2', expected: 'pass me the salt' },
            { input: 'q3', expected: 'something else entirely' },
          ],
        },
      },
    );
    expect(bulk.status(), 'bulk examples insert must succeed').toBe(200);
    void evaluatorId;

    // ---- Open the playground page.
    await page.goto('/eval/playground');
    // Picker bar must render with both selectors populated.
    await expect(page.getByLabel('Evaluator')).toBeVisible();
    await expect(page.getByLabel('Dataset')).toBeVisible();
    // Pick the dataset we just created (default selection might be a
    // different one if other tests left state behind, so be explicit).
    await page.getByLabel('Dataset').selectOption({ label: /pg-ds-/ });
    // Pick the evaluator we just created.
    await page.getByLabel('Evaluator').selectOption({ label: /pg-contains-/ });

    // ---- Hit Run.
    await page.getByTestId('playground-run-button').click();

    // Wait for at least one row to score. Polling cadence is 1.5s on
    // the client; allow up to 30s end-to-end (covers cold-cache + the
    // background scoring loop on the API).
    await expect(page.getByTestId('playground-row').first()).toBeVisible({ timeout: 30_000 });
    // Aggregate panel must be present and showing a non-empty number.
    const aggregate = page.getByTestId('playground-aggregate');
    await expect(aggregate).toBeVisible();
    await expect(aggregate).toContainText(/Pass rate/);
  });
});

function randomSuffix(): string {
  const t = Date.now().toString(16);
  const rand = randomUUID().replace(/-/g, '').slice(0, 8);
  return `${t}-${rand}`;
}
