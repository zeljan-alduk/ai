'use client';

/**
 * Client surface for /live/picenhancer.
 *
 * Drop / paste / click upload + ×4/×8/×16 segmented picker + SSE-driven
 * progress bar + before/after pair + download link. Identical pipeline
 * to /tmp/pixmend-stack/public/index.html, ported to React + the
 * existing app's semantic Tailwind tokens (bg, fg, accent, border, …)
 * so it inherits dark mode and feels native to ai.aldo.tech.
 *
 * Calls go through this app's own API routes (./api/enhance and
 * ./api/out/<name>) which proxy to the pixmend Hono backend. A 503
 * from the proxy means the runtime isn't enabled on this server yet
 * — surfaced inline rather than as an opaque "failed".
 */

import { cn } from '@/lib/cn';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

type Scale = 1 | 4 | 8 | 16;

// Action = a (scale, bg) pair the UI shows as one button. Keeping
// these as discrete options instead of two pickers because they're
// not orthogonal — "Upscale" implies you also want a clean
// background, "Enhance" alone implies don't touch it.
type Action = 'enhance' | 'enhance-bg' | 'upscale-4' | 'upscale-8';

const ACTION_ORDER: readonly Action[] = ['enhance', 'enhance-bg', 'upscale-4', 'upscale-8'];

const ACTION_LABELS: Record<Action, string> = {
  'enhance': 'Enhance',
  'enhance-bg': 'Enhance + bg',
  'upscale-4': 'Upscale ×4',
  'upscale-8': 'Upscale ×8',
};

const ACTION_HINTS: Record<Action, string> = {
  'enhance': 'Restore faces, keep dimensions, leave background alone. Fastest — 5–15 s.',
  'enhance-bg': 'Restore faces + clean background via Real-ESRGAN, same dimensions. 10–25 s.',
  'upscale-4': 'Restore faces + Real-ESRGAN ×4 super-resolution. 15–30 s on a portrait.',
  'upscale-8': 'AI ×4 then Lanczos ×2 on top. Roughly 1.2× the wall time of ×4.',
};

const ACTION_PARAMS: Record<Action, { scale: Scale; bg: '0' | '1' }> = {
  'enhance':    { scale: 1, bg: '0' },
  'enhance-bg': { scale: 1, bg: '1' },
  'upscale-4':  { scale: 4, bg: '1' },
  'upscale-8':  { scale: 8, bg: '1' },
};

interface DoneEvent {
  type: 'done';
  imageUrl: string;
  filename?: string;
  scale: Scale;
  origDims: { w: number; h: number };
  origBytes: number;
  enhancedDims: { w: number; h: number };
  enhancedBytes: number;
  enhanceMs: number;
  engine?: 'aiplus' | 'realesrgan' | 'sharp';
  faces?: number;
  bg?: 0 | 1;
  weight?: number;
}

