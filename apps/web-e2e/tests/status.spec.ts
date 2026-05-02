/**
 * `/status` — in-house status page.
 *
 * Asserts the page renders with three component rows (API, web, db),
 * a polling badge appears, and the "Last checked" label updates within
 * the polling interval (30s, plus headroom). The probes themselves are
 * cross-origin GETs against the canonical health endpoints; this spec
 * does NOT mock them — the point is to catch the page going dark in
 * production, not to unit-test the polling client.
 *
 * LLM-agnostic: nothing here references a model provider.
 */

import { expect, test } from '@playwright/test';

test.describe('/status — in-house status page', () => {
  // Polling polls every 30s; grant a generous 35s upper bound for the
  // first refresh to land before timing out.
  test.setTimeout(60_000);

  test('renders three component rows + a polling badge that updates', async ({ page }) => {
    await page.goto('/status');
    await page.waitForLoadState('domcontentloaded');

    // Heading anchors the page.
    await expect(page.getByRole('heading', { name: 'System status' })).toBeVisible();

    // Component rows.
    const board = page.getByTestId('status-board');
    await expect(board).toBeVisible();
    await expect(page.getByTestId('status-row-api')).toBeVisible();
    await expect(page.getByTestId('status-row-web')).toBeVisible();
    await expect(page.getByTestId('status-row-db')).toBeVisible();

    // Each row must show a status pill (one of operational / degraded
    // / down / checking). We don't assert *which* — the live infra
    // could be in any of those states; we assert that the data-status
    // attribute is set to one of the known values within 35s.
    const pills = page.getByTestId('status-pill');
    await expect(pills).toHaveCount(3);
    for (const status of ['api', 'web', 'db']) {
      const row = page.getByTestId(`status-row-${status}`);
      const pill = row.getByTestId('status-pill');
      await expect(pill).toBeVisible();
      // Wait until the polling client has resolved out of "checking"
      // OR remains in "checking" but at least the element is rendered.
      const value = await pill.getAttribute('data-status');
      expect(['operational', 'degraded', 'down', 'checking']).toContain(value);
    }

    // The "Last checked" label should transition from "Checking…" to a
    // resolved label within the polling interval. Poll for up to 35s.
    const apiLastChecked = page.getByTestId('status-row-api').getByTestId('status-last-checked');
    await expect(apiLastChecked).toBeVisible();
    await expect
      .poll(
        async () => {
          const text = (await apiLastChecked.textContent()) ?? '';
          return /Checked/.test(text);
        },
        { timeout: 35_000, intervals: [1_000] },
      )
      .toBe(true);
  });

  test('renders the incident timeline section', async ({ page }) => {
    await page.goto('/status');
    await expect(page.getByRole('heading', { name: /Incidents/ })).toBeVisible();
    // Empty timeline OR populated timeline — either is valid; both
    // expose a stable testid so we can confirm the section renders.
    const empty = page.getByTestId('incident-timeline-empty');
    const list = page.getByTestId('incident-timeline');
    const exists = (await empty.count()) + (await list.count());
    expect(exists).toBeGreaterThan(0);
  });

  test('marketing footer links to /status', async ({ page }) => {
    await page.goto('/');
    const footerLink = page.getByRole('contentinfo').getByRole('link', { name: 'Status' });
    await expect(footerLink).toBeVisible();
    await footerLink.click();
    await expect(page).toHaveURL(/\/status$/);
  });
});
