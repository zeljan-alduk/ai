/**
 * pixmend.ai — local MVP server
 *
 * GET  /                 → public/index.html (the drop-zone UX)
 * POST /enhance          → multipart upload → ALDO strategist plan → Real-ESRGAN ×4 → JSON { plan, imageUrl, dims, bytes }
 * GET  /out/<file>       → serves the enhanced image from /tmp/pixmend-stack/out
 *
 * Pipeline:
 *  1. Save upload to /tmp/pixmend-stack/in/<uuid>.<ext>
 *  2. Read dimensions via `sips`
 *  3. POST to ALDO enhance-sharper /test endpoint with metadata + intent → 4-line strategist plan
 *  4. Spawn realesrgan-ncnn-vulkan with model picked by the plan (defaults to realesrgan-x4plus)
 *  5. Return JSON; client renders side-by-side
 *
 * Everything local. No cloud, no API key. Total cost: $0.
 */

import { spawn } from 'node:child_process';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { extname, join } from 'node:path';
import { randomUUID } from 'node:crypto';

import { serveStatic } from '@hono/node-server/serve-static';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { streamSSE } from 'hono/streaming';

// All paths env-overridable so the same server runs:
//  - local dev on macOS out of /tmp/pixmend-stack
//  - production Docker container at /opt/picenhancer
const ROOT = process.env.PIXMEND_ROOT ?? '/tmp/pixmend-stack';
const BIN = process.env.PIXMEND_BIN ?? `${ROOT}/bin/realesrgan-ncnn-vulkan`;
const MODELS = process.env.PIXMEND_MODELS ?? `${ROOT}/bin/models`;
const IN = process.env.PIXMEND_IN ?? `${ROOT}/in`;
const OUT = process.env.PIXMEND_OUT ?? `${ROOT}/out`;
const PUB = process.env.PIXMEND_PUB ?? `${ROOT}/public`;
const PORT = Number(process.env.PIXMEND_PORT ?? 4000);
const HOST = process.env.PIXMEND_HOST ?? '127.0.0.1';
// `sips` on macOS, `identify` (ImageMagick) on Linux. The production
// Docker image installs imagemagick and sets PIXMEND_DIMS_CMD=identify.
const DIMS_CMD = process.env.PIXMEND_DIMS_CMD ?? 'sips';
// Upscale engine. `realesrgan` runs the AI binary (great on a GPU host
// or Apple Silicon Metal); `imagemagick` runs `convert -filter Lanczos
// -unsharp` (sub-second; ships fine on a CPU-only VPS). Default is
// `imagemagick` because the production VPS has no GPU and software
// Vulkan via llvmpipe is too slow to be useful (40+ s before the first
// progress tick on a 200x150 image). Local dev on a Mac sets
// PIXMEND_ENGINE=realesrgan to exercise the AI path.
type Engine = 'realesrgan' | 'imagemagick';
const ENGINE: Engine =
  process.env.PIXMEND_ENGINE === 'realesrgan' ? 'realesrgan' : 'imagemagick';

const ALDO_API = process.env.ALDO_API_BASE ?? 'http://localhost:3001';
const ALDO_TOKEN = process.env.ALDO_TOKEN ?? '';
const ENHANCE_SHARPER_ID = process.env.ENHANCE_SHARPER_PROMPT_ID ?? '';

await mkdir(IN, { recursive: true });
await mkdir(OUT, { recursive: true });

const app = new Hono();
app.use('*', cors());

app.get('/', async (c) => {
  const html = await readFile(`${PUB}/index.html`, 'utf8');
  return c.html(html);
});

app.get('/health', (c) => c.json({ ok: true }));

app.get('/out/:name', async (c) => {
  const name = c.req.param('name').replace(/[^a-z0-9._-]/gi, '');
  const file = `${OUT}/${name}`;
  try {
    const buf = await readFile(file);
    const type = name.endsWith('.png') ? 'image/png' : name.endsWith('.jpg') ? 'image/jpeg' : 'image/webp';
    return c.body(buf, 200, { 'content-type': type, 'cache-control': 'no-store' });
  } catch {
    return c.text('not found', 404);
  }
});

