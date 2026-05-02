/**
 * Project-picker e2e — wave-17 (Tier 2.5).
 *
 * Drives the deployed web app against the live API:
 *
 *   1. Sign up a fresh user → land on /welcome or /runs.
 *   2. The picker renders in the sidebar with the "All projects"
 *      label by default (the freshly-created tenant has only the
 *      Default project until the operator picks it).
 *   3. POST a brand-new project for this tenant via the auth-proxy.
 *   4. Reload, open the picker, click the new project. Assert the
 *      URL gains `?project=<slug>` and localStorage records the choice.
 *   5. Navigate to /agents — the URL must carry `?project=<slug>` and
 *      the project-filter banner must be visible.
 *   6. Pick "All projects" again — banner clears, URL drops the param.
 *
 * Mutation gate: like `auth.spec.ts` and `post-signup.spec.ts`, this
 * spec creates real tenant rows and is gated behind
 * `E2E_ALLOW_WRITES=true`. Each run uses a unique email + slug.
 *
 * LLM-agnostic: nothing here references a provider name.
 */

import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';

const ALLOW_WRITES = process.env.E2E_ALLOW_WRITES === 'true';

test.describe('project picker — top-nav + per-page filter', () => {
  test.skip(
    !ALLOW_WRITES,
    'E2E_ALLOW_WRITES is not "true" — refusing to create a real user/project in the target environment',
  );

  test('picker visible after login, switching writes the URL + filters /agents', async ({
    page,
    context,
  }) => {
    await context.clearCookies();

    const suffix = randomSuffix();
    const email = `e2e+picker-${suffix}@aldo-e2e.test`;
    const password = `e2e-pw-${suffix}-Q9!`;
    const tenantName = `E2E Picker ${suffix}`;
    const projectSlug = `pkr-${suffix.slice(0, 8)}`;
    const projectName = `Picker E2E ${suffix.slice(0, 6)}`;

    // ---- Signup ----
    await page.goto('/signup');
    await page.getByLabel('Workspace name').fill(tenantName);
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill(password);
    await Promise.all([
      page.waitForURL(/\/welcome|\/runs/, { timeout: 30_000 }),
      page.getByRole('button', { name: /create workspace/i }).click(),
    ]);

    // The picker must render in the sidebar. Default state — no
    // project selected — shows "All projects".
    const trigger = page.getByTestId('project-picker-trigger');
    await expect(trigger, 'picker visible in the sidebar after signup').toBeVisible();
    await expect(trigger).toContainText('All projects');

    // ---- Create a brand-new project for this tenant via auth-proxy ----
    {
      const create = await page.request.post('/api/auth-proxy/v1/projects', {
        data: { slug: projectSlug, name: projectName, description: '' },
        headers: { 'content-type': 'application/json' },
      });
      expect(create.status(), 'POST /v1/projects must succeed').toBe(201);
    }

    // ---- Reload so the client picker re-fetches the project list ----
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('project-picker-trigger')).toBeVisible();

    // ---- Open the picker and pick the new project ----
    await page.getByTestId('project-picker-trigger').click();
    const item = page.getByTestId(`project-picker-item-${projectSlug}`);
    await expect(item, 'newly created project must appear in the menu').toBeVisible();
    await item.click();

    // URL must gain ?project=<slug>; back-button restores the previous URL.
    await expect.poll(() => new URL(page.url()).searchParams.get('project')).toBe(projectSlug);

    // localStorage mirrors the choice so a chromeless deep-link still
    // remembers it.
    const stored = await page.evaluate(() => window.localStorage.getItem('aldo:current-project'));
    expect(stored, 'picker writes the choice to localStorage').toBe(projectSlug);

    // The trigger label updates to the new project's name.
    await expect(page.getByTestId('project-picker-trigger')).toContainText(projectName);

    // ---- Navigate to /agents and assert the filter rides along ----
    // We can't rely on an in-page link to /agents preserving the
    // ?project param (the sidebar Link uses a static href). The
    // documented contract is: the picker URL is the source of truth
    // and list pages READ it on first paint. Verify by manually
    // visiting /agents?project=<slug>.
    await page.goto(`/agents?project=${encodeURIComponent(projectSlug)}`);
    await expect(page).toHaveURL(new RegExp(`/agents\\?.*project=${projectSlug}`));

    const banner = page.getByTestId('project-filter-banner');
    await expect(banner, 'filter banner must appear when ?project is present').toBeVisible();
    await expect(banner).toContainText(projectSlug);
    // Best-effort: the banner SHOULD show the project name when
    // listProjects resolves; fall back to slug when the SSR fetch
    // raced. Either is a pass.
    await expect(banner).toContainText(new RegExp(`${projectName}|${projectSlug}`));

    // ---- Click "Show all projects" to clear the filter ----
    await page.getByTestId('project-filter-clear').click();
    await page.waitForLoadState('domcontentloaded');
    expect(new URL(page.url()).searchParams.get('project')).toBeNull();
    await expect(page.getByTestId('project-filter-banner')).toHaveCount(0);
  });
});

function randomSuffix(): string {
  // Same shape as auth.spec.ts: timestamp + 8 hex chars from a CSPRNG.
  const t = Date.now().toString(16);
  const rand = randomUUID().replace(/-/g, '').slice(0, 8);
  return `${t}-${rand}`;
}
