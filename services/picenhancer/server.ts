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
import sharp from 'sharp';

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
// Upscale engine.
//   `aiplus`     — Real-ESRGAN x4 (generative SR) + GFPGAN v1.4 (face
//                  restore on detected faces) via a Python sidecar
//                  using PyTorch CPU. Slow (3–15 s/image) but actually
//                  competitive with Topaz/Tenorshare-class output on
//                  faces. Default. Requires the picenhancer container
//                  with Python deps + model weights pre-downloaded.
//   `realesrgan` — AI super-resolution via realesrgan-ncnn-vulkan
//                  binary. Great on a GPU host / Apple Silicon Metal;
//                  impractical on CPU-only VPS via Mesa llvmpipe.
//   `sharp`      — Lanczos-3 resize + perceptual sharpen via libvips
//                  (npm `sharp`). Pure-native, sub-second. Use for
//                  hosts without Python or as a graceful fallback.
type Engine = 'aiplus' | 'realesrgan' | 'sharp';
const ENGINE: Engine =
  process.env.PIXMEND_ENGINE === 'realesrgan' ? 'realesrgan' :
  process.env.PIXMEND_ENGINE === 'sharp' ? 'sharp' :
  'aiplus';
// Path to the Python interpreter inside the container. Override on
// macOS dev with PIXMEND_PYTHON=python3.
const PYTHON_BIN = process.env.PIXMEND_PYTHON ?? 'python3';
// Path to the AI-plus pipeline script. Resolves relative to this file
// at runtime (Docker COPY puts both at /opt/picenhancer/).
const ENHANCE_SCRIPT =
  process.env.PIXMEND_AIPLUS_SCRIPT ?? `${ROOT}/scripts/enhance.py`;
const MODELS_DIR = process.env.PIXMEND_MODELS_DIR ?? `${ROOT}/models`;

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
 * Pass plan for a target scale.
 *
 * `aiplus`: a single "pass" of the full Python pipeline — the script
 *   handles AI x4 + face restore + Lanczos extension to ×8/×16 in
 *   one call. Pass count is always 1; the per-pass `s` carries the
 *   target scale (4 / 8 / 16) directly to enhance.py.
 *
 * `realesrgan` / `sharp`: chain x4 passes. `-s 2` (realesrgan) or
 *   `lanczos3 ×2` (sharp) gives a smoother half-step than bicubic.
 *   ×8 = x4 + ×2; ×16 = x4 + x4. Type stays narrow because the binary
 *   only accepts 2 or 4 directly.
 */
type PassS = 1 | 2 | 4 | 8 | 16;
function planPasses(scale: 1 | 4 | 8 | 16): readonly { readonly s: PassS }[] {
  if (ENGINE === 'aiplus') return [{ s: scale }];
  // sharp / realesrgan engines don't support scale=1 (enhance-only) —
  // they always do at least an x4 SR pass. Treat scale=1 as a no-op
  // upscale (still runs through SR) so the engine semantics match the
  // user's intent of "do something to the image".
  const effective = scale === 1 ? 4 : scale;
  if (effective === 4) return [{ s: 4 }];
  if (effective === 8) return [{ s: 4 }, { s: 2 }];
  return [{ s: 4 }, { s: 4 }];
}