/**
 * Pass plan for a target scale. Real-ESRGAN x4plus models do x4 natively;
 * `-s 2` performs an x4 internal upscale + bilinear downsample, which gives
 * a smoother x2 than bicubic. We chain passes for x8 / x16 because a single
 * `-s 8` invocation isn't supported and chaining preserves detail better
 * than upscaling once and bicubic-resampling.
 */
function planPasses(scale: 4 | 8 | 16): readonly { readonly s: 2 | 4 }[] {
  if (scale === 4) return [{ s: 4 }];
  if (scale === 8) return [{ s: 4 }, { s: 2 }];
  return [{ s: 4 }, { s: 4 }];
}

app.post('/enhance', async (c) => {
  const form = await c.req.parseBody();
  const file = form.file as File | undefined;
  if (!file) return c.text('missing file', 400);

  const rawScale = Number((form.scale as string | undefined) ?? '4');
  const scale: 4 | 8 | 16 = rawScale === 8 ? 8 : rawScale === 16 ? 16 : 4;

  const buf = Buffer.from(await file.arrayBuffer());
  const id = randomUUID();
  const ext = (extname(file.name) || '.png').toLowerCase();
  const inPath = `${IN}/${id}${ext}`;
  await writeFile(inPath, buf);

  const origDims = await readDims(inPath);
  const origBytes = (await stat(inPath)).size;
  const passes = planPasses(scale);

  return streamSSE(c, async (sse) => {
    const send = (event: Record<string, unknown>) =>
      sse.writeSSE({ data: JSON.stringify(event) });

    await send({ type: 'accepted', scale, passes: passes.length, origDims, origBytes });

    // 1. Strategist plan (best-effort, doesn't block enhancement).
    await send({ type: 'plan', status: 'start' });
    const plan = await maybeFetchPlan({
      filename: file.name,
      format: ext.slice(1).toUpperCase(),
      width: origDims.w,
      height: origDims.h,
      bytes: origBytes,
      contentKind: guessKind(file.name),
      intent: `enhance to x${scale}`,
    });
    await send({
      type: 'plan',
      status: 'done',
      text: plan?.text ?? '(strategist skipped — ALDO not reachable or prompt id unset)',
    });

    const model = pickModel(plan?.passes);

    // 2. Chained Real-ESRGAN passes. Each pass writes a fresh PNG; the
    // last one is the deliverable. Intermediate files are kept (helpful
    // for debugging) and live alongside the final under /out.
    const t0 = Date.now();
    let currentInput = inPath;
    let outPath = '';
    for (let i = 0; i < passes.length; i++) {
      const pass = passes[i];
      const passLabel = `${i + 1}/${passes.length}`;
      outPath = `${OUT}/${id}-pass${i + 1}-s${pass.s}.png`;
      await send({
        type: 'enhance',
        status: 'start',
        pass: i + 1,
        of: passes.length,
        s: pass.s,
        model,
      });
      try {
        const onProgress = (pct: number) => {
          // Map per-pass 0..100 into the global 0..100 so the UI bar
          // moves monotonically across all passes.
          const global = ((i + pct / 100) / passes.length) * 100;
          void send({
            type: 'enhance',
            status: 'progress',
            pass: i + 1,
            of: passes.length,
            pct: Math.round(pct),
            globalPct: Math.round(global),
            label: passLabel,
          });
        };
        if (ENGINE === 'realesrgan') {
          await runRealesrgan(currentInput, outPath, model, pass.s, onProgress);
        } else {
          await runImageMagick(currentInput, outPath, pass.s, onProgress);
        }
      } catch (err) {
        await send({
          type: 'error',
          message: err instanceof Error ? err.message : String(err),
          pass: i + 1,
        });
        return;
      }
      await send({ type: 'enhance', status: 'done', pass: i + 1, of: passes.length });
      currentInput = outPath;
    }
    const enhanceMs = Date.now() - t0;

    const enhancedDims = await readDims(outPath);
    const enhancedBytes = (await stat(outPath)).size;
    const finalName = outPath.split('/').pop()!;

    await send({
      type: 'done',
      imageUrl: `/out/${finalName}`,
      filename: file.name.replace(/\.[^.]+$/, '') + `.x${scale}.png`,
      origDims,
      origBytes,
      enhancedDims,
      enhancedBytes,
      enhanceMs,
      scale,
      model,
      engine: ENGINE,
    });
  });
});

