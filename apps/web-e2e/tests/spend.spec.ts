/**
 * Wave-4 — `/observability/spend` end-to-end smoke.
 *
 * Asserts the dashboard's load-bearing surfaces render against a real
 * server: the 4 big-number cards, the time series chart axis (a `<svg
 * role="img">` with axis ticks), at least one breakdown panel header,
 * and the Export CSV affordance. Empty + populated tenants both pass
 * because the page renders every section regardless of data presence
 * (totals == 0 still emits zero-filled buckets and the cards).
 *
 * Mutation gate: this spec creates a fresh user on every run, so it
 * requires `E2E_ALLOW_WRITES=true` like the rest of the wave-3 specs.
 *
 * LLM-agnostic: the spec never asserts on a provider name and never
 * depends on a model gateway being reachable.
 */

import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';

const ALLOW_WRITES = process.env.E2E_ALLOW_WRITES === 'true';

test.describe('cost + spend dashboard — wave 4', () => {
  test.skip(
    !ALLOW_WRITES,
    'E2E_ALLOW_WRITES is not "true" — refusing to create a real user in the target environment',
  );

  test('a fresh tenant sees cards, time series chart, and breakdown panels at /observability/spend', async ({
    page,
    context,
  }) => {
    await context.clearCookies();

    const suffix = randomSuffix();
    const email = `e2e+spend-${suffix}@aldo-e2e.test`;
    const password = `e2e-pw-${suffix}-Q9!`;
    const tenantName = `E2E Spend ${suffix}`;

    await page.goto('/signup');
    await page.getByLabel('Workspace name').fill(tenantName);
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill(password);
    await Promise.all([
      page.waitForURL(/\/welcome|\/runs/, { timeout: 30_000 }),
      page.getByRole('button', { name: /create workspace/i }).click(),
    ]);

    await page.goto('/observability/spend');

    // 4 big-number cards — Today / Week to date / Month to date / Active runs
    await expect(page.getByText('Today', { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Week to date', { exact: true })).toBeVisible();
    await expect(page.getByText('Month to date', { exact: true })).toBeVisible();
    await expect(page.getByText('Active runs', { exact: true })).toBeVisible();

    // Time series chart: an SVG with role=img labelled "Spend over time"
    // and at least one axis tick text (rendered by the niceTicks helper).
    const chart = page.getByRole('img', { name: 'Spend over time' });
    await expect(chart).toBeVisible();
    // Axis renders "$0" at minimum (the zero tick) — works for empty
    // tenants too because niceTicks always emits 0.
    const tickText = chart.locator('text', { hasText: /^\$/ });
    await expect(tickText.first()).toBeVisible();

    // At least one of the three breakdown panel headers renders.
    await expect(page.getByText('By model capability', { exact: true })).toBeVisible();
    await expect(page.getByText('By agent', { exact: true })).toBeVisible();
    await expect(page.getByText('By project', { exact: true })).toBeVisible();

    // Export CSV button is wired up.
    await expect(page.getByRole('button', { name: /export csv/i })).toBeVisible();

    // Window picker — switching to 24h re-fetches without a console
    // error. The bars get re-rendered against an hourly bucket scheme.
    await page.getByRole('button', { name: '24h' }).click();
    await expect(chart).toBeVisible();
  });
});

function randomSuffix(): string {
  const t = Date.now().toString(16);
  const rand = randomUUID().replace(/-/g, '').slice(0, 8);
  return `${t}-${rand}`;
}
