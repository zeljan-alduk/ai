/**
 * Wave-19 — threads + annotations + sharing end-to-end smoke.
 *
 * Closes the LangSmith parity wave: a thread surfaces its runs as a
 * chat-style transcript, an operator can leave a thumbs-up + a comment
 * inline, and the run can be shared via a public read-only link that
 * deliberately strips annotations + per-call usage records.
 *
 * Mutation gate: like the wave-3+ specs that touch a real workspace,
 * this one signs up a fresh user + creates rows through the auth-proxy
 * and asserts on the rendered surfaces.
 *
 * LLM-agnostic: the seeded runs use no model — they're created via the
 * API runs surface with status terminal (no provider needed) so the
 * test never depends on a model being reachable.
 */

import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';

const ALLOW_WRITES = process.env.E2E_ALLOW_WRITES === 'true';

test.describe('threads + annotations + sharing — wave-19', () => {
  test.skip(
    !ALLOW_WRITES,
    'E2E_ALLOW_WRITES is not "true" — refusing to create a real user in the target environment',
  );

  test('annotate a run, share it, open the shared URL incognito → annotations + usage stripped', async ({
    page,
    browser,
    context,
  }) => {
    await context.clearCookies();

    const suffix = randomSuffix();
    const email = `e2e+threads-${suffix}@aldo-e2e.test`;
    const password = `e2e-pw-${suffix}-Z3!`;
    const tenantName = `E2E Threads ${suffix}`;

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

    /* ---- Seed a single run we'll annotate + share. ---- */
    const create = await page.request.post('/api/auth-proxy/v1/runs', {
      headers: { 'content-type': 'application/json' },
      data: { agentName: 'backend-engineer', inputs: { task: `thread-e2e-${suffix}` } },
    });
    expect(create.status()).toBe(201);
    const created = (await create.json()) as { run: { id: string } };
    const runId = created.run.id;

    /* ---- Open the run, post a thumbs + a comment. ---- */
    await page.goto(`/runs/${encodeURIComponent(runId)}`);
    // Header thumbs-up.
    const thumbsUp = page.getByRole('button', { name: /thumbs up/i }).first();
    await thumbsUp.click();
    await expect(thumbsUp).toHaveAttribute('aria-pressed', 'true', { timeout: 10_000 });

    // Move into the Annotations tab and leave a comment.
    await page.getByRole('tab', { name: /annotations/i }).click();
    const composer = page.getByLabel(/Add a comment/i);
    await composer.fill(`E2E thread comment ${suffix}`);
    await page.getByRole('button', { name: /^Comment$/ }).click();
    await expect(page.getByText(`E2E thread comment ${suffix}`)).toBeVisible({ timeout: 10_000 });

    /* ---- Mint a share via the API surface (the dialog UI exercises the
     *      same endpoint; calling it directly keeps the e2e narrow on the
     *      public-read assertion below). ---- */
    const share = await page.request.post('/api/auth-proxy/v1/shares', {
      headers: { 'content-type': 'application/json' },
      data: { targetKind: 'run', targetId: runId, expiresInHours: 24 },
    });
    expect(share.status()).toBe(201);
    const shareJson = (await share.json()) as {
      share: { slug: string; url: string };
    };
    expect(shareJson.share.slug.startsWith('share_')).toBe(true);

    /* ---- Open the share URL in an INCOGNITO context. The public
     *      viewer must not surface annotations or per-call usage. ---- */
    const incognito = await browser.newContext();
    const publicPage = await incognito.newPage();
    await publicPage.goto(`/share/${shareJson.share.slug}`);

    // The shared run header is the run id (truncated) — assert it
    // rendered something recognisable.
    await expect(publicPage.locator('body')).toContainText(runId.slice(0, 8), {
      timeout: 10_000,
    });

    // Annotations MUST NOT bleed across — the comment text we left
    // above is private to the tenant.
    await expect(publicPage.locator('body')).not.toContainText(
      `E2E thread comment ${suffix}`,
    );
    // The Annotations tab itself MUST NOT render in the public view.
    await expect(publicPage.getByRole('tab', { name: /annotations/i })).toHaveCount(0);

    // The Usage table is suppressed in the public payload — it lives
    // on the authed surface only.
    await expect(publicPage.locator('table thead', { hasText: /Tokens in/i })).toHaveCount(
      0,
    );

    await incognito.close();
  });
});

function randomSuffix(): string {
  return randomUUID().replace(/-/g, '').slice(0, 10);
}