interface PlanResult { readonly text: string; readonly passes?: readonly string[]; }

async function maybeFetchPlan(vars: Record<string, string | number>): Promise<PlanResult | null> {
  if (!ALDO_TOKEN || !ENHANCE_SHARPER_ID) return null;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 12_000);
    const res = await fetch(`${ALDO_API}/v1/prompts/${ENHANCE_SHARPER_ID}/test`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${ALDO_TOKEN}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ variables: vars }),
      signal: ctrl.signal,
    });
    clearTimeout(t);
    if (!res.ok) return null;
    const j = (await res.json()) as { output?: string };
    const text = j.output ?? '';
    const passLine = text.split(/\r?\n/).find((l) => /^passes:/i.test(l)) ?? '';
    const passes = passLine.replace(/^passes:\s*/i, '').split(/[,\s]+/).filter(Boolean);
    return { text, passes };
  } catch {
    return null;
  }
}

function pickModel(passes: readonly string[] | undefined): string {
  if (!passes) return 'realesrgan-x4plus';
  if (passes.some((p) => /anime/i.test(p))) return 'realesrgan-x4plus-anime';
  if (passes.some((p) => /denoise/i.test(p))) return 'realesrnet-x4plus';
  return 'realesrgan-x4plus';
}

/**
 * Spawn realesrgan-ncnn-vulkan and resolve when the child exits cleanly.
 * Parses stderr line-by-line for `XX.XX%` progress markers (the binary
 * emits one per tile) and forwards them to the optional `onProgress`
 * callback. Tile count is image-size dependent — small inputs may only
 * emit 4 ticks, large ones emit dozens — so the bar is naturally finer
 * for the slower jobs that actually need it.
 */
async function runRealesrgan(
  input: string,
  output: string,
  model: string,
  s: 2 | 4 = 4,
  onProgress?: (pct: number) => void,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const p = spawn(BIN, ['-i', input, '-o', output, '-n', model, '-s', String(s), '-m', MODELS], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    let tail = '';
    p.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      stderr += text;
      tail += text;
      // Progress lines are newline-OR-carriage-return-terminated depending
      // on the binary's TTY detection. Split on either.
      const parts = tail.split(/[\r\n]+/);
      tail = parts.pop() ?? '';
      for (const line of parts) {
        const m = line.match(/^(\d+(?:\.\d+)?)\s*%\s*$/);
        if (m && onProgress) {
          const pct = Math.min(100, Math.max(0, Number(m[1])));
          onProgress(pct);
        }
      }
    });
    p.on('close', (code) => {
      if (code === 0) {
        if (onProgress) onProgress(100);
        resolve();
      } else {
        reject(new Error(`realesrgan exited ${code}: ${stderr.slice(0, 400)}`));
      }
    });
    p.on('error', reject);
  });
}

/**
 * Lanczos resize + perceptual unsharp via ImageMagick `convert`.
 * Sub-second for typical inputs; the only path that's actually
 * usable on a CPU-only VPS today. Quality is "very good" for photos
 * and screenshots, less impressive for tiny pixelated sources where
 * a real super-resolution model would invent detail.
 *
 * Emits two synthetic progress ticks (10% on spawn, 100% on close)
 * so the UI bar still animates — the actual work is too fast to
 * stream meaningful intermediate progress.
 */
