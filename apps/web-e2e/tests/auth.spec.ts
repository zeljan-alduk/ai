/**
 * Auth flow e2e spec — wave 10.
 *
 * Drives the deployed web app against the live API:
 *
 *   1. Visit `/` unauthenticated → expect a redirect to `/login`.
 *   2. Sign up with a fresh email → land on `/welcome` (or `/runs` if
 *      the tenant already happens to have agents).
 *   3. Log out from the sidebar user menu → land on `/login`.
 *   4. Log in with the same credentials → back on `/runs` (or the
 *      welcome stub if the tenant is still empty — both are valid
 *      post-auth landings).
 *
 * Mutation steps (signup writes a user + tenant row) are gated behind
 * `E2E_ALLOW_WRITES=true` so we never leave dangling test users in
 * shared infra. Each run uses a unique email per the brief.
 *
 * LLM-agnostic: this spec never asserts on a provider name.
 */

import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';

const ALLOW_WRITES = process.env.E2E_ALLOW_WRITES === 'true';

test.describe('auth — unauthenticated guard', () => {
  test('GET / unauthenticated renders the marketing site (200, no redirect)', async ({
    page,
    context,
  }) => {
    // Belt-and-braces: blow away any stray cookies before we navigate
    // so the guard actually sees an unauthenticated request.
    await context.clearCookies();
    const res = await page.goto('/', { waitUntil: 'domcontentloaded' });
    expect(res?.status() ?? 0, 'home should not 5xx').toBeLessThan(500);
    // Wave-A/B (2026-04-27) flipped `/` from an auth-required redirect
    // into the public marketing site. The headline + Sign-up CTA must
    // render; we should NOT bounce to /login.
    await expect(page).toHaveURL(/^https?:\/\/[^/]+\/?$/);
    await expect(
      page.getByRole('heading', { name: /run real software-engineering/i }),
    ).toBeVisible();
    await expect(page.getByRole('link', { name: /start free trial/i }).first()).toBeVisible();
  });

  test('GET /agents unauthenticated redirects with next= preserved', async ({ page, context }) => {
    await context.clearCookies();
    await page.goto('/agents');
    await expect(page).toHaveURL(/\/login\?.*next=/);
    const url = page.url();
    expect(url).toContain(`next=${encodeURIComponent('/agents')}`);
  });
});

test.describe('auth — signup → logout → login flow', () => {
  test.skip(
    !ALLOW_WRITES,
    'E2E_ALLOW_WRITES is not "true" — refusing to create a real user in the target environment',
  );

  test('signup → /welcome (or /runs), logout → /login, login → /runs (or /welcome)', async ({
    page,
    context,
  }) => {
    await context.clearCookies();

    const email = uniqueEmail();
    const password = uniquePassword();
    const tenantName = `E2E Workspace ${randomSuffix()}`;

    // ---- Signup ----
    await page.goto('/signup');
    await expect(page.getByText('Create your workspace', { exact: false })).toBeVisible();

    await page.getByLabel('Workspace name').fill(tenantName);
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill(password);
    await Promise.all([
      page.waitForURL(/\/welcome|\/runs/, { timeout: 30_000 }),
      page.getByRole('button', { name: /create workspace/i }).click(),
    ]);

    // Either landing page is fine. Both must render the sidebar (so
    // the user menu is reachable for the logout step) and one of the
    // expected page titles.
    expect(page.url()).toMatch(/\/welcome|\/runs/);
    await expect(page.getByText('ALDO AI', { exact: true })).toBeVisible();

    // ---- Logout ----
    // Open the user-menu dropdown — the trigger is the button in the
    // sidebar footer that contains the user's email.
    const userMenuTrigger = page.locator('aside button', { hasText: email });
    await expect(userMenuTrigger).toBeVisible();
    await userMenuTrigger.click();

    await Promise.all([
      page.waitForURL(/\/login(\?|$)/, { timeout: 30_000 }),
      page.getByRole('button', { name: /log out/i }).click(),
    ]);

    // ---- Login ----
    // Use the heading role to disambiguate from the submit button —
    // both render the literal text "Sign in".
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill(password);
    await Promise.all([
      page.waitForURL(/\/welcome|\/runs/, { timeout: 30_000 }),
      page.getByRole('button', { name: /sign in/i }).click(),
    ]);

    expect(page.url()).toMatch(/\/welcome|\/runs/);
    // Confirm the session is real by checking the sidebar shows the
    // user's email again.
    await expect(page.locator('aside', { hasText: email })).toBeVisible();
  });
});

function randomSuffix(): string {
  // 12 hex chars + a millisecond-precision timestamp so two parallel
  // CI runs of the same spec can't collide on email or workspace name.
  // Uses crypto.randomUUID for the random part — Math.random was
  // flagged by CodeQL as unsafe in a security context (passwords).
  const t = Date.now().toString(16);
  const rand = randomUUID().replace(/-/g, '').slice(0, 8);
  return `${t}-${rand}`;
}

function uniqueEmail(): string {
  return `e2e+auth-${randomSuffix()}@aldo-e2e.test`;
}

function uniquePassword(): string {
  // 24 chars — well above the 12-char minimum the API enforces.
  return `e2e-pw-${randomSuffix()}-Q9!`;
}
