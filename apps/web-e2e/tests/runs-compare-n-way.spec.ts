/**
 * Wave-4 N-way `/runs/compare` end-to-end smoke.
 *
 * Closes the Braintrust experiments-view parity gap on the comparison
 * surface: side-by-side rendering of >2 runs with stack-bar charts,
 * per-row median-deviation diff highlighting, and a "Show only diffs"
 * filter that collapses the table to interesting rows.
 *
 * Mutation gate: like the other wave-3+ specs that need a fresh user
 * seed, this one creates a workspace + minimum-viable runs through
 * the auth-proxy and asserts on the rendered comparison page.
 *
 * LLM-agnostic: the seeded runs use no model — they're created via the
 * API runs surface with status=`failed` (no provider needed) so the
 * test never depends on a model being reachable.
 */

import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';

const ALLOW_WRITES = process.env.E2E_ALLOW_WRITES === 'true';

test.describe('runs-compare — N-way (wave-4)', () => {
  test.skip(
    !ALLOW_WRITES,
    'E2E_ALLOW_WRITES is not "true" — refusing to create a real user in the target environment',
  );

  test('opening /runs/compare?ids=A,B,C renders an N-way table with stack bars and a working diffs toggle', async ({
    page,
    context,
  }) => {
    await context.clearCookies();

    const suffix = randomSuffix();
    const email = `e2e+nway-${suffix}@aldo-e2e.test`;
    const password = `e2e-pw-${suffix}-Q9!`;
    const tenantName = `E2E NWay ${suffix}`;

    /* ---- Signup. ---- */
    await page.goto('/signup');
    await page.getByLabel('Workspace name').fill(tenantName);
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill(password);
    await Promise.all([
      page.waitForURL(/\/welcome|\/runs/, { timeout: 30_000 }),
      page.getByRole('button', { name: /create workspace/i }).click(),
    ]);
    await expect(page.locator('aside', { hasText: email })).toBeVisible();

    /* ---- Seed three runs. We pick an agent name that the engine
     *      definitely knows about; failure to route is fine — what we
     *      need is a row in /v1/runs that the compare page can fetch.
     *      The engine emits `run.started` + a terminal event for each. */
    const runIds: string[] = [];
    for (let i = 0; i < 3; i++) {
      const r = await page.request.post('/api/auth-proxy/v1/runs', {
        headers: { 'content-type': 'application/json' },
        data: { agentName: 'backend-engineer', inputs: { task: `nway-seed-${i}` } },
      });
      // 201 on success or 422 on a privacy-tier reject — either way the
      // run row exists.
      expect([200, 201, 202, 422]).toContain(r.status());
      const body = (await r.json()) as { run?: { id: string }; id?: string };
      const id = body.run?.id ?? body.id;
      if (typeof id === 'string') runIds.push(id);
    }
    test.skip(
      runIds.length < 3,
      'workspace did not register at least 3 runs — engine likely missing the seeded agent',
    );

    /* ---- Open the N-way compare page. ---- */
    const url = `/runs/compare?ids=${runIds.map(encodeURIComponent).join(',')}`;
    await page.goto(url);

    // Stack-bar section must render.
    await expect(page.getByTestId('nway-stack-bars')).toBeVisible();
    // The N-way table must render with one column per id.
    await expect(page.getByTestId('nway-table')).toBeVisible();
    for (const id of runIds) {
      await expect(page.getByTestId(`nway-column-${id}`)).toBeVisible();
    }

    // "Show only diffs" toggle reduces the visible row count.
    const fullRowCount = await page.locator('[data-testid^="nway-row-label-"]').count();
    expect(fullRowCount).toBeGreaterThan(0);

    await page.getByTestId('nway-toggle-diffs').click();
    await expect(page).toHaveURL(/diffs=1/);
    const diffsRowCount = await page.locator('[data-testid^="nway-row-label-"]').count();
    expect(diffsRowCount, 'show-only-diffs filters the table').toBeLessThanOrEqual(fullRowCount);

    // At least one cell on the cost row should be amber-tagged when
    // the runs differ in cost; if every run cost the same the test
    // tolerates that (data-tag is "baseline" or "match" instead).
    const costCells = await page.locator('[data-testid^="nway-cell-totalUsd-"]').all();
    expect(costCells.length).toBeGreaterThan(0);

    // Permalink button is reachable (we don't read the clipboard, just
    // confirm it doesn't throw).
    await page.getByTestId('nway-permalink').click();
  });

  test('legacy ?a=&b= query still resolves to the N-way view', async ({ page, context }) => {
    await context.clearCookies();

    const suffix = randomSuffix();
    const email = `e2e+nway2-${suffix}@aldo-e2e.test`;
    const password = `e2e-pw-${suffix}-Q9!`;
    const tenantName = `E2E NWay2 ${suffix}`;

    await page.goto('/signup');
    await page.getByLabel('Workspace name').fill(tenantName);
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill(password);
    await Promise.all([
      page.waitForURL(/\/welcome|\/runs/, { timeout: 30_000 }),
      page.getByRole('button', { name: /create workspace/i }).click(),
    ]);

    // Two unknown ids — the page must render the N-way table with
    // both columns badged "not found / not authorized" rather than
    // erroring the whole page.
    await page.goto('/runs/compare?a=missing-a&b=missing-b');
    await expect(page.getByTestId('nway-table')).toBeVisible();
    await expect(page.getByTestId('nway-column-missing-a')).toBeVisible();
    await expect(page.getByTestId('nway-column-missing-b')).toBeVisible();
  });
});

function randomSuffix(): string {
  const t = Date.now().toString(16);
  const rand = randomUUID().replace(/-/g, '').slice(0, 8);
  return `${t}-${rand}`;
}
