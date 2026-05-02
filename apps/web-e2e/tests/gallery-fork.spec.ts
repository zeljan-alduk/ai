/**
 * Gallery per-template fork (wave-3) — browser e2e.
 *
 * Drives the deployed web app:
 *   1. Sign up a fresh user (workspace seed leaves /agents empty).
 *   2. Navigate to /gallery and click the per-card "Fork into project"
 *      button on the backend-engineer card.
 *   3. Assert the success banner appears with a link to the new agent.
 *   4. Navigate to /agents and assert a row for `backend-engineer`
 *      shows up — the proof that fork persisted to the registry.
 *
 * Mutation gate: this spec creates a user + writes to the registry.
 * Like `auth.spec.ts` and `post-signup.spec.ts`, it gates on
 * `E2E_ALLOW_WRITES=true`.
 *
 * LLM-agnostic: never asserts on a provider name. Capability + privacy
 * tier are spec-level concerns; the fork only carries them through.
 */

import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';

const ALLOW_WRITES = process.env.E2E_ALLOW_WRITES === 'true';

test.describe('gallery — per-template fork (wave-3)', () => {
  test.skip(
    !ALLOW_WRITES,
    'E2E_ALLOW_WRITES is not "true" — refusing to create a user / write to the registry',
  );

  test('forking the backend-engineer card lands a row in /agents', async ({ page, context }) => {
    await context.clearCookies();

    const suffix = randomSuffix();
    const email = `e2e+gallery-${suffix}@aldo-e2e.test`;
    const password = `e2e-pw-${suffix}-Q9!`;
    const tenantName = `E2E Gallery ${suffix}`;

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

    // ---- /gallery ----
    await page.goto('/gallery');
    // The wave-3 fork-button data-testid is `gallery-fork-<templateId>`.
    // Backend-engineer is one of the 8 hand-curated templates that
    // have shipped in the gallery since wave-7.5.
    const forkBtn = page.getByTestId('gallery-fork-backend-engineer');
    await expect(forkBtn, 'fork button must render on the backend-engineer card').toBeVisible();
    await forkBtn.click();

    // Success banner is the in-card status with a link to the new
    // agent. We assert on the link's text rather than the wrapping
    // banner to ride out small token / classname tweaks.
    const link = page.getByTestId('gallery-fork-link-backend-engineer');
    await expect(link, 'success link to forked agent must appear').toBeVisible({
      timeout: 15_000,
    });
    const href = await link.getAttribute('href');
    expect(href, 'fork link must point at /agents/<name>').toMatch(/^\/agents\/backend-engineer/);

    // ---- /agents — the row must be there ----
    await page.goto('/agents');
    // We don't assert on a specific layout (table vs. cards); just that
    // the agent name appears somewhere on the page. The /agents page
    // lists every agent in the tenant; if the fork persisted, the
    // backend-engineer name will be there.
    await expect(page.getByText('backend-engineer', { exact: false }).first()).toBeVisible({
      timeout: 15_000,
    });

    // ---- Re-fork to exercise slug-collision rotation ----
    await page.goto('/gallery');
    const refork = page.getByTestId('gallery-fork-backend-engineer');
    await refork.click();
    const refLink = page.getByTestId('gallery-fork-link-backend-engineer');
    await expect(refLink).toBeVisible({ timeout: 15_000 });
    const refHref = await refLink.getAttribute('href');
    // The server resolves the collision by appending `-2` (or higher
    // when there's already a `-2`). The link's href encodes the
    // resolved name, so we just assert it carries the suffix.
    expect(refHref, 'second fork must rotate to a `-N` slug').toMatch(
      /^\/agents\/backend-engineer-\d+/,
    );
  });
});

function randomSuffix(): string {
  // Same shape as auth.spec.ts: timestamp + 8 hex chars from a CSPRNG.
  const t = Date.now().toString(16);
  const rand = randomUUID().replace(/-/g, '').slice(0, 8);
  return `${t}-${rand}`;
}
