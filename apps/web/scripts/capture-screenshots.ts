#!/usr/bin/env tsx
/**
 * capture-screenshots.ts — Wave-14C — landing-page screenshot capture.
 *
 * Drives a Playwright browser against a deployed preview URL,
 * authenticates via a service-account bearer token, navigates to
 * three canonical screens, and saves PNGs into
 * `apps/web/public/screenshots/`.
 *
 * The three shots:
 *
 *   1. /runs           — signed-in dashboard (the marketing hero
 *                        replaces the wave-12 SVG mockup with this).
 *   2. /runs/<id>      — flame-graph page (one representative run).
 *   3. /eval/sweeps/<id> — radar + bar charts on a finished sweep.
 *
 * Required env vars (the script REFUSES to run without them):
 *
 *   E2E_BASE_URL                 — e.g. https://preview-xyz.vercel.app
 *   ALDO_SCREENSHOT_USER_TOKEN   — JWT bearer token for an owner-role
 *                                  user in a tenant pre-seeded with
 *                                  the default agency template + at
 *                                  least one finished run + sweep.
 *   ALDO_SCREENSHOT_RUN_ID       — UUID of the run shown in shot #2.
 *   ALDO_SCREENSHOT_SWEEP_ID     — UUID of the sweep shown in shot #3.
 *
 * NEVER commit the token. The script reads it at runtime; CI passes
 * it via a repo secret. A local developer who wants to refresh the
 * shots exports it in their shell — there's no `.env.example` row for
 * it intentionally so a misconfigured local dev doesn't accidentally
 * persist a real token to disk.
 *
 * The script is intentionally vanilla — we don't depend on
 * `playwright` from the web workspace because that drag-pulls a
 * 200MB browser binary into every CI install. Run on demand via
 * `npx playwright`:
 *
 *     npm i -g playwright && playwright install chromium
 *     E2E_BASE_URL=...  ALDO_SCREENSHOT_USER_TOKEN=...  \
 *       ALDO_SCREENSHOT_RUN_ID=... ALDO_SCREENSHOT_SWEEP_ID=... \
 *       tsx apps/web/scripts/capture-screenshots.ts
 *
 * The output is committed (PNGs under public/screenshots/), so the
 * marketing hero loads them as static assets at SSR time.
 *
 * LLM-agnostic: no provider names appear in the captured screens —
 * the dashboard and run-tree show opaque agent + model labels.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

interface Shot {
  readonly path: string;
  readonly file: string;
  readonly fullPage: boolean;
  readonly viewport: { width: number; height: number };
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (v === undefined || v.length === 0) {
    console.error(`error: ${name} is required`);
    process.exit(2);
  }
  return v;
}

async function main(): Promise<void> {
  const baseUrl = requireEnv('E2E_BASE_URL').replace(/\/$/, '');
  const token = requireEnv('ALDO_SCREENSHOT_USER_TOKEN');
  const runId = requireEnv('ALDO_SCREENSHOT_RUN_ID');
  const sweepId = requireEnv('ALDO_SCREENSHOT_SWEEP_ID');

  // Defer the playwright import so the env-var checks above fire
  // BEFORE we drag a heavy browser binary into the require graph.
  const playwrightSpec = 'playwright';
  // biome-ignore lint/suspicious/noExplicitAny: dynamic import
  const playwright: any = await import(playwrightSpec);

  const __dirname = dirname(fileURLToPath(import.meta.url));
  const outDir = resolve(__dirname, '..', 'public', 'screenshots');
  await mkdir(outDir, { recursive: true });

  const shots: Shot[] = [
    {
      path: '/runs',
      file: 'runs-dashboard.png',
      fullPage: false,
      viewport: { width: 1440, height: 900 },
    },
    {
      path: `/runs/${encodeURIComponent(runId)}`,
      file: 'run-flame.png',
      fullPage: false,
      viewport: { width: 1440, height: 900 },
    },
    {
      path: `/eval/sweeps/${encodeURIComponent(sweepId)}`,
      file: 'sweep-charts.png',
      fullPage: false,
      viewport: { width: 1440, height: 900 },
    },
  ];

  const browser = await playwright.chromium.launch({ headless: true });
  try {
    for (const shot of shots) {
      // Each shot uses a fresh context so cookies / localStorage from
      // a previous nav don't leak in. We stamp the bearer token via a
      // localStorage entry the web app reads on first paint (matches
      // the `aldo_session` cookie path; see lib/api.ts).
      const ctx = await browser.newContext({ viewport: shot.viewport });
      // Set the auth cookie BEFORE the first nav so the protected
      // route doesn't redirect to /login.
      await ctx.addCookies([
        {
          name: 'aldo_session',
          value: token,
          url: baseUrl,
          httpOnly: true,
          sameSite: 'Lax',
          secure: baseUrl.startsWith('https://'),
        },
      ]);
      const page = await ctx.newPage();
      const url = `${baseUrl}${shot.path}`;
      // eslint-disable-next-line no-console
      console.log(`-> ${url}`);
      await page.goto(url, { waitUntil: 'networkidle', timeout: 30_000 });
      // Give CSS animations + chart entry transitions a beat to settle.
      await page.waitForTimeout(800);
      const buf = (await page.screenshot({
        fullPage: shot.fullPage,
        type: 'png',
      })) as Buffer;
      const out = resolve(outDir, shot.file);
      await writeFile(out, buf);
      // eslint-disable-next-line no-console
      console.log(`  wrote ${out} (${buf.length} bytes)`);
      await ctx.close();
    }
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('capture-screenshots failed:', err);
  process.exit(1);
});
