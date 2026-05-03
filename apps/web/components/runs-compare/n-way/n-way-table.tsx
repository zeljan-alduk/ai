/**
 * The N-way comparison table — sticky first column (row labels),
 * sticky horizontal scroll for the columns. Rendering is a flat
 * `grid grid-cols-[12rem_repeat(N,minmax(14rem,1fr))]` so the layout
 * stays predictable as N grows.
 *
 * Cell colour comes from the `tag` enum on each cell:
 *   - `divergent` → amber outline (this cell deviates from the
 *     row's median / majority)
 *   - `baseline`  → emerald-tinted outline (the row's reference)
 *   - `match` / `none` → no decoration
 *
 * The "Final output" row is rendered as a per-cell collapsible block
 * so dense pages stay readable; everything else is single-line.
 */

import { NeutralBadge, StatusBadge } from '@/components/badge';
import { formatDuration, formatRelativeTime } from '@/lib/format';
import type { RunStatus } from '@aldo-ai/api-contract';
import Link from 'next/link';
import { NWayRemoveButton } from './n-way-remove-button';
import type { ComparisonColumn, ComparisonRow } from './n-way-rows';
import { NWayToolCallsRow } from './n-way-tool-calls-row';

export function NWayTable({
  columns,
  rows,
  ids,
  showOnlyDiffs,
  showOnlyMetrics,
}: {
  columns: readonly ComparisonColumn[];
  rows: readonly ComparisonRow[];
  ids: readonly string[];
  showOnlyDiffs: boolean;
  showOnlyMetrics: boolean;
}) {
  const visible = rows.filter((r) => {
    if (showOnlyDiffs && !r.hasDiff) return false;
    if (showOnlyMetrics && !r.isMetric) return false;
    return true;
  });

  const gridCols = `12rem repeat(${columns.length}, minmax(14rem, 1fr))`;

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-bg-elevated">
      <div className="overflow-x-auto">
        <div
          aria-label="Side-by-side run comparison"
          className="min-w-full"
          style={{ display: 'grid', gridTemplateColumns: gridCols }}
        >
          {/* ---- header row ---- */}
          <div className="sticky left-0 top-0 z-30 border-b border-border bg-bg-subtle px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-fg-faint">
            Field
          </div>
          {columns.map((c, i) => (
            <ColumnHeader
              key={`${c.id}-${i}`}
              column={c}
              ids={ids}
              indexLabel={`${i + 1}`}
              canRemove={ids.length > 1}
            />
          ))}

          {/* ---- body rows ---- */}
          {visible.map((row) => (
            <RowGroup
              key={row.key}
              row={row}
              columns={columns}
              isLast={visible[visible.length - 1]?.key === row.key}
            />
          ))}

          {/* Tool-call expandable row appended last (its own client island). */}
          {!showOnlyMetrics && !(showOnlyDiffs && allMatchToolCallCounts(columns)) ? (
            <NWayToolCallsRow columns={columns} />
          ) : null}
        </div>
      </div>
      {visible.length === 0 && !showOnlyMetrics ? (
        <div className="border-t border-border px-4 py-6 text-center text-xs text-fg-faint">
          No diverging fields with the current filter. Toggle "Show only diffs" off to see all
          fields.
        </div>
      ) : null}
    </div>
  );
}

function ColumnHeader({
  column,
  ids,
  indexLabel,
  canRemove,
}: {
  column: ComparisonColumn;
  ids: readonly string[];
  indexLabel: string;
  canRemove: boolean;
}) {
  const isFound = column.kind === 'run';
  return (
    <div
      data-testid={`nway-column-${column.id}`}
      className="sticky top-0 z-20 border-b border-border bg-bg-subtle px-3 py-2"
    >
      <div className="flex items-center justify-between gap-1">
        <div className="flex flex-col">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-fg-faint">
            Run {indexLabel}
          </span>
          {isFound ? (
            <Link
              href={`/runs/${encodeURIComponent(column.id)}`}
              className="font-mono text-[11px] text-sky-700 hover:underline dark:text-sky-400"
            >
              {column.id.slice(0, 16)}
            </Link>
          ) : (
            <span className="font-mono text-[11px] text-red-700 dark:text-red-300">
              {column.id.slice(0, 16)}
            </span>
          )}
          {isFound ? (
            <span className="mt-0.5 text-[10px] text-fg-muted">
              {column.run.agentName} · {formatRelativeTime(column.run.startedAt)}
            </span>
          ) : (
            <NeutralBadge>{column.kind === 'not-found' ? column.reason : 'unknown'}</NeutralBadge>
          )}
        </div>
        {canRemove ? <NWayRemoveButton ids={ids} removeId={column.id} /> : null}
      </div>
    </div>
  );
}

