#!/usr/bin/env tsx
/**
 * record-demo.ts — Wave-16E — 90-second product walkthrough recorder.
 *
 * Drives Playwright Chromium through a scripted flow against a
 * deployed preview URL, captures the WebM via Playwright's built-in
 * `recordVideo` context option, and emits:
 *
 *   apps/web/public/demo/aldo-90s.webm
 *   apps/web/public/demo/aldo-90s.mp4         (if `ffmpeg` is on PATH)
 *   apps/web/public/demo/aldo-90s-poster.png  (single frame at t=2s)
 *
 * The mp4 is preferred for the marketing <video> tag because
 * <source> negotiation lets Safari pick mp4 and Chromium pick webm.
 * If `ffmpeg` is not installed we fall back to webm-only and emit a
 * one-line warning — the marketing player handles missing sources
 * gracefully via <source> ordering + a poster fallback.
 *
 * Required env vars:
 *
 *   E2E_BASE_URL                 — e.g. https://preview-xyz.vercel.app
 *   E2E_API_BASE_URL             — backing API base URL
 *   ALDO_SCREENSHOT_PASSWORD     — password for the seeded admin
 *
 * The recorder uses the SAME fixture set as capture-screenshots.ts
 * (it calls into the shared seeding endpoint with the same prefix);
 * keep both scripts in sync.
 *
 * The flow (exactly 90 seconds, beat-paced; each beat has a `pace()`
 * call so the cumulative wall clock lines up):
 *
 *   00:00  /signup  — splash + value prop
 *   00:08  seed agency (one-click)
 *   00:18  /agents   — gallery
 *   00:26  click an agent — composite diagram
 *   00:36  /runs     — list
 *   00:44  click a fake run — flame graph
 *   00:55  press play on the replay scrubber
 *   01:05  /eval     — sweep matrix
 *   01:14  /observability — alerts
 *   01:22  /api/docs — Swagger UI
 *   01:30  fade-out (final still)
 *
 * LLM-agnostic: every label the recorder reads from the UI is a
 * capability or an opaque agent name; no provider strings appear on
 * the screen for the recording window.
 */