app.post('/enhance', async (c) => {
  const form = await c.req.parseBody();
  const file = form.file as File | undefined;
  if (!file) return c.text('missing file', 400);

  // Default scale = 1 (enhance only — no upscale, output same dims as
  // input). 4 / 8 / 16 enable Real-ESRGAN x4 + Lanczos extension.
  const rawScale = Number((form.scale as string | undefined) ?? '1');
  const scale: 1 | 4 | 8 | 16 =
    rawScale === 16 ? 16 : rawScale === 8 ? 8 : rawScale === 4 ? 4 : 1;

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
    let faces = 0;
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
        if (ENGINE === 'aiplus') {
          // pass.s carries the full target scale (4/8/16). One pass.
          const result = await runAiPlus(
            currentInput, outPath, pass.s as 1 | 4 | 8 | 16, onProgress,
          );
          faces = result.faces;
        } else if (ENGINE === 'realesrgan') {
          // Real-ESRGAN ncnn-vulkan only accepts -s 2 or -s 4.
          await runRealesrgan(currentInput, outPath, model, pass.s as 2 | 4, onProgress);
        } else {
          await runSharp(currentInput, outPath, pass.s as 2 | 4, onProgress);
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
      faces,
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
 * AI-plus engine — spawns the Python pipeline (Real-ESRGAN x4 + GFPGAN
 * face restore + Lanczos extension for ×8/×16). Parses NDJSON progress
 * events from stdout and maps them onto the existing onProgress
 * callback so the SSE bar moves naturally.
 *
 * The script's progress vocabulary:
 *   boot               -> 5%
 *   models_loading     -> 10%
 *   models_loaded      -> 25%
 *   inference_start    -> 30%
 *   progress (with pct as the canonical bar position)
 *   done               -> 100%
 *
 * Stderr is captured + included in the rejection message so a broken
 * model file or OOM surfaces with context, not just `python exited 1`.
 */
async function runAiPlus(
  input: string,
  output: string,
  scale: 1 | 4 | 8 | 16,
  onProgress?: (pct: number) => void,
): Promise<{ readonly faces: number; readonly ms: number }> {
  return new Promise((resolve, reject) => {
    const args = [
      ENHANCE_SCRIPT,
      '--input', input,
      '--output', output,
      '--scale', String(scale),
      '--face', '1',
      '--models-dir', MODELS_DIR,
    ];
    const p = spawn(PYTHON_BIN, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      // Force unbuffered stdout so the JSON-line progress arrives as
      // emitted, not at process exit.
      env: { ...process.env, PYTHONUNBUFFERED: '1' },
    });

    let stderr = '';
    let stdoutTail = '';
    let lastDone: { faces: number; ms: number } | null = null;

    const stageToPct: Record<string, number> = {
      boot: 5,
      models_loading: 10,
      models_loaded: 25,
      inference_start: 30,
    };

    p.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    p.stdout.on('data', (chunk) => {
      stdoutTail += chunk.toString();
      const lines = stdoutTail.split('\n');
      stdoutTail = lines.pop() ?? '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const ev = JSON.parse(trimmed) as { stage: string; pct?: number; faces?: number; ms?: number };
          if (ev.stage === 'done') {
            lastDone = { faces: ev.faces ?? 0, ms: ev.ms ?? 0 };
            onProgress?.(100);
          } else if (typeof ev.pct === 'number') {
            onProgress?.(ev.pct);
          } else if (ev.stage in stageToPct) {
            onProgress?.(stageToPct[ev.stage]);
          }
        } catch {
          // Non-JSON line — ignore (Python warnings, torch chatter).
        }
      }
    });
    p.on('error', reject);
    p.on('close', (code) => {
      if (code === 0 && lastDone) {
        resolve(lastDone);
      } else {
        reject(
          new Error(
            `aiplus pipeline exited ${code}: ${stderr.slice(-600).trim() || '(no stderr)'}`,
          ),
        );
      }
    });
  });
}

/**
 * Lanczos-3 resize + perceptual sharpen via sharp/libvips. Pure native,
 * no shelling out, no binary-on-PATH gotchas. Sub-second on a typical
 * VPS for typical inputs; quality is the same kernel that Photoshop
 * Bicubic Sharper roughly aims at — clean gradients, restored edges,
 * no halo on a sane sigma.
 *
 * Emits a 10% tick on entry and a 100% tick on completion so the UI
 * progress bar animates; the actual work is too fast to stream
 * meaningful intermediate progress.
 */
async function runSharp(
  input: string,
  output: string,
  s: 2 | 4,
  onProgress?: (pct: number) => void,
): Promise<void> {
  if (onProgress) onProgress(10);
  // Read the source dims; sharp's resize accepts an absolute width/height.
  const { width = 0, height = 0 } = await sharp(input).metadata();
  if (!width || !height) throw new Error('sharp: failed to read input dimensions');
  await sharp(input)
    .resize({
      width: width * s,
      height: height * s,
      kernel: 'lanczos3',
      withoutEnlargement: false,
    })
    // Perceptual sharpen — sigma=1.0 is gentle; m1=1.0 / m2=2.0 ratio
    // keeps the edge boost real without introducing visible halos.
    .sharpen({ sigma: 1.0, m1: 1.0, m2: 2.0 })
    .png({ compressionLevel: 6, adaptiveFiltering: true })
    .toFile(output);
  if (onProgress) onProgress(100);
}

async function readDims(path: string): Promise<{ readonly w: number; readonly h: number }> {
  // Prefer sharp's native metadata read — works on every platform sharp
  // ships a prebuilt binary for (Linux x64/arm64, macOS arm64/x64).
  // Falls back to `identify`/`sips` only when PIXMEND_DIMS_CMD is set
  // explicitly, kept for ops who have a reason to use the CLI tools.
  if (!process.env.PIXMEND_DIMS_CMD) {
    const meta = await sharp(path).metadata();
    return { w: meta.width ?? 0, h: meta.height ?? 0 };
  }
  return new Promise((resolve, reject) => {
    if (DIMS_CMD === 'identify') {
      const p = spawn('identify', ['-format', '%w %h', path]);
      let out = '';
      p.stdout.on('data', (d) => (out += d));
      p.on('close', () => {
        const [w, h] = out.trim().split(/\s+/).map(Number);
        resolve({ w: Number.isFinite(w) ? w : 0, h: Number.isFinite(h) ? h : 0 });
      });
      p.on('error', reject);
    } else {
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
  if (ENGINE === 'aiplus') console.log(`python=${PYTHON_BIN}  script=${ENHANCE_SCRIPT}  models=${MODELS_DIR}`);
  if (ENGINE === 'realesrgan') console.log(`bin=${BIN}  models=${MODELS}`);
  console.log(`ALDO API: ${ALDO_API}  | strategist: ${ENHANCE_SHARPER_ID || '(none)'}`);
});
