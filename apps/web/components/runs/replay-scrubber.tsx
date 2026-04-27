'use client';

/**
 * Replay scrubber — the wave-12 "wow" feature.
 *
 * Animates the run's events in real-time order. The user can:
 *   - press play; the scrubber walks events in their actual
 *     wall-clock spacing (with an optional speedup factor),
 *   - drag the slider to scrub manually,
 *   - see each event surface in a stacked card list as it "fires".
 *
 * No cloud calls — every event is already in `run.events`. We never
 * speak to a model directly here; replay is purely a UI projection.
 *
 * LLM-agnostic: the only thing rendered per-event is the `type`
 * string and a JSON payload preview. No provider colour-coding.
 */

import { Button } from '@/components/ui/button';
import type { RunDetail, RunEvent } from '@aldo-ai/api-contract';
import { useEffect, useMemo, useRef, useState } from 'react';

const SPEEDS: ReadonlyArray<{ readonly label: string; readonly factor: number }> = [
  { label: '0.5×', factor: 0.5 },
  { label: '1×', factor: 1 },
  { label: '4×', factor: 4 },
  { label: '16×', factor: 16 },
  { label: '64×', factor: 64 },
];

export function ReplayScrubber({ run }: { run: RunDetail }) {
  const events = run.events;
  const tBounds = useMemo(() => computeBounds(events), [events]);
  const [tNow, setTNow] = useState<number>(tBounds.startMs);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(4);
  const rafRef = useRef<number | null>(null);
  const lastTickRef = useRef<number | null>(null);

  // Reset cursor when the run changes.
  useEffect(() => {
    setTNow(tBounds.startMs);
  }, [tBounds.startMs]);

  // RAF-driven playhead. We deliberately use rAF rather than setInterval
  // so the scrubber doesn't drift when the tab loses focus.
  useEffect(() => {
    if (!playing) {
      lastTickRef.current = null;
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      return;
    }
    function tick(now: number) {
      const last = lastTickRef.current;
      lastTickRef.current = now;
      if (last !== null) {
        const dt = (now - last) * speed;
        setTNow((prev) => {
          const next = prev + dt;
          if (next >= tBounds.endMs) {
            setPlaying(false);
            return tBounds.endMs;
          }
          return next;
        });
      }
      rafRef.current = requestAnimationFrame(tick);
    }
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [playing, speed, tBounds.endMs]);

  const elapsedMs = Math.max(0, tNow - tBounds.startMs);
  const totalMs = Math.max(1, tBounds.endMs - tBounds.startMs);
  const fired = events.filter((ev) => Date.parse(ev.at) <= tNow);

  return (
    <div className="overflow-hidden rounded-md border border-slate-200 bg-white">
      <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-4 py-3">
        <Button
          variant="default"
          size="sm"
          onClick={() => {
            if (tNow >= tBounds.endMs) setTNow(tBounds.startMs);
            setPlaying((p) => !p);
          }}
        >
          {playing ? 'Pause' : 'Play'}
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            setPlaying(false);
            setTNow(tBounds.startMs);
          }}
        >
          Reset
        </Button>
        <div className="flex items-center gap-1">
          {SPEEDS.map((s) => (
            <button
              key={s.label}
              type="button"
              onClick={() => setSpeed(s.factor)}
              className={`rounded px-2 py-0.5 text-[11px] font-medium ${
                speed === s.factor
                  ? 'bg-slate-900 text-white'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
        <span className="ml-auto font-mono text-xs tabular-nums text-slate-600">
          {formatMs(elapsedMs)} / {formatMs(totalMs)}
        </span>
      </div>
      <div className="px-4 py-3">
        <input
          type="range"
          min={tBounds.startMs}
          max={tBounds.endMs}
          step={Math.max(1, Math.round(totalMs / 1000))}
          value={tNow}
          onChange={(e) => {
            setPlaying(false);
            setTNow(Number(e.target.value));
          }}
          aria-label="Replay scrubber"
          className="w-full"
        />
      </div>
      <ol className="max-h-64 divide-y divide-slate-100 overflow-y-auto">
        {fired.length === 0 ? (
          <li className="px-4 py-6 text-center text-xs text-slate-500">
            Press Play to walk the run's events in real-time order.
          </li>
        ) : (
          fired.map((ev) => <ReplayEventRow key={ev.id} ev={ev} />)
        )}
      </ol>
    </div>
  );
}

function ReplayEventRow({ ev }: { ev: RunEvent }) {
  return (
    <li className="flex items-start gap-3 px-4 py-2 text-xs">
      <span className="mt-0.5 inline-block rounded-full bg-sky-100 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-sky-900">
        {ev.type}
      </span>
      <span className="text-[10px] text-slate-400">{ev.at.slice(11, 19)}</span>
      <span className="flex-1 truncate font-mono text-[11px] text-slate-600">
        {summarise(ev.payload)}
      </span>
    </li>
  );
}

function computeBounds(events: ReadonlyArray<RunEvent>): {
  readonly startMs: number;
  readonly endMs: number;
} {
  if (events.length === 0) {
    const now = Date.now();
    return { startMs: now, endMs: now + 1 };
  }
  let start = Number.POSITIVE_INFINITY;
  let end = 0;
  for (const ev of events) {
    const t = Date.parse(ev.at);
    if (Number.isNaN(t)) continue;
    if (t < start) start = t;
    if (t > end) end = t;
  }
  if (!Number.isFinite(start) || end <= start) {
    return { startMs: start, endMs: start + 1 };
  }
  return { startMs: start, endMs: end };
}

function summarise(payload: unknown): string {
  if (payload == null) return '';
  if (typeof payload === 'string') return payload;
  try {
    const json = JSON.stringify(payload);
    return json.length > 120 ? `${json.slice(0, 117)}…` : json;
  } catch {
    return String(payload);
  }
}

function formatMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${Math.round(s - m * 60)}s`;
}