import { spawn } from 'node:child_process';
import { mkdir, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const VIEWPORT = { width: 1920, height: 1080 } as const;
const TARGET_DURATION_MS = 90_000;

// biome-ignore lint/suspicious/noExplicitAny: dynamic import surface
type PageLike = any;
// biome-ignore lint/suspicious/noExplicitAny: dynamic import surface
type ContextLike = any;
// biome-ignore lint/suspicious/noExplicitAny: dynamic import surface
type BrowserLike = any;

interface Beat {
  readonly atMs: number;
  readonly label: string;
  readonly act: (page: PageLike, baseUrl: string) => Promise<void>;
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (v === undefined || v.length === 0) {
    console.error(`error: ${name} is required`);
    process.exit(2);
  }
  return v;
}

function optionalEnv(name: string, fallback: string): string {
  const v = process.env[name];
  return v && v.length > 0 ? v : fallback;
}

async function login(apiBaseUrl: string, email: string, password: string): Promise<string> {
  const res = await fetch(`${apiBaseUrl}/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    throw new Error(`login failed: HTTP ${res.status}`);
  }
  const data = (await res.json()) as { token?: string; sessionToken?: string };
  const token = data.token ?? data.sessionToken;
  if (!token) throw new Error('login response missing token');
  return token;
}

interface FixtureIds {
  readonly runId: string;
  readonly sweepId: string;
  readonly dashboardId: string;
}

async function ensureFixtures(apiBaseUrl: string, token: string): Promise<FixtureIds> {
  const res = await fetch(`${apiBaseUrl}/v1/admin/fixtures/ensure`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ prefix: 'screencap-fixture-' }),
  });
  if (!res.ok) {
    throw new Error(`fixtures/ensure failed: HTTP ${res.status}`);
  }
  return (await res.json()) as FixtureIds;
}

/**
 * Beat plan. Each beat advances at a known wall-clock offset; the
 * loop sleeps to the next beat's start so the recording stays at
 * ~90s regardless of network latency on individual nav.
 *
 * The `act` body should be IDEMPOTENT and SHORT — anything heavier
 * than a click + a scroll belongs in fixture seed.
 */
function buildBeats(ids: FixtureIds): ReadonlyArray<Beat> {
  return [
    {
      atMs: 0,
      label: 'splash',
      act: async (page, baseUrl) => {
        await page.goto(`${baseUrl}/signup`, { waitUntil: 'networkidle' });
      },
    },
    {
      atMs: 8_000,
      label: 'seed-agency',
      act: async (page, _baseUrl) => {
        // Just hover the seed button — the agency is already seeded
        // by ensureFixtures(); this beat is for storytelling.
        const btn = page.locator('text=Seed default agency').first();
        if ((await btn.count()) > 0) await btn.hover();
      },
    },
    {
      atMs: 18_000,
      label: 'agents-gallery',
      act: async (page, baseUrl) => {
        await page.goto(`${baseUrl}/agents`, { waitUntil: 'networkidle' });
      },
    },
    {
      atMs: 26_000,
      label: 'agent-detail',
      act: async (page, baseUrl) => {
        await page.goto(`${baseUrl}/agents/architect`, { waitUntil: 'networkidle' });
      },
    },
    {
      atMs: 36_000,
      label: 'runs-list',
      act: async (page, baseUrl) => {
        await page.goto(`${baseUrl}/runs`, { waitUntil: 'networkidle' });
      },
    },
    {
      atMs: 44_000,
      label: 'run-flame',
      act: async (page, baseUrl) => {
        await page.goto(`${baseUrl}/runs/${encodeURIComponent(ids.runId)}`, {
          waitUntil: 'networkidle',
        });
      },
    },
    {
      atMs: 55_000,
      label: 'replay-scrubber',
      act: async (page, _baseUrl) => {
        // Click the replay scrubber play button if present; otherwise
        // just hover the trace canvas to draw the eye.
        const play = page.locator('[data-aldo-replay-play]').first();
        if ((await play.count()) > 0) {
          await play.click();
        } else {
          const canvas = page.locator('[data-aldo-trace-canvas]').first();
          if ((await canvas.count()) > 0) await canvas.hover();
        }
      },
    },
    {
      atMs: 65_000,
      label: 'eval-sweep',
      act: async (page, baseUrl) => {
        await page.goto(`${baseUrl}/eval/sweeps/${encodeURIComponent(ids.sweepId)}`, {
          waitUntil: 'networkidle',
        });
      },
    },
    {
      atMs: 74_000,
      label: 'observability',
      act: async (page, baseUrl) => {
        await page.goto(`${baseUrl}/observability`, { waitUntil: 'networkidle' });
      },
    },
    {
      atMs: 82_000,
      label: 'swagger',
      act: async (page, baseUrl) => {
        await page.goto(`${baseUrl}/api/docs`, { waitUntil: 'networkidle' });
      },
    },
  ];
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, Math.max(0, ms)));
}

/**
 * Convert webm -> mp4 with ffmpeg. Returns true on success, false
 * if ffmpeg is not on PATH OR the conversion failed (we don't fail
 * the whole script on conversion errors — webm is enough).
 */
async function tryFfmpegConvert(webmPath: string, mp4Path: string): Promise<boolean> {
  return new Promise((resolveProm) => {
    const proc = spawn(
      'ffmpeg',
      [
        '-y',
        '-i',
        webmPath,
        '-c:v',
        'libx264',
        '-preset',
        'medium',
        '-crf',
        '23',
        '-pix_fmt',
        'yuv420p',
        '-movflags',
        '+faststart',
        '-an', // no audio (Playwright doesn't capture audio)
        mp4Path,
      ],
      { stdio: ['ignore', 'ignore', 'pipe'] },
    );
    proc.on('error', () => {
      console.warn('[ffmpeg] not on PATH; leaving demo as webm-only.');
      resolveProm(false);
    });
    proc.on('exit', (code) => {
      if (code === 0) {
        console.log(`[ffmpeg] converted -> ${mp4Path}`);
        resolveProm(true);
      } else {
        console.warn(`[ffmpeg] exit code ${code}; keeping webm-only.`);
        resolveProm(false);
      }
    });
  });
}

async function main(): Promise<void> {
  const baseUrl = requireEnv('E2E_BASE_URL').replace(/\/$/, '');
  const apiBaseUrl = requireEnv('E2E_API_BASE_URL').replace(/\/$/, '');
  const password = requireEnv('ALDO_SCREENSHOT_PASSWORD');
  const email = optionalEnv('ALDO_SCREENSHOT_USER', 'admin@aldo.tech');

  const __dirname = dirname(fileURLToPath(import.meta.url));
  const outDir = resolve(__dirname, '..', 'public', 'demo');
  await mkdir(outDir, { recursive: true });

  console.log(`[auth] logging in as ${email}`);
  const token = await login(apiBaseUrl, email, password);

  console.log('[fixtures] ensuring screencap fixtures exist');
  const ids = await ensureFixtures(apiBaseUrl, token);

  const playwrightSpec = 'playwright';
  const playwright: { chromium: { launch: (opts: unknown) => Promise<BrowserLike> } } =
    await import(playwrightSpec);

  const browser: BrowserLike = await playwright.chromium.launch({ headless: true });
  const recordDir = resolve(outDir, '.record-tmp');
  await mkdir(recordDir, { recursive: true });

  let webmPath = '';
  try {
    const context: ContextLike = await browser.newContext({
      viewport: VIEWPORT,
      recordVideo: {
        dir: recordDir,
        size: VIEWPORT,
      },
    });
    await context.addCookies([
      {
        name: 'aldo_session',
        value: token,
        url: baseUrl,
        httpOnly: true,
        sameSite: 'Lax',
        secure: baseUrl.startsWith('https://'),
      },
    ]);
    const page: PageLike = await context.newPage();

    const beats = buildBeats(ids);
    const startedAt = Date.now();

    // Capture the poster early — t=2s, after the splash has settled.
    let posterCaptured = false;

    for (const beat of beats) {
      const elapsed = Date.now() - startedAt;
      if (beat.atMs > elapsed) {
        await sleep(beat.atMs - elapsed);
      }
      console.log(`[beat] ${String(beat.atMs).padStart(5, ' ')}ms — ${beat.label}`);
      await beat.act(page, baseUrl);

      if (!posterCaptured && Date.now() - startedAt >= 2_000) {
        const posterPath = resolve(outDir, 'aldo-90s-poster.png');
        const buf = (await page.screenshot({ type: 'png' })) as Buffer;
        await writeFile(posterPath, buf);
        console.log(`[poster] wrote ${posterPath}`);
        posterCaptured = true;
      }
    }

    // Hold the final frame for the remaining duration.
    const remaining = TARGET_DURATION_MS - (Date.now() - startedAt);
    if (remaining > 0) {
      await sleep(remaining);
    }

    // Closing the context flushes the WebM. The path is randomised
    // by Playwright; we then rename to our canonical filename.
    const video = page.video();
    await context.close();
    if (!video) {
      throw new Error('Playwright did not produce a video; recordVideo misconfigured');
    }
    const tmpPath: string = await video.path();
    webmPath = resolve(outDir, 'aldo-90s.webm');
    await rename(tmpPath, webmPath);
    console.log(`[webm] wrote ${webmPath}`);
  } finally {
    await browser.close();
    // Best-effort tmp cleanup.
    try {
      const leftovers = await readdir(recordDir);
      for (const f of leftovers) {
        await unlink(resolve(recordDir, f));
      }
    } catch {
      // ignore
    }
  }

  if (webmPath) {
    const mp4Path = resolve(outDir, 'aldo-90s.mp4');
    await tryFfmpegConvert(webmPath, mp4Path);
  }

  console.log('[done]');
}

main().catch((err) => {
  console.error('record-demo failed:', err);
  process.exit(1);
});
