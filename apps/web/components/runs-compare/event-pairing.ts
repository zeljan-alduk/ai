/**
 * Pure pairing logic for the side-by-side run comparison view.
 *
 * Pairs events by index where possible; when one run has fewer events
 * than the other, the missing slots are returned as `null` so the
 * renderer can stamp ghost rows. Lifted out of the React component so
 * the math is unit-testable without jsdom.
 *
 * Why index-pairing? Run events are ordered (timestamps + intra-run id
 * tiebreak), and operators comparing two runs of the SAME agent expect
 * "step 1 vs step 1, step 2 vs step 2". A future iteration could add a
 * type-aware aligner (DTW on event types) but the simple index pair is
 * the right v0 — it's predictable and matches the LangSmith / Braintrust
 * UX.
 *
 * LLM-agnostic: pairing reads only event timestamps + types; never a
 * model id or provider name.
 */

import type { RunEvent } from '@aldo-ai/api-contract';

export interface EventPair {
  /** 0-indexed slot in the longer-of-the-two arrays. */
  readonly index: number;
  readonly a: RunEvent | null;
  readonly b: RunEvent | null;
  /** True when both sides exist + their `type` strings match. */
  readonly typesMatch: boolean;
}

export function pairEvents(
  aEvents: ReadonlyArray<RunEvent>,
  bEvents: ReadonlyArray<RunEvent>,
): readonly EventPair[] {
  const len = Math.max(aEvents.length, bEvents.length);
  const out: EventPair[] = [];
  for (let i = 0; i < len; i++) {
    const a = aEvents[i] ?? null;
    const b = bEvents[i] ?? null;
    const typesMatch = a !== null && b !== null && a.type === b.type;
    out.push({ index: i, a, b, typesMatch });
  }
  return out;
}

/**
 * Compute a per-row x-extent for the vertical-stack flame visual:
 * normalises each event's offset-from-start against the longer of the
 * two runs' total spans so both stacks share an x axis.
 */
export interface PairedSpan {
  readonly index: number;
  readonly a: { readonly startMs: number; readonly endMs: number } | null;
  readonly b: { readonly startMs: number; readonly endMs: number } | null;
  /** Total span of the longer run, ms. Same for every row. */
  readonly totalMs: number;
}

export function pairedSpans(
  pairs: readonly EventPair[],
  aStart: string,
  bStart: string,
  aEnd: string | null,
  bEnd: string | null,
): readonly PairedSpan[] {
  const aStartMs = Date.parse(aStart);
  const bStartMs = Date.parse(bStart);
  const aTotal = aEnd ? Math.max(0, Date.parse(aEnd) - aStartMs) : 0;
  const bTotal = bEnd ? Math.max(0, Date.parse(bEnd) - bStartMs) : 0;
  const totalMs = Math.max(aTotal, bTotal, 1);
  return pairs.map((p) => {
    const aSpan =
      p.a !== null
        ? {
            startMs: Math.max(0, Date.parse(p.a.at) - aStartMs),
            // each event is point-in-time; render a 1ms tick so the bar
            // is visible (the renderer scales it).
            endMs: Math.max(0, Date.parse(p.a.at) - aStartMs) + 1,
          }
        : null;
    const bSpan =
      p.b !== null
        ? {
            startMs: Math.max(0, Date.parse(p.b.at) - bStartMs),
            endMs: Math.max(0, Date.parse(p.b.at) - bStartMs) + 1,
          }
        : null;
    return { index: p.index, a: aSpan, b: bSpan, totalMs };
  });
}
