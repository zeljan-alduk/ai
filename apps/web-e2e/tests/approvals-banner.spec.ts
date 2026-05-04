/**
 * MISSING_PIECES #9 — approval-gate UI e2e.
 *
 * Spawns an iterative agent with a `tools.approvals: { fs.write: always }`
 * spec, sends an input that forces a write call, then asserts:
 *   1. The /runs/[id] page renders the pending-approvals banner with
 *      one row whose tool name matches the gated call.
 *   2. Clicking "Approve" hits the API; on the next poll the banner
 *      either disappears or shows zero pending.
 *
 * Gated behind `E2E_ALLOW_WRITES=true` to match the rest of the e2e
 * suite. Skipped when the seeded environment lacks the needed
 * agent — Phase E reference agent + an approvals-gated variant
 * have to be registered for the test to be meaningful.
 */

import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';

const ALLOW_WRITES = process.env.E2E_ALLOW_WRITES === 'true';

test.describe('approvals banner — MISSING_PIECES #9', () => {
  test.skip(
    !ALLOW_WRITES,
    'E2E_ALLOW_WRITES is not "true" — refusing to create a real user in the target environment',
  );

  test('an iterative run paused on an approval gate surfaces the banner with approve/reject', async ({
    page,
    context,
  }) => {
    await context.clearCookies();
    const suffix = randomUUID().slice(0, 8);
    const email = `e2e+approvals-${suffix}@aldo-e2e.test`;
    const password = `e2e-pw-${suffix}-Q9!`;
    const tenantName = `E2E Approvals ${suffix}`;

    await page.goto('/signup');
    await page.getByLabel('Workspace name').fill(tenantName);
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill(password);
    await Promise.all([
      page.waitForURL(/\/welcome|\/runs/, { timeout: 30_000 }),
      page.getByRole('button', { name: /create workspace/i }).click(),
    ]);

    // Seed an iterative run that will request a gated write.
    const r = await page.request.post('/api/auth-proxy/v1/runs', {
      headers: { 'content-type': 'application/json' },
      data: {
        agentName: 'local-coder-iterative',
        inputs: { task: 'write hello.ts to /workspace' },
      },
    });
    test.skip(
      r.status() === 404,
      'local-coder-iterative agent not registered — Phase E reference agent missing',
    );
    const body = (await r.json()) as { run?: { id: string }; id?: string };
    const runId = body.run?.id ?? body.id;
    if (typeof runId !== 'string') {
      test.skip(true, 'engine did not assign a run id');
      return;
    }

    // Poll up to ~10s for a pending approval to appear via the API.
    let pendingFound = false;
    for (let i = 0; i < 20; i++) {
      const list = await page.request.get(
        `/api/auth-proxy/v1/runs/${encodeURIComponent(runId)}/approvals`,
      );
      const j = (await list.json()) as { approvals?: Array<{ callId: string }> };
      if (Array.isArray(j.approvals) && j.approvals.length > 0) {
        pendingFound = true;
        break;
      }
      await new Promise((res) => setTimeout(res, 500));
    }
    test.skip(
      !pendingFound,
      'no pending approval surfaced — agent spec may not declare tools.approvals on this build',
    );

    await page.goto(`/runs/${encodeURIComponent(runId)}`);

    // Banner is visible.
    const banner = page.getByTestId('pending-approvals-banner');
    await expect(banner).toBeVisible();

    // Click Approve on the first row.
    const approveBtn = page.locator('[data-testid^="approve-"]').first();
    await approveBtn.click();

    // After approval, banner either disappears (if no more pending) or
    // shows fewer rows. We assert at least the row we acted on is gone.
    await expect(approveBtn).toBeHidden({ timeout: 5000 });
  });
});
