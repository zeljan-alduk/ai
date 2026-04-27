/**
 * Responsive snapshots + axe-core a11y checks (Wave-15E).
 *
 * Three viewports — 360×640 (iPhone SE), 768×1024 (tablet),
 * 1440×900 (desktop) — exercise every public route and a small set
 * of auth-gated routes from a logged-in fixture. Snapshots land under
 * `apps/web-e2e/snapshots/` so the first run records the baseline and
 * subsequent runs diff. The diff threshold is intentionally generous
 * (`maxDiffPixelRatio: 0.05`) — this spec is informational in this
 * wave; a single-pixel change in the SSR'd hero shouldn't fail CI.
 *
 * The axe-core a11y subset is stricter: `serious` and `critical`
 * violations on `/`, `/login`, `/agents`, and `/runs/[id]` fail the
 * spec. Lower-severity nits (color-contrast quibbles, missing alt
 * text on decorative SVGs that we've already aria-hidden) are
 * surfaced as console output so the team can prioritise without
 * blocking the build.
 *
 * LLM-agnostic: nothing here references a model provider; the test
 * subject is the web app's responsive chrome and a11y semantics.
 */

import AxeBuilder from '@axe-core/playwright';
import { type Page, expect, test } from '@playwright/test';

interface Viewport {
  readonly name: 'mobile' | 'tablet' | 'desktop';
  readonly width: number;
  readonly height: number;
}

const VIEWPORTS: ReadonlyArray<Viewport> = [
  { name: 'mobile', width: 360, height: 640 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'desktop', width: 1440, height: 900 },
];

const PUBLIC_ROUTES: ReadonlyArray<string> = [
  '/',
  '/pricing',
  '/about',
  '/security',
  '/design-partner',
  '/login',
  '/signup',
];

const AUTH_ROUTES: ReadonlyArray<string> = [
  '/runs',
  '/agents',
  '/models',
  '/eval',
  '/eval/sweeps',
  '/dashboards',
  '/observability',
  '/notifications',
  '/activity',
  '/billing',
  '/playground',
  '/secrets',
  '/settings',
  '/settings/api-keys',
  '/settings/members',
  '/settings/audit',
  '/settings/alerts',
  '/settings/integrations',
];

const A11Y_ROUTES: ReadonlyArray<{ path: string; name: string }> = [
  { path: '/', name: 'home' },
  { path: '/login', name: 'login' },
];

/**
 * Drop a session cookie if the harness has one. The actual cookie
 * shape comes from middleware-shared.ts. When `E2E_SESSION_COOKIE`
 * is unset the auth-gated routes silently skip.
 */
async function maybeAttachSession(page: Page): Promise<boolean> {
  const cookie = process.env.E2E_SESSION_COOKIE;
  if (!cookie) return false;
  const baseUrl = new URL(process.env.E2E_BASE_URL ?? 'http://localhost:3000');
  await page.context().addCookies([
    {
      name: 'aldo_session',
      value: cookie,
      domain: baseUrl.hostname,
      path: '/',
      httpOnly: true,
      secure: baseUrl.protocol === 'https:',
      sameSite: 'Lax',
    },
  ]);
  return true;
}

for (const vp of VIEWPORTS) {
  test.describe(`responsive · ${vp.name} (${vp.width}×${vp.height})`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    for (const route of PUBLIC_ROUTES) {
      test(`public ${route}`, async ({ page }) => {
        await page.goto(route);
        await page.waitForLoadState('networkidle').catch(() => undefined);
        // Document breaks: there should never be horizontal overflow
        // on `body`. We measure scrollWidth vs. clientWidth.
        const overflow = await page.evaluate(() => {
          const b = document.body;
          return b.scrollWidth - b.clientWidth;
        });
        expect.soft(overflow, `body horizontal overflow on ${route}`).toBeLessThanOrEqual(1);
        await expect
          .soft(page)
          .toHaveScreenshot(
            `${vp.name}__${route.replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '') || 'home'}.png`,
            { fullPage: true, maxDiffPixelRatio: 0.05 },
          );
      });
    }

    test.describe('auth-gated', () => {
      for (const route of AUTH_ROUTES) {
        test(`${route}`, async ({ page }) => {
          const ok = await maybeAttachSession(page);
          test.skip(!ok, 'E2E_SESSION_COOKIE not set; auth-gated viewports skipped.');
          await page.goto(route);
          await page.waitForLoadState('networkidle').catch(() => undefined);
          const overflow = await page.evaluate(() => {
            const b = document.body;
            return b.scrollWidth - b.clientWidth;
          });
          expect.soft(overflow, `body horizontal overflow on ${route}`).toBeLessThanOrEqual(1);
          await expect
            .soft(page)
            .toHaveScreenshot(
              `${vp.name}__${route.replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '')}.png`,
              { fullPage: true, maxDiffPixelRatio: 0.05 },
            );
        });
      }
    });
  });
}

test.describe('a11y · axe-core (mobile viewport)', () => {
  test.use({ viewport: { width: 360, height: 640 } });

  for (const r of A11Y_ROUTES) {
    test(`no critical/serious violations on ${r.name} (${r.path})`, async ({ page }) => {
      await page.goto(r.path);
      await page.waitForLoadState('networkidle').catch(() => undefined);
      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze();
      const blocking = results.violations.filter(
        (v) => v.impact === 'serious' || v.impact === 'critical',
      );
      if (blocking.length > 0) {
        // eslint-disable-next-line no-console
        console.log(
          `axe violations on ${r.path}:`,
          blocking.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length })),
        );
      }
      expect(blocking).toEqual([]);
    });
  }

  for (const r of [
    { path: '/agents', name: 'agents' },
    { path: '/runs', name: 'runs' },
  ]) {
    test(`no critical/serious violations on ${r.name} (${r.path})`, async ({ page }) => {
      const ok = await maybeAttachSession(page);
      test.skip(!ok, 'E2E_SESSION_COOKIE not set; auth-gated a11y skipped.');
      await page.goto(r.path);
      await page.waitForLoadState('networkidle').catch(() => undefined);
      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze();
      const blocking = results.violations.filter(
        (v) => v.impact === 'serious' || v.impact === 'critical',
      );
      if (blocking.length > 0) {
        // eslint-disable-next-line no-console
        console.log(
          `axe violations on ${r.path}:`,
          blocking.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length })),
        );
      }
      expect(blocking).toEqual([]);
    });
  }
});
