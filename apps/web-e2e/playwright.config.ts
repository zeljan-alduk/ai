/**
 * Playwright config for @aldo-ai/web-e2e.
 *
 * Black-box e2e against deployed infra:
 *   - `E2E_BASE_URL`     — required, the web app URL (e.g. the live Vercel
 *                          alias https://ai.aldo.tech).
 *   - `E2E_API_BASE_URL` — required for tests that hit the API directly
 *                          (e.g. https://ai.aldo.tech). Falls back
 *                          to E2E_BASE_URL only if not set, but the health
 *                          spec will fail fast if it's wrong.
 *   - `E2E_ALLOW_WRITES` — `"true"` to enable mutation tests (POST/DELETE
 *                          /v1/secrets). Default: false. CI never enables
 *                          this against production.
 *
 * Chromium-only on purpose — the web app is server-rendered and we'd rather
 * keep the matrix small until cross-browser bugs actually surface.
 *
 * LLM-agnostic: nothing in this config (or in the suite) names a provider.
 */

import { type PlaywrightTestConfig, defineConfig, devices } from '@playwright/test';

const baseURL = process.env.E2E_BASE_URL;
if (!baseURL) {
  throw new Error(
    'E2E_BASE_URL is required (e.g. https://ai.aldo.tech). ' +
      'Set it in your shell or via the workflow input.',
  );
}

const isCI = !!process.env.CI;

const config: PlaywrightTestConfig = {
  testDir: './tests',
  // Total timeout per test. Live infra can be slow on cold start.
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  fullyParallel: false,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  reporter: isCI
    ? [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }], ['github']]
    : [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  outputDir: 'test-results',
  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    // Escape hatch for sandbox/dev environments whose Chromium ships
    // an outdated CA bundle. CI runners have a valid system cert
    // store, so leave this off there.
    ignoreHTTPSErrors: process.env.E2E_INSECURE_TLS === 'true',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
};

if (isCI) {
  // CI runs serially against shared infra so secrets-CRUD tests don't
  // race each other or other PRs.
  config.workers = 1;
}

export default defineConfig(config);
