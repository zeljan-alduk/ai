/**
 * Wave-4 (Tier-4) — prompts as first-class entities, end-to-end smoke.
 *
 * Closes Vellum (entire product) + LangSmith Hub gap. Walks a real
 * user through:
 *   1. Sign up (fresh tenant)
 *   2. Open /prompts/new and create a prompt with a {{variable}} body
 *   3. Land on /prompts/[id], see v1 in the version history
 *   4. Edit -> create v2 (with mandatory commit message)
 *   5. Switch to the Diff tab, see v1↔v2 with non-zero added/removed
 *   6. Switch to the Playground tab, fill a variable, hit Run, see output
 *
 * Mutation gate: like the other write-bearing specs, only runs when
 * `E2E_ALLOW_WRITES=true`. Each run uses a unique email so leftovers
 * are bounded.
 *
 * LLM-agnostic: the prompt's body is variable-only; the test never
 * asserts on a provider name. The /v1/prompts/:id/test runner stub
 * (the route's default) returns a deterministic echo string we can
 * grep on.
 */

import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';

const ALLOW_WRITES = process.env.E2E_ALLOW_WRITES === 'true';

test.describe('prompts — wave 4 (Tier 4)', () => {
  test.skip(
    !ALLOW_WRITES,
    'E2E_ALLOW_WRITES is not "true" — refusing to create a real user in the target environment',
  );

  test('a fresh user can create, version, diff, and run a prompt', async ({ page, context }) => {
    await context.clearCookies();
    test.setTimeout(120_000);

    const suffix = randomSuffix();
    const email = `e2e+pmt-${suffix}@aldo-e2e.test`;
    const password = `e2e-pw-${suffix}-Q9!`;
    const tenantName = `E2E Prompts ${suffix}`;
    const promptName = `e2e-prompt-${suffix.slice(0, 8)}`;

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

    // ---- Sidebar entry exists.
    await expect(page.getByRole('link', { name: 'Prompts', exact: true })).toBeVisible();

    // ---- Empty state on first /prompts visit.
    await page.goto('/prompts');
    await expect(page.getByRole('heading', { name: /No prompts in this tenant/ })).toBeVisible();

    // ---- Create v1.
    await page.getByRole('link', { name: /create your first prompt/i }).click();
    await page.waitForURL(/\/prompts\/new/);
    await page.getByTestId('prompt-name-input').fill(promptName);
    await page.getByTestId('prompt-body-input').fill('hello {{name}}, welcome to {{place}}');
    await page.getByTestId('prompt-create-submit').click();
    await page.waitForURL(/\/prompts\/pmt_/, { timeout: 15_000 });

    // ---- Detail page shows v1 in history.
    await expect(page.getByTestId('version-row-1')).toBeVisible();
    await expect(page.getByTestId('prompt-body-display')).toContainText('hello');

    // ---- Edit -> v2.
    await page.getByRole('link', { name: /Edit \(creates v2\)/ }).click();
    await page.waitForURL(/\/prompts\/pmt_.*\/edit/);
    const bodyEditor = page.getByTestId('editor-body');
    await bodyEditor.fill('hello {{name}}, welcome to {{place}}\n\nNote: be concise.');
    await page.getByTestId('editor-notes').fill('add concise instruction');
    await page.getByTestId('editor-save').click();
    await page.waitForURL(/\/prompts\/pmt_[^/]+$/, { timeout: 15_000 });

    // ---- Both versions in history.
    await expect(page.getByTestId('version-row-2')).toBeVisible();
    await expect(page.getByTestId('version-row-1')).toBeVisible();

    // ---- Switch to Diff tab; expect non-zero added.
    await page.getByRole('tab', { name: 'Diff' }).click();
    const diffDisplay = page.getByTestId('diff-display');
    await expect(diffDisplay).toBeVisible({ timeout: 10_000 });
    await expect(diffDisplay).toContainText(/concise/);

    // ---- Switch to Playground tab; run the prompt against v2.
    await page.getByRole('tab', { name: 'Playground' }).click();
    await page.getByTestId('var-input-name').fill('alice');
    await page.getByTestId('var-input-place').fill('aldo');
    await page.getByTestId('run-playground').click();

    // The default route runner echoes a deterministic string that
    // includes the resolved body. Verify the output area populated.
    await expect(page.locator('pre', { hasText: /alice/ })).toBeVisible({ timeout: 15_000 });
  });
});

function randomSuffix(): string {
  const t = Date.now().toString(16);
  const rand = randomUUID().replace(/-/g, '').slice(0, 8);
  return `${t}-${rand}`;
}
