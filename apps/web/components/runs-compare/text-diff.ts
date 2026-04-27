/**
 * Pure helpers around the `diff` library for the run-comparison view.
 *
 * Wraps `diffWords` into a normalised list of segments that the React
 * component can render with red/green highlighting. Lifted out so the
 * unit tests pin the diff shape without jsdom.
 *
 * LLM-agnostic: operates only on opaque strings.
 */

import { diffWords } from 'diff';

export type DiffSegmentKind = 'unchanged' | 'added' | 'removed';

export interface DiffSegment {
  readonly kind: DiffSegmentKind;
  readonly value: string;
}

export function computeTextDiff(a: string, b: string): readonly DiffSegment[] {
  const parts = diffWords(a, b);
  const out: DiffSegment[] = [];
  for (const p of parts) {
    if (p.added) out.push({ kind: 'added', value: p.value });
    else if (p.removed) out.push({ kind: 'removed', value: p.value });
    else out.push({ kind: 'unchanged', value: p.value });
  }
  return out;
}

/** Normalise a run's events into a single textual blob for diffing.
 *  Permissive shape — accepts any object with `type` + `payload`
 *  fields (the wire `RunEvent` is one such shape). */
export interface DiffableEvent {
  readonly type: string;
  readonly payload?: unknown;
}

export function eventsToText(events: ReadonlyArray<DiffableEvent>): string {
  return events
    .map((e) => {
      const head = `[${e.type}]`;
      const body = payloadToText(e.payload);
      return body.length > 0 ? `${head} ${body}` : head;
    })
    .join('\n');
}

function payloadToText(p: unknown): string {
  if (p === null || p === undefined) return '';
  if (typeof p === 'string') return p;
  try {
    return JSON.stringify(p);
  } catch {
    return String(p);
  }
}