async function runImageMagick(
  input: string,
  output: string,
  s: 2 | 4,
  onProgress?: (pct: number) => void,
): Promise<void> {
  const pct = Math.round(s * 100); // 200 or 400, ImageMagick's % syntax
  // -filter Lanczos: high-quality reconstruction kernel, the standard
  //   for upscaling. Sharper than Mitchell, less ringy than sinc.
  // -unsharp 0x1.0+1.0+0.02: gentle sharpen — radius=0 (auto), sigma=1,
  //   amount=1, threshold=0.02 (skip near-flat regions). Keeps gradients
  //   clean while restoring perceived detail on edges.
  // -strip: drop EXIF + colour profile chunks for a smaller PNG out.
  const args = [
    input,
    '-filter', 'Lanczos',
    '-resize', `${pct}%`,
    '-unsharp', '0x1.0+1.0+0.02',
    '-strip',
    output,
  ];
  // ImageMagick on Debian is usually `magick convert`; older versions
  // and Alpine are just `convert`. Try `magick` first, fall back.
  const cmd = process.env.PIXMEND_IM_CMD ?? 'magick';
  await new Promise<void>((resolve, reject) => {
    if (onProgress) onProgress(10);
    const tryRun = (bin: string, fallback?: string): void => {
      const argv = bin === 'magick' ? ['convert', ...args] : args;
      const p = spawn(bin, argv, { stdio: ['ignore', 'ignore', 'pipe'] });
      let stderr = '';
      p.stderr.on('data', (d) => (stderr += d));
      p.on('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'ENOENT' && fallback) {
          tryRun(fallback);
          return;
        }
        reject(err);
      });
      p.on('close', (code) => {
        if (code === 0) {
          if (onProgress) onProgress(100);
          resolve();
        } else {
          reject(new Error(`imagemagick exited ${code}: ${stderr.slice(0, 400)}`));
        }
      });
    };
    tryRun(cmd, cmd === 'magick' ? 'convert' : undefined);
  });
}

async function readDims(path: string): Promise<{ readonly w: number; readonly h: number }> {
  return new Promise((resolve, reject) => {
    if (DIMS_CMD === 'identify') {
      // ImageMagick — Linux/container path. `%w %h` is the most portable
      // shape across IM 6 and 7.
      const p = spawn('identify', ['-format', '%w %h', path]);
      let out = '';
      p.stdout.on('data', (d) => (out += d));
      p.on('close', () => {
        const [w, h] = out.trim().split(/\s+/).map(Number);
        resolve({ w: Number.isFinite(w) ? w : 0, h: Number.isFinite(h) ? h : 0 });
      });
      p.on('error', reject);
    } else {
      // macOS — `sips` ships with the OS, no install needed for local dev.
      const p = spawn('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', path]);
      let out = '';
      p.stdout.on('data', (d) => (out += d));
      p.on('close', () => {
        const w = Number((out.match(/pixelWidth:\s*(\d+)/) ?? [])[1] ?? 0);
        const h = Number((out.match(/pixelHeight:\s*(\d+)/) ?? [])[1] ?? 0);
        resolve({ w, h });
      });
      p.on('error', reject);
    }
  });
}

function guessKind(name: string): string {
  const n = name.toLowerCase();
  if (/portrait|face|selfie|person/i.test(n)) return 'portrait';
  if (/anime|drawing|cartoon|illust/i.test(n)) return 'anime';
  if (/screenshot|screen/i.test(n)) return 'screenshot';
  return 'photo';
}

serve({ fetch: app.fetch, port: PORT, hostname: HOST }, (info) => {
  console.log(`picenhancer listening on http://${HOST}:${info.port}`);
  console.log(`engine=${ENGINE}  dims=${DIMS_CMD}`);
  if (ENGINE === 'realesrgan') console.log(`bin=${BIN}  models=${MODELS}`);
  console.log(`ALDO API: ${ALDO_API}  | strategist: ${ENHANCE_SHARPER_ID || '(none)'}`);
});
