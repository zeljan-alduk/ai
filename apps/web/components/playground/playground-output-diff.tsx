'use client';

/**
 * Compare button below the playground columns. Lets the operator pick
 * any two columns and renders a textual diff (red/green inline). Reuses
 * the same `computeTextDiff` helper as /runs/compare so behavior is
 * consistent across both surfaces.
 *
 * LLM-agnostic: diff operates on opaque text strings.
 */

import { Card, CardContent } from '@/components/ui/card';
import { useState } from 'react';
import { computeTextDiff } from '../runs-compare/text-diff.js';
import type { ColumnState } from './playground-state.js';

export function PlaygroundOutputDiff({ columns }: { columns: ReadonlyArray<ColumnState> }) {
  const [aId, setAId] = useState<string>(columns[0]?.modelId ?? '');
  const [bId, setBId] = useState<string>(columns[1]?.modelId ?? '');
  const [open, setOpen] = useState(false);

  const a = columns.find((c) => c.modelId === aId) ?? null;
  const b = columns.find((c) => c.modelId === bId) ?? null;
  const segs = a !== null && b !== null ? computeTextDiff(a.text, b.text) : null;

  return (
    <Card>
      <CardContent className="p-3 text-xs">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] uppercase tracking-wider text-slate-500">Compare:</span>
          <select
            value={aId}
            onChange={(e) => setAId(e.target.value)}
            className="rounded border border-slate-300 bg-white px-2 py-1 text-xs"
            aria-label="Column A for diff"
          >
            {columns.map((c) => (
              <option key={c.modelId} value={c.modelId}>
                {c.modelId}
              </option>
            ))}
          </select>
          <span className="text-slate-400">vs</span>
          <select
            value={bId}
            onChange={(e) => setBId(e.target.value)}
            className="rounded border border-slate-300 bg-white px-2 py-1 text-xs"
            aria-label="Column B for diff"
          >
            {columns.map((c) => (
              <option key={c.modelId} value={c.modelId}>
                {c.modelId}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="ml-auto rounded border border-slate-300 bg-white px-3 py-1 text-xs hover:bg-slate-50"
          >
            {open ? 'Hide diff' : 'Show diff'}
          </button>
        </div>
        {open && segs !== null ? (
          <pre className="mt-3 overflow-x-auto whitespace-pre-wrap break-words rounded bg-slate-50 p-3 font-mono text-xs leading-relaxed text-slate-800">
            {segs.map((seg, i) =>
              seg.kind === 'added' ? (
                <span
                  // biome-ignore lint/suspicious/noArrayIndexKey: stable for one render
                  key={i}
                  className="rounded bg-emerald-100 px-0.5 text-emerald-900"
                >
                  {seg.value}
                </span>
              ) : seg.kind === 'removed' ? (
                <span
                  // biome-ignore lint/suspicious/noArrayIndexKey: stable for one render
                  key={i}
                  className="rounded bg-red-100 px-0.5 text-red-900 line-through"
                >
                  {seg.value}
                </span>
              ) : (
                <span
                  // biome-ignore lint/suspicious/noArrayIndexKey: stable for one render
                  key={i}
                >
                  {seg.value}
                </span>
              ),
            )}
          </pre>
        ) : null}
      </CardContent>
    </Card>
  );
}
