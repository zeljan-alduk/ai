/**
 * Lighthouse + axe gates on the marketing surface (Wave-16E).
 *
 * Runs Google Lighthouse against the deployed home page (and a
 * second axe-only sweep across `/`, `/pricing`, `/docs`) and asserts:
 *
 *   performance     ≥ 85
 *   accessibility   ≥ 95
 *   seo             ≥ 90
 *   axe-core        zero "serious" or "critical" violations on each
 *                   route.
 *
 * The performance threshold is intentionally NOT 100 — we serve a
 * real product screenshot above the fold and a tiny scroll-driven
 * animation. Lighthouse penalises both; 85 is the line we agreed is
 * "fast enough for marketing without sacrificing the visual".
 *
 * GATING:
 *   - The Lighthouse run is heavy (downloads chrome-launcher,
 *     boots a fresh Chrome, runs ~60s). We gate it behind
 *     `E2E_LIGHTHOUSE=true` so the regular `npm run e2e` doesn't
 *     pay the cost. The CI lighthouse job sets the flag.
 *   - The axe sweep is cheap and runs unconditionally.
 *
 * LLM-agnostic: no provider strings appear in this test.
 */

import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const LIGHTHOUSE_GATED = process.env.E2E_LIGHTHOUSE === 'true';

const AXE_ROUTES: ReadonlyArray<{ path: string; name: string }> = [
  { path: '/', name: 'home' },
  { path: '/pricing', name: 'pricing' },
  { path: '/docs', name: 'docs' },
];

const THRESHOLDS = {
  performance: 0.85,
  accessibility: 0.95,
  seo: 0.9,
} as const;

test.describe('lighthouse · marketing surface', () => {
  test.skip(!LIGHTHOUSE_GATED, 'E2E_LIGHTHOUSE != true — skipping lighthouse run');
  // Lighthouse boots a fresh chrome via chrome-launcher; allow extra
  // wall-clock per run (the suite budget is 60s by default).
  test.setTimeout(180_000);

  test('home meets performance/a11y/seo thresholds', async () => {
    const baseUrl = process.env.E2E_BASE_URL;
    if (!baseUrl) throw new Error('E2E_BASE_URL is required');

    // Lazy-import lighthouse + chrome-launcher so the rest of the
    // e2e suite doesn't drag them in. Both are devDeps that the
    // CI lighthouse job installs on demand.
    const lighthouseSpec = 'lighthouse';
    const launcherSpec = 'chrome-launcher';
    // biome-ignore lint/suspicious/noExplicitAny: dynamic import surface
    const lighthouseMod: any = await import(lighthouseSpec);
    // biome-ignore lint/suspicious/noExplicitAny: dynamic import surface
    const launcher: any = await import(launcherSpec);

    const chrome = await launcher.launch({
      chromeFlags: ['--headless=new', '--no-sandbox'],
    });
    try {
      const result = await lighthouseMod.default(`${baseUrl}/`, {
        port: chrome.port,
        output: 'json',
        logLevel: 'error',
        onlyCategories: ['performance', 'accessibility', 'seo'],
      });
      if (!result || !result.lhr) {
        throw new Error('lighthouse returned no report');
      }
      const cats = result.lhr.categories as Record<string, { score: number | null }>;
      const scores = {
        performance: cats.performance?.score ?? 0,
        accessibility: cats.accessibility?.score ?? 0,
        seo: cats.seo?.score ?? 0,
      };
      // eslint-disable-next-line no-console
      console.log('lighthouse scores:', scores);
      expect(scores.performance, 'performance').toBeGreaterThanOrEqual(THRESHOLDS.performance);
      expect(scores.accessibility, 'accessibility').toBeGreaterThanOrEqual(
        THRESHOLDS.accessibility,
      );
      expect(scores.seo, 'seo').toBeGreaterThanOrEqual(THRESHOLDS.seo);
    } finally {
      await chrome.kill();
    }
  });
});

test.describe('axe-core · marketing surface', () => {
  for (const r of AXE_ROUTES) {
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
});
