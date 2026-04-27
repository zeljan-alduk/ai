'use client';

/**
 * Side-by-side response columns. Each column shows model id, locality
 * badge, the streaming text area, and a footer line with latency +
 * token counts + USD. Copy-button copies the assembled output to the
 * clipboard.
 *
 * LLM-agnostic: model + locality fields render as opaque strings.
 */

import { NeutralBadge } from '@/components/badge';
import { Card, CardContent } from '@/components/ui/card';
import { formatUsd } from '@/lib/format';
import { useState } from 'react';
import type { ColumnState } from './playground-state.js';

const LOCALITY_TONE: Record<string, string> = {
  cloud: 'bg-sky-100 text-sky-800 border-sky-200',
  'on-prem': 'bg-amber-100 text-amber-800 border-amber-200',
  local: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  unknown: 'bg-slate-100 text-slate-700 border-slate-200',
};

export function PlaygroundColumns({ columns }: { columns: ReadonlyArray<ColumnState> }) {
  if (columns.length === 0) {
    return (
      <Card>
        <CardContent className="p-6 text-center text-sm text-slate-500">
          Press Run to fan the prompt out across eligible models.
        </CardContent>
      </Card>
    );
  }
  // Up to 5 columns; CSS grid with fluid columns keeps it readable.
  const gridClass =
    columns.length === 1
      ? 'grid-cols-1'
      : columns.length === 2
        ? 'grid-cols-1 lg:grid-cols-2'
        : columns.length === 3
          ? 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3'
          : 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5';
  return (
    <div className={`grid gap-3 ${gridClass}`}>
      {columns.map((c) => (
        <Column key={c.modelId} col={c} />
      ))}
    </div>
  );
}

function Column({ col }: { col: ColumnState }) {
  const [copied, setCopied] = useState(false);
  return (
    <Card>
      <CardContent className="p-3">
        <div className="mb-2 flex items-center justify-between gap-1">
          <span className="truncate font-mono text-[11px] text-slate-700" title={col.modelId}>
            {col.modelId}
          </span>
          <span
            className={`inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${
              LOCALITY_TONE[col.locality] ?? LOCALITY_TONE.unknown
            }`}
          >
            {col.locality}
          </span>
        </div>
        <div
          className={`min-h-[160px] overflow-y-auto rounded border p-2 font-mono text-xs ${
            col.status === 'error'
              ? 'border-red-200 bg-red-50 text-red-900'
              : 'border-slate-200 bg-slate-50 text-slate-800'
          }`}
        >
          {col.status === 'error' ? (
            <span>error: {col.error}</span>
          ) : col.text.length > 0 ? (
            <span className="whitespace-pre-wrap break-words">{col.text}</span>
          ) : col.status === 'streaming' ? (
            <span className="text-slate-400">streaming…</span>
          ) : (
            <span className="text-slate-400">—</span>
          )}
        </div>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[10px] text-slate-500">
          <span className="font-mono">
            {col.latencyMs}ms · {col.tokensIn}in/{col.tokensOut}out · {formatUsd(col.usd)}
          </span>
          <span className="flex items-center gap-2">
            <NeutralBadge>{col.status}</NeutralBadge>
            <button
              type="button"
              onClick={() => {
                if (typeof navigator !== 'undefined' && navigator.clipboard) {
                  void navigator.clipboard.writeText(col.text);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                }
              }}
              className="rounded border border-slate-200 px-2 py-0.5 text-[10px] text-slate-600 hover:bg-slate-50"
            >
              {copied ? 'copied' : 'copy'}
            </button>
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