function RowGroup({
  row,
  columns,
  isLast,
}: {
  row: ComparisonRow;
  columns: readonly ComparisonColumn[];
  isLast: boolean;
}) {
  const borderClass = isLast ? '' : 'border-b border-border';
  return (
    <>
      <div
        className={`sticky left-0 z-10 ${borderClass} bg-bg-subtle px-3 py-2 text-xs font-medium text-fg-muted`}
        data-testid={`nway-row-label-${row.key}`}
      >
        <span className="flex items-center gap-1">
          {row.label}
          {row.hasDiff ? (
            <span
              className="inline-block h-1.5 w-1.5 rounded-full bg-amber-400"
              title="Values differ across runs"
            />
          ) : null}
        </span>
      </div>
      {row.cells.map((cell, i) => {
        const col = columns[i];
        const tone =
          cell.tag === 'divergent'
            ? 'border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-950/30'
            : cell.tag === 'baseline'
              ? 'border-emerald-300 bg-emerald-50/40 dark:border-emerald-800 dark:bg-emerald-950/20'
              : 'border-transparent';
        const isFinalOutput = row.key === 'finalOutput';
        return (
          <div
            key={`${row.key}-${i}`}
            data-testid={`nway-cell-${row.key}-${col?.id ?? i}`}
            data-tag={cell.tag}
            className={`${borderClass} border-l ${tone} px-3 py-2 align-top text-xs`}
          >
            {row.key === 'status' && col?.kind === 'run' ? (
              <StatusBadge status={col.run.status as RunStatus} />
            ) : isFinalOutput ? (
              <CollapsibleText text={cell.value} />
            ) : row.key === 'durationMs' && col?.kind === 'run' ? (
              <span className="font-mono tabular-nums text-fg" title={cell.value}>
                {formatDuration(typeof col.run.durationMs === 'number' ? col.run.durationMs : null)}
              </span>
            ) : row.kind === 'quantitative' ? (
              <span className="font-mono tabular-nums text-fg">{cell.value}</span>
            ) : (
              <span className="break-words text-fg">{cell.value || '—'}</span>
            )}
          </div>
        );
      })}
    </>
  );
}

const SHOW_MORE_THRESHOLD = 240;

function CollapsibleText({ text }: { text: string }) {
  if (text.length <= SHOW_MORE_THRESHOLD) {
    return (
      <pre className="whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-fg">
        {text || '—'}
      </pre>
    );
  }
  // SSR-safe: <details>/<summary> are native and stay closed by default.
  return (
    <details className="group">
      <summary className="cursor-pointer list-none">
        <pre className="line-clamp-3 whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-fg group-open:hidden">
          {text}
        </pre>
        <span className="text-[10px] font-medium text-sky-700 hover:underline dark:text-sky-400 group-open:hidden">
          Show more ({text.length.toLocaleString('en-US')} chars)
        </span>
        <span className="hidden text-[10px] font-medium text-sky-700 hover:underline dark:text-sky-400 group-open:inline">
          Collapse
        </span>
      </summary>
      <pre className="mt-1 max-h-96 overflow-y-auto whitespace-pre-wrap break-words rounded bg-bg-subtle p-2 font-mono text-[11px] leading-relaxed text-fg">
        {text}
      </pre>
    </details>
  );
}

function allMatchToolCallCounts(columns: readonly ComparisonColumn[]): boolean {
  let seen: number | null = null;
  for (const c of columns) {
    if (c.kind !== 'run') continue;
    const n = c.run.events.filter((e) => e.type === 'tool_call').length;
    if (seen === null) seen = n;
    else if (n !== seen) return false;
  }
  return true;
}
