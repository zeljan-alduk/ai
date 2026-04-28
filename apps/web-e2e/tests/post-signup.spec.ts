/**
 * Post-signup regression spec — covers three production bugs caught by
 * a manual chrome-mcp e2e on 2026-04-28. Without this spec, the next
 * wave can re-break any of them while unit tests + typechecks stay
 * green.
 *
 * The bugs (commit 7d80780):
 *
 *  1. nginx vhost routed /api/auth-proxy/* to aldo_api instead of
 *     aldo_web. Effect: every client-side authenticated fetch through
 *     the proxy 401'd. Pages rendered fine because server components
 *     read the session via getSession() directly — but client islands
 *     (notifications poll, project create dialog, save-as-eval-row)
 *     all silently failed.
 *
 *  2. tour-provider's TourBridge dispatched `aldo:tour:step` with
 *     detail=0 on every layout mount. The parent listener ignored
 *     tour-active state and called router.push(STEPS[0].route) — i.e.
 *     `/welcome`. Effect: a brand-new user who clicked any sidebar
 *     link or typed any URL got snapped back to /welcome.
 *
 *  3. apps/api/src/projects-store toWire() returned `pg`-deserialised
 *     Date objects for createdAt/updatedAt while the Zod wire schema
 *     expected ISO strings. Effect: GET /v1/projects 400'd
 *     ("Expected string, received date"); the /projects page never
 *     listed any project, even after a successful create.
 *
 * All three were silent — no JS errors, no 5xx, no failing unit tests.
 * Only an in-browser walkthrough surfaced them. This spec is the
 * automated version of that walkthrough.
 *
 * Mutation gate: this spec creates a fresh user on every run. Like
 * `auth.spec.ts`, it requires `E2E_ALLOW_WRITES=true`. Each run uses
 * a unique email so leftovers are bounded; CI cleanup is a separate
 * concern.
 *
 * LLM-agnostic: this spec never asserts on a provider name.
 */

import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';

const ALLOW_WRITES = process.env.E2E_ALLOW_WRITES === 'true';

test.describe('post-signup regression — three e2e-discovered bugs', () => {
  test.skip(
    !ALLOW_WRITES,
    'E2E_ALLOW_WRITES is not "true" — refusing to create a real user in the target environment',
  );

  test('a fresh user lands signed-in and the authenticated surface actually works', async ({
    page,
    context,
  }) => {
    await context.clearCookies();

    const suffix = randomSuffix();
    const email = `e2e+post-${suffix}@aldo-e2e.test`;
    const password = `e2e-pw-${suffix}-Q9!`;
    const tenantName = `E2E Post-Signup ${suffix}`;

    // ---- Signup ----
    await page.goto('/signup');
    await page.getByLabel('Workspace name').fill(tenantName);
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill(password);
    await Promise.all([
      page.waitForURL(/\/welcome|\/runs/, { timeout: 30_000 }),
      page.getByRole('button', { name: /create workspace/i }).click(),
    ]);

    // Sidebar must show the email so we know the session is real.
    await expect(page.locator('aside', { hasText: email })).toBeVisible();

    // -----------------------------------------------------------------
    // BUG 1 — auth-proxy 401.
    //
    // Hit a known auth-required endpoint *through the proxy* and assert
    // 200. Before the fix, this returned 401 because nginx sent
    // /api/auth-proxy/* to the API server, bypassing the Next route
    // handler that injects Authorization: Bearer.
    // -----------------------------------------------------------------
    {
      const res = await page.request.get('/api/auth-proxy/v1/agents');
      expect(res.status(), 'auth-proxy must inject Bearer header').toBe(200);
      const body = (await res.json()) as { agents: unknown[] };
      expect(Array.isArray(body.agents), '/v1/agents response shape').toBe(true);
    }
    {
      const res = await page.request.get('/api/auth-proxy/v1/notifications?limit=1');
      expect(res.status(), 'auth-proxy works for /v1/notifications too').toBe(200);
    }
    // Make sure we are on /welcome (signup may land us on /runs if
    // the tenant already has agents — in that case the trap can't
    // trigger. We need the welcome-tour-active state to repro.)
    if (!page.url().endsWith('/welcome')) {
      // Hit /welcome directly so the auto-tour can mount. The bug
      // also reproed from /runs if the tour was ever opened.
      await page.goto('/welcome');
    }
    await expect(page.locator('aside', { hasText: email })).toBeVisible();

    // Click sidebar "Agents" — if the trap is back, the URL stays
    // on /welcome instead of going to /agents. Wait for either the
    // /agents URL or a 5s timeout; the assertion below catches both.
    await page.getByRole('link', { name: 'Agents', exact: true }).click();
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined);
    expect(
      page.url(),
      'sidebar nav must NOT bounce a fresh user back to /welcome (tour trap)',
    ).toMatch(/\/agents(\/|$|\?)/);

    // -----------------------------------------------------------------
    // BUG 3 — projects-store Date serialisation.
    //
    // POST a project (which the create-project-button does), then
    // GET /v1/projects. Before the fix, GET 400'd with "Expected
    // string, received date" because pg returned Date objects and the
    // Zod schema demanded ISO strings.
    // -----------------------------------------------------------------
    {
      const slug = `e2e-${suffix.slice(0, 8)}`;
      const create = await page.request.post('/api/auth-proxy/v1/projects', {
        data: { slug, name: `E2E Project ${suffix}`, description: '' },
        headers: { 'content-type': 'application/json' },
      });
      expect(create.status(), 'POST /v1/projects must succeed').toBe(201);

      const list = await page.request.get('/api/auth-proxy/v1/projects');
      expect(list.status(), 'GET /v1/projects must NOT 400 on Date serialisation').toBe(200);
      const body = (await list.json()) as { projects: Array<{ slug: string; createdAt: unknown }> };
      const found = body.projects.find((p) => p.slug === slug);
      expect(found, 'the just-created project must appear in the list').toBeDefined();
      // Wire format must be ISO string, not a JS Date / unix int.
      expect(typeof found?.createdAt, 'createdAt is an ISO string on the wire').toBe('string');
    }
  });
});

function randomSuffix(): string {
  // Same shape as auth.spec.ts: timestamp + 8 hex chars from a CSPRNG.
  // Avoids Math.random (CodeQL flag) and keeps two parallel runs from
  // colliding on email or slug.
  const t = Date.now().toString(16);
  const rand = randomUUID().replace(/-/g, '').slice(0, 8);
  return `${t}-${rand}`;
}