export function PicenhancerClient() {
  const [action, setAction] = useState<Action>('enhance');
  const [weight, setWeight] = useState<number>(0.7);
  const scale = ACTION_PARAMS[action].scale;
  const [origUrl, setOrigUrl] = useState<string | null>(null);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [resultBlobUrl, setResultBlobUrl] = useState<string | null>(null);
  const [planText, setPlanText] = useState<string>('');
  const [progress, setProgress] = useState<{
    label: string;
    pct: number;
    indeterminate: boolean;
    totalPasses: number;
    activeIdx: number;
    doneIdx: number;
  } | null>(null);
  const [final, setFinal] = useState<DoneEvent | null>(null);
  const [walltimeMs, setWalltimeMs] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Keep the most recent object URLs for the originals so we don't leak
  // them on subsequent uploads.
  const lastOrigUrl = useRef<string | null>(null);
  const lastBlobUrl = useRef<string | null>(null);
  useEffect(
    () => () => {
      if (lastOrigUrl.current) URL.revokeObjectURL(lastOrigUrl.current);
      if (lastBlobUrl.current) URL.revokeObjectURL(lastBlobUrl.current);
    },
    [],
  );

  const submit = useCallback(
    async (f: File) => {
      setError(null);
      setBusy(true);
      setFinal(null);
      setResultUrl(null);
      // Reset prior-run wall-clock so the LATENCY card doesn't show a
      // stale value while the new request streams.
      setWalltimeMs(null);
      if (lastOrigUrl.current) URL.revokeObjectURL(lastOrigUrl.current);
      if (lastBlobUrl.current) URL.revokeObjectURL(lastBlobUrl.current);
      const ou = URL.createObjectURL(f);
      lastOrigUrl.current = ou;
      setOrigUrl(ou);
      setResultBlobUrl(null);
      setPlanText('Calling ALDO strategist…');
      setProgress({
        label: 'Uploading + asking strategist …',
        pct: 0,
        indeterminate: true,
        totalPasses: 1,
        activeIdx: -1,
        doneIdx: 0,
      });

      const t0 = performance.now();
      const params = ACTION_PARAMS[action];
      const fd = new FormData();
      fd.append('file', f);
      fd.append('scale', String(params.scale));
      fd.append('bg', params.bg);
      fd.append('weight', weight.toFixed(2));

      try {
        const res = await fetch('/live/picenhancer/api/enhance', {
          method: 'POST',
          body: fd,
        });
        if (!res.ok) {
          const txt = await res.text();
          throw new Error(`${res.status === 503 ? 'Backend offline — ' : ''}${txt || `HTTP ${res.status}`}`);
        }
        if (!res.body) throw new Error('no response body');

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = '';
        let totalPasses = 1;
        let activeIdx = -1;
        let doneIdx = 0;
        let final: DoneEvent | null = null;

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          let idx: number;
          while ((idx = buf.indexOf('\n\n')) >= 0) {
            const frame = buf.slice(0, idx);
            buf = buf.slice(idx + 2);
            const line = frame.split('\n').find((l) => l.startsWith('data:'));
            if (!line) continue;
            const ev = JSON.parse(line.slice(5).trim()) as Record<string, unknown>;
            const type = ev.type as string;
            if (type === 'accepted') {
              totalPasses = (ev.passes as number) ?? 1;
              const od = ev.origDims as { w: number; h: number };
              setProgress({
                label: `Accepted · ×${ev.scale} · ${od.w}×${od.h}`,
                pct: 0,
                indeterminate: true,
                totalPasses,
                activeIdx: -1,
                doneIdx: 0,
              });
            } else if (type === 'plan' && ev.status === 'start') {
              setProgress((p) =>
                p ? { ...p, label: 'Strategist plan from ALDO …' } : p,
              );
            } else if (type === 'plan' && ev.status === 'done') {
              setPlanText(String(ev.text ?? ''));
              setProgress((p) =>
                p ? { ...p, label: 'Strategist plan ready · spawning Real-ESRGAN …' } : p,
              );
            } else if (type === 'enhance' && ev.status === 'start') {
              activeIdx = (ev.pass as number) - 1;
              doneIdx = (ev.pass as number) - 1;
              setProgress({
                label: `Upscale pass ${ev.pass}/${ev.of} · ×${ev.s}`,
                pct: ((doneIdx) / totalPasses) * 100,
                indeterminate: false,
                totalPasses,
                activeIdx,
                doneIdx,
              });
            } else if (type === 'enhance' && ev.status === 'progress') {
              setProgress({
                label: `Upscale pass ${ev.pass}/${ev.of} · ${ev.pct}% of pass`,
                pct: Number(ev.globalPct),
                indeterminate: false,
                totalPasses,
                activeIdx,
                doneIdx,
              });
            } else if (type === 'enhance' && ev.status === 'done') {
              doneIdx = ev.pass as number;
              activeIdx = doneIdx < totalPasses ? doneIdx : -1;
              setProgress({
                label: `Pass ${ev.pass}/${ev.of} done`,
                pct: (doneIdx / totalPasses) * 100,
                indeterminate: false,
                totalPasses,
                activeIdx,
                doneIdx,
              });
            } else if (type === 'error') {
              throw new Error(String(ev.message ?? 'enhancement failed'));
            } else if (type === 'done') {
              final = ev as unknown as DoneEvent;
            }
          }
        }
        if (!final) throw new Error('stream ended without a result');

        setFinal(final);
        setWalltimeMs(Math.round(performance.now() - t0));
        setProgress({
          label: `Done · ${totalPasses === 1 ? '1 pass' : `${totalPasses} passes`} · ${final.enhanceMs} ms`,
          pct: 100,
          indeterminate: false,
          totalPasses,
          activeIdx: -1,
          doneIdx: totalPasses,
        });

        // Fetch the produced image through the proxy — pixmend writes
        // the file relative to its own /out, the proxy re-serves it.
        const enhancedRes = await fetch(`/live/picenhancer/api${final.imageUrl}`);
        if (!enhancedRes.ok) throw new Error('failed to fetch enhanced image');
        const blob = await enhancedRes.blob();
        const blobUrl = URL.createObjectURL(blob);
        lastBlobUrl.current = blobUrl;
        setResultBlobUrl(blobUrl);
        setResultUrl(final.imageUrl);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setProgress(null);
      } finally {
        setBusy(false);
      }
    },
    [action, weight],
  );

  // Clipboard paste — anywhere on the page.
  useEffect(() => {
    function onPaste(e: ClipboardEvent) {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (item.kind === 'file' && item.type.startsWith('image/')) {
          const blob = item.getAsFile();
          if (!blob) continue;
          e.preventDefault();
          const ext = (blob.type.split('/')[1] ?? 'png').replace('jpeg', 'jpg');
          const named = new File(
            [blob],
            blob.name && blob.name !== 'image.png' ? blob.name : `pasted-${Date.now()}.${ext}`,
            { type: blob.type },
          );
          void submit(named);
          return;
        }
      }
    }
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [submit]);

  const actionHint = useMemo(() => ACTION_HINTS[action], [action]);

  return (
    <div className="mt-8 space-y-6">
      {/* Action picker — Enhance is default; Upscale modes are opt-in. */}
      <div className="flex flex-wrap items-center gap-3">
        <span className="font-mono text-[11px] uppercase tracking-[0.09em] text-fg-muted">
          Action
        </span>
        <div
          role="group"
          aria-label="Enhancement mode"
          className="inline-flex overflow-hidden rounded-md border border-border bg-bg-elevated"
        >
          {ACTION_ORDER.map((a) => (
            <button
              key={a}
              type="button"
              onClick={() => setAction(a)}
              aria-pressed={action === a}
              className={cn(
                'min-w-touch px-3 py-2 font-mono text-[12px] font-semibold transition-colors border-r border-border last:border-r-0',
                action === a
                  ? 'bg-accent/15 text-accent'
                  : 'text-fg-muted hover:text-fg hover:bg-bg-subtle',
              )}
              disabled={busy}
            >
              {ACTION_LABELS[a]}
            </button>
          ))}
        </div>
        <span className="text-[12px] text-fg-faint flex-1 min-w-[180px]">{actionHint}</span>
      </div>

      {/* GFPGAN strength slider — preserves more of the source person's
          character at lower values; pushes toward GFPGAN's idealised
          face at higher values. Sweet spot 0.6–0.8. */}
      <div className="flex flex-wrap items-center gap-3">
        <label
          htmlFor="picenhancer-strength"
          className="font-mono text-[11px] uppercase tracking-[0.09em] text-fg-muted"
        >
          Strength
        </label>
        <input
          id="picenhancer-strength"
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={weight}
          onChange={(e) => setWeight(Number(e.target.value))}
          disabled={busy}
          className="h-1 w-44 cursor-pointer accent-accent disabled:opacity-50"
        />
        <span className="font-mono text-[12px] text-accent w-10 text-right">
          {Math.round(weight * 100)}%
        </span>
        <span className="text-[12px] text-fg-faint">
          Lower preserves the source face; higher pushes toward GFPGAN&rsquo;s ideal.
        </span>
      </div>

      {/* Drop zone */}
      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const f = e.dataTransfer.files[0];
          if (f) void submit(f);
        }}
        disabled={busy}
        className={cn(
          'block w-full rounded-2xl border-2 border-dashed bg-bg-elevated px-6 py-14 text-center transition-colors',
          dragOver
            ? 'border-accent bg-accent/5'
            : 'border-border hover:border-accent/60 hover:bg-accent/5',
          busy && 'opacity-60 cursor-not-allowed',
        )}
      >
        <div className="text-[17px] font-semibold text-fg">
          Drop, paste, or click to upload
        </div>
        <div className="mt-1.5 text-[13px] text-fg-muted">
          JPG, PNG, WebP — up to 25 MB ·{' '}
          <kbd className="inline-block rounded border-b-2 border border-border bg-bg px-1.5 py-0.5 font-mono text-[11px] font-semibold text-fg">
            ⌘V
          </kbd>{' '}
          /{' '}
          <kbd className="inline-block rounded border-b-2 border border-border bg-bg px-1.5 py-0.5 font-mono text-[11px] font-semibold text-fg">
            Ctrl+V
          </kbd>{' '}
          to paste
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void submit(f);
          }}
        />
      </button>

      {/* Error surface */}
      {error && (
        <div className="rounded-lg border border-danger/40 bg-danger/10 px-4 py-3 font-mono text-[13px] text-danger">
          ⚠ {error}
        </div>
      )}

      {(progress || final) && (
        <>
          {/* Strategist plan */}
          <section className="rounded-xl border border-border bg-bg-elevated p-5">
            <h2 className="font-mono text-[11px] font-semibold uppercase tracking-[0.09em] text-fg-muted">
              Strategist plan{' '}
              <span className="font-sans normal-case tracking-normal text-fg-faint">
                (via ALDO `enhance-sharper` prompt → local model)
              </span>
            </h2>
            <pre className="mt-3 whitespace-pre-wrap rounded-md border border-border bg-bg p-3 font-mono text-[13px] leading-relaxed text-fg">
              {planText}
            </pre>
          </section>

          {/* Progress */}
          <section className="rounded-xl border border-border bg-bg-elevated p-5">
            <h2 className="font-mono text-[11px] font-semibold uppercase tracking-[0.09em] text-fg-muted">
              Pipeline
            </h2>
            <div className="mt-3 flex items-center justify-between font-mono text-[12px] text-fg-muted">
              <span>{progress?.label ?? 'Idle'}</span>
              <span className="text-accent">
                {progress?.indeterminate ? '…' : `${Math.round(progress?.pct ?? 0)}%`}
              </span>
            </div>
            <div
              className={cn(
                'mt-2 h-2 overflow-hidden rounded-full border border-border bg-bg',
                progress?.indeterminate && 'overflow-hidden',
              )}
            >
              {progress?.indeterminate ? (
                <div className="h-full w-1/3 animate-[picenhancer-slide_1.2s_ease-in-out_infinite] rounded-full bg-accent" />
              ) : (
                <div
                  className="h-full rounded-full bg-accent transition-[width] duration-200 ease-out"
                  style={{ width: `${Math.max(0, Math.min(100, progress?.pct ?? 0))}%` }}
                />
              )}
            </div>
            <style>{`@keyframes picenhancer-slide { 0% { transform: translateX(-100%); } 100% { transform: translateX(380%); } }`}</style>
            {progress && progress.totalPasses > 1 && (
              <div className="mt-3 flex gap-2">
                {Array.from({ length: progress.totalPasses }).map((_, i) => (
                  <div
                    key={i}
                    className={cn(
                      'flex-1 rounded-md border px-2 py-1.5 text-center font-mono text-[11px] font-semibold uppercase tracking-wider transition-colors',
                      i < progress.doneIdx
                        ? 'border-accent/35 bg-bg text-fg'
                        : i === progress.activeIdx
                          ? 'border-accent bg-accent/10 text-accent'
                          : 'border-border bg-bg text-fg-muted',
                    )}
                  >
                    Pass {i + 1}/{progress.totalPasses}
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Before/After */}
          <section className="rounded-xl border border-border bg-bg-elevated p-5">
            <h2 className="font-mono text-[11px] font-semibold uppercase tracking-[0.09em] text-fg-muted">
              Before / After
            </h2>
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <figure className="overflow-hidden rounded-lg border border-border bg-bg">
                <figcaption className="border-b border-border bg-bg-elevated px-3 py-2 font-mono text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
                  Original
                </figcaption>
                {origUrl ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img src={origUrl} alt="Original" className="block h-auto w-full" />
                ) : (
                  <div className="flex h-32 items-center justify-center text-fg-faint text-sm">
                    waiting…
                  </div>
                )}
              </figure>
              <figure className="overflow-hidden rounded-lg border border-border bg-bg">
                <figcaption className="border-b border-border bg-bg-elevated px-3 py-2 font-mono text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
                  Enhanced (×{final?.scale ?? scale})
                  {final?.engine && (
                    <span className="ml-2 normal-case tracking-normal text-fg-faint">
                      · {engineCaption(final)}
                    </span>
                  )}
                </figcaption>
                {resultBlobUrl ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img src={resultBlobUrl} alt="Enhanced" className="block h-auto w-full" />
                ) : busy && origUrl ? (
                  <DiffusionStage
                    src={origUrl}
                    pct={progress?.pct ?? 0}
                    indeterminate={progress?.indeterminate ?? true}
                  />
                ) : (
                  <div className="flex h-32 items-center justify-center text-fg-faint text-sm">
                    waiting…
                  </div>
                )}
              </figure>
            </div>

            <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat
                label="Original"
                value={
                  final
                    ? `${final.origDims.w}×${final.origDims.h} · ${prettyBytes(final.origBytes)}`
                    : '—'
                }
              />
              <Stat
                label="Enhanced"
                value={
                  final
                    ? `${final.enhancedDims.w}×${final.enhancedDims.h} · ${prettyBytes(final.enhancedBytes)}`
                    : '—'
                }
              />
              <Stat
                label="Latency"
                value={walltimeMs !== null ? `${walltimeMs} ms` : '—'}
              />
              <Stat label="Cost" value="$0.00" valueClass="text-accent" />
            </dl>

            {resultBlobUrl && final && (
              <a
                href={resultBlobUrl}
                download={final.filename ?? 'enhanced.png'}
                className="mt-5 inline-flex items-center rounded-md bg-accent px-4 py-2 text-sm font-semibold text-bg transition-opacity hover:opacity-90"
              >
                Download enhanced ↓
              </a>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  valueClass,
}: {
  label: string;
  value: string;
  valueClass?: string;
}) {
  return (
    <div className="rounded-md border border-border bg-bg p-3">
      <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-fg-faint">
        {label}
      </div>
      <div className={cn('mt-1 text-[15px] font-semibold text-fg', valueClass)}>{value}</div>
    </div>
  );
}

function prettyBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * Truthful AFTER-figure caption. Names what actually ran:
 *   - aiplus + faces > 0 + bg=1 → "Real-ESRGAN + GFPGAN · N face(s)"
 *   - aiplus + faces > 0 + bg=0 → "GFPGAN · N face(s)"
 *   - aiplus + faces == 0 + bg=1 → "Real-ESRGAN x4 (no faces)"
 *   - aiplus + faces == 0 + bg=0 → "Passthrough (no faces)"
 *   - other engines unchanged
 */
function engineCaption(final: DoneEvent): string {
  if (final.engine === 'realesrgan') return 'Real-ESRGAN AI';
  if (final.engine === 'sharp') return 'Lanczos-3 (libvips)';
  if (final.engine !== 'aiplus') return final.engine ?? '';
  const faces = final.faces ?? 0;
  const bg = final.bg ?? (final.scale > 1 ? 1 : 0);
  const facePart =
    faces > 0
      ? `GFPGAN · ${faces} face${faces === 1 ? '' : 's'} restored`
      : 'no faces detected';
  const bgPart = bg ? 'Real-ESRGAN bg + ' : '';
  return faces > 0 ? `${bgPart}${facePart}` : `${bg ? 'Real-ESRGAN background' : 'Passthrough'} (${facePart})`;
}

/**
 * Diffusion-style processing animation. Shown in the AFTER pane while
 * the request is in flight, in place of "enhancing…". Renders the
 * source image with a progressive deblur tied to the SSE bar's pct,
 * plus an SVG turbulence noise overlay that scrambles every ~150 ms
 * and fades as pct climbs. The metaphor is a diffusion model
 * progressively denoising the image into the final result.
 *
 * Pure visual — does no actual work, doesn't block the SSE stream,
 * doesn't read from the network. Just turns dead-air-during-inference
 * into something the visitor wants to watch.
 */
function DiffusionStage({
  src,
  pct,
  indeterminate,
}: {
  src: string;
  pct: number;
  indeterminate: boolean;
}) {
  const [seed, setSeed] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setSeed((s) => (s + 1) % 1024), 150);
    return () => window.clearInterval(id);
  }, []);

  // When indeterminate (boot / model-loading / SSE keepalive), show
  // ~30% deblur so the bar looks alive even though pct is 0.
  const visualPct = indeterminate ? 30 : Math.max(0, Math.min(100, pct));
  const blur = 18 - visualPct * 0.16;        // 18 → 2 px
  const sat = 0.5 + visualPct * 0.005;       // 0.5 → 1.0
  const noiseOpacity = Math.max(0.06, 0.65 - visualPct * 0.0065); // 0.65 → 0.06

  return (
    <div className="relative w-full">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt="processing"
        className="block h-auto w-full transition-[filter] duration-300 ease-out"
        style={{ filter: `blur(${blur}px) saturate(${sat})` }}
      />
      <svg
        className="pointer-events-none absolute inset-0 h-full w-full mix-blend-overlay"
        aria-hidden
      >
        <filter id={`pn-${seed}`}>
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.85"
            numOctaves={2}
            seed={seed}
            stitchTiles="stitch"
          />
        </filter>
        <rect
          width="100%"
          height="100%"
          filter={`url(#pn-${seed})`}
          opacity={noiseOpacity}
        />
      </svg>
      {/* Subtle accent vignette — pulses with the noise so the stage
          reads as "processing", not "broken image". */}
      <div
        className="pointer-events-none absolute inset-0 ring-1 ring-inset ring-accent/20"
        style={{ boxShadow: 'inset 0 0 60px rgba(94, 234, 212, 0.10)' }}
      />
    </div>
  );
}
