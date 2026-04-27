/**
 * Event-by-event diff. Pairs by index via `pairEvents`; renders two
 * vertical stacks (one per run) where each row is a thin colored bar
 * positioned by the event's offset-from-start. Mismatched event types
 * get an amber row-highlight; missing slots are rendered as ghost
 * (dashed) rows so the operator can see the length-difference.
 *
 * Visual style mirrors the wave-12 flame graph (Engineer T) — rows
 * stacked vertically instead of horizontally.
 */

import { NeutralBadge } from '@/components/badge';
import type { RunDetail, RunEvent } from '@aldo-ai/api-contract';
import { type EventPair, pairEvents, pairedSpans } from './event-pairing.js';

const ROW_HEIGHT = 22;
const TRACK_HEIGHT = 14;

const TYPE_COLORS: Record<string, string> = {
  'run.started': 'bg-emerald-300',
  message: 'bg-sky-300',
  tool_call: 'bg-violet-300',
  tool_result: 'bg-violet-200',
  checkpoint: 'bg-slate-300',
  policy_decision: 'bg-amber-300',
  error: 'bg-red-400',
  'run.completed': 'bg-emerald-400',
  'run.cancelled': 'bg-zinc-400',
  'routing.privacy_sensitive_resolved': 'bg-yellow-300',
  'composite.child_started': 'bg-indigo-300',
  'composite.child_completed': 'bg-indigo-400',
  'composite.child_failed': 'bg-red-300',
  'composite.usage_rollup': 'bg-fuchsia-300',
  'composite.iteration': 'bg-cyan-300',
};

function colorFor(type: string): string {
  return TYPE_COLORS[type] ?? 'bg-slate-300';
}

export function EventDiffPanel({ a, b }: { a: RunDetail; b: RunDetail }) {
  const pairs = pairEvents(a.events, b.events);
  const spans = pairedSpans(pairs, a.startedAt, b.startedAt, a.endedAt, b.endedAt);

  if (pairs.length === 0) {
    return <p className="text-sm text-slate-500">No events recorded for either run yet.</p>;
  }

  return (
    <div className="grid grid-cols-[1fr_2fr_2fr_1fr] gap-2 text-xs">
      <div className="font-medium text-slate-500">#</div>
      <div className="font-medium text-slate-500">A</div>
      <div className="font-medium text-slate-500">B</div>
      <div className="font-medium text-slate-500">Match</div>
      {pairs.map((p) => (
        <Row key={p.index} pair={p} span={spans[p.index]} />
      ))}
    </div>
  );
}

function Row({
  pair,
  span,
}: {
  pair: EventPair;
  span: ReturnType<typeof pairedSpans>[number] | undefined;
}) {
  return (
    <>
      <div className="text-slate-400 font-mono">{pair.index + 1}</div>
      <Track event={pair.a} span={span?.a ?? null} totalMs={span?.totalMs ?? 1} />
      <Track event={pair.b} span={span?.b ?? null} totalMs={span?.totalMs ?? 1} />
      <div>
        {pair.a !== null && pair.b !== null ? (
          pair.typesMatch ? (
            <NeutralBadge>=</NeutralBadge>
          ) : (
            <span
              className="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-800"
              title={`A=${pair.a.type} vs B=${pair.b.type}`}
            >
              ≠ types
            </span>
          )
        ) : (
          <span
            className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-500"
            title="One side has no event at this index"
          >
            gap
          </span>
        )}
      </div>
    </>
  );
}

function Track({
  event,
  span,
  totalMs,
}: {
  event: RunEvent | null;
  span: { startMs: number; endMs: number } | null;
  totalMs: number;
}) {
  if (event === null || span === null) {
    return (
      <div
        className="rounded border border-dashed border-slate-200 bg-slate-50/50"
        style={{ height: ROW_HEIGHT }}
        title="No event at this index"
      />
    );
  }
  const xPct = clamp((span.startMs / totalMs) * 100, 0, 100);
  // Render a fixed-min-width bar so single-tick events stay visible.
  const wPct = Math.max(2, ((span.endMs - span.startMs) / totalMs) * 100);
  return (
    <div
      className="relative rounded border border-slate-200 bg-slate-50"
      style={{ height: ROW_HEIGHT }}
      title={`${event.type} @ ${event.at}`}
    >
      <div
        className={`absolute top-1/2 -translate-y-1/2 rounded ${colorFor(event.type)}`}
        style={{
          left: `${xPct}%`,
          width: `${wPct}%`,
          height: TRACK_HEIGHT,
        }}
      />
      <span className="absolute left-2 top-1/2 -translate-y-1/2 font-mono text-[10px] text-slate-700">
        {event.type}
      </span>
    </div>
  );
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}
