/**
 * Wave-18 (Tier 3.5) — Git integration e2e.
 *
 * Flow:
 *   1. Sign up a fresh user.
 *   2. Visit /integrations/git → empty state visible.
 *   3. POST /v1/integrations/git/repos via the auth-proxy with a fake
 *      owner+repo. Confirm the response carries the one-time webhook
 *      secret and URL.
 *   4. Reload /integrations/git → the connected repo row is visible.
 *   5. GET the repo's /sync endpoint via the auth-proxy. Because the
 *      backing GitHub repo doesn't exist, the response is `failed` —
 *      we assert on the structured envelope rather than on agent
 *      registration. Real-API success is exercised in the unit tests.
 *
 * Mutation gate mirrors `post-signup.spec.ts`.
 */

import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';

const ALLOW_WRITES = process.env.E2E_ALLOW_WRITES === 'true';

function randomSuffix(): string {
  const t = Date.now().toString(16);
  const rand = randomUUID().replace(/-/g, '').slice(0, 8);
  return `${t}-${rand}`;
}

test.describe('Git integration — connect + list', () => {
  test.skip(
    !ALLOW_WRITES,
    'E2E_ALLOW_WRITES is not "true" — refusing to create a real user',
  );

  test('user can connect a repo and see it on /integrations/git', async ({ page, context }) => {
    await context.clearCookies();

    const suffix = randomSuffix();
    const email = `e2e+git-${suffix}@aldo-e2e.test`;
    const password = `e2e-pw-${suffix}-Q9!`;
    const tenantName = `E2E Git ${suffix}`;

    // Sign up.
    await page.goto('/signup');
    await page.getByLabel('Workspace name').fill(tenantName);
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill(password);
    await Promise.all([
      page.waitForURL(/\/welcome|\/runs/, { timeout: 30_000 }),
      page.getByRole('button', { name: /create workspace/i }).click(),
    ]);

    // Empty-state on /integrations/git.
    await page.goto('/integrations/git');
    await expect(page.getByRole('heading', { name: /git integration/i })).toBeVisible();
    await expect(page.getByText(/no connected repos yet/i)).toBeVisible();

    // Connect via the auth-proxy (skip the form to keep the spec
    // focused on the API contract; the form is a thin wrapper over
    // this endpoint).
    const repoOwner = `e2e-${suffix.slice(0, 6)}`;
    const repoName = 'agents';
    const connect = await page.request.post('/api/auth-proxy/v1/integrations/git/repos', {
      data: {
        project: 'default',
        provider: 'github',
        repoOwner,
        repoName,
        defaultBranch: 'main',
        specPath: 'aldo/agents',
        // No accessToken — the sync will fail at fetch time but the
        // connect path doesn't validate the repo exists.
      },
      headers: { 'content-type': 'application/json' },
    });
    expect(connect.status(), 'POST /v1/integrations/git/repos must succeed').toBe(201);
    const connectBody = (await connect.json()) as {
      repo: { id: string; provider: string; repoOwner: string };
      webhookSecret: string;
      webhookUrl: string;
    };
    expect(connectBody.repo.repoOwner).toBe(repoOwner);
    expect(connectBody.webhookSecret.length).toBeGreaterThan(20);
    expect(connectBody.webhookUrl).toContain(`/v1/webhooks/git/github/${connectBody.repo.id}`);

    // Refresh the list page — the new row should appear.
    await page.goto('/integrations/git');
    await expect(page.locator('table')).toContainText(`${repoOwner}/${repoName}`);

    // Trigger a sync. Because the real GitHub repo doesn't exist, the
    // sync fails — we assert on the response envelope, not on the
    // outcome.
    const sync = await page.request.post(
      `/api/auth-proxy/v1/integrations/git/repos/${connectBody.repo.id}/sync`,
      {
        data: {},
        headers: { 'content-type': 'application/json' },
      },
    );
    expect(sync.status()).toBe(200);
    const syncBody = (await sync.json()) as { status: string; error: string | null };
    // Either 'ok' (lucky — the API returned an empty tree) or 'failed'
    // (404 from GitHub for the bogus repo). Both prove the sync code
    // path runs end-to-end.
    expect(['ok', 'failed']).toContain(syncBody.status);
  });
});
