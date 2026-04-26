/**
 * Final-output diff. Renders the textual diff of the two runs' event
 * streams via the `diff` library. Inline red (removed) / green (added)
 * highlighting; unchanged spans are rendered in slate.
 *
 * The "final output" of a run, in v0, is the concatenation of its
 * event payloads — when the runtime grows a first-class `output` field
 * on `RunDetail` we'll switch to that. For now this gives the operator
 * a useful "what's different" view.
 */

import type { RunDetail } from '@aldo-ai/api-contract';
import { computeTextDiff, eventsToText } from './text-diff.js';

export function OutputDiffPanel({ a, b }: { a: RunDetail; b: RunDetail }) {
  const aText = eventsToText(a.events);
  const bText = eventsToText(b.events);

  if (aText.length === 0 && bText.length === 0) {
    return <p className="text-sm text-slate-500">No events recorded for either run yet.</p>;
  }

  const segments = computeTextDiff(aText, bText);

  return (
    <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded bg-slate-50 p-3 font-mono text-xs leading-relaxed text-slate-800">
      {segments.map((seg, i) => {
        if (seg.kind === 'added') {
          return (
            <span
              // biome-ignore lint/suspicious/noArrayIndexKey: <segments are stable for one render>
              key={i}
              className="rounded bg-emerald-100 px-0.5 text-emerald-900"
            >
              {seg.value}
            </span>
          );
        }
        if (seg.kind === 'removed') {
          return (
            <span
              // biome-ignore lint/suspicious/noArrayIndexKey: <segments are stable for one render>
              key={i}
              className="rounded bg-red-100 px-0.5 text-red-900 line-through"
            >
              {seg.value}
            </span>
          );
        }
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: <segments are stable for one render>
          <span key={i} className="text-slate-700">
            {seg.value}
          </span>
        );
      })}
    </pre>
  );
}
