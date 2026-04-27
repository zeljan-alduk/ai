'use client';

/**
 * Wave-13 /runs list — checkbox-aware row list with a bottom-anchored
 * selection toolbar.
 *
 * The list itself stays a presentation-only component; selection
 * state is owned by `useReducer(selectionReducer)` so the transitions
 * are exhaustively pinned by `bulk-selection.test.ts`.
 *
 * LLM-agnostic: the row never branches on a specific provider name.
 */

import { NeutralBadge, StatusBadge } from '@/components/badge';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { formatDuration, formatRelativeTime, formatUsd } from '@/lib/format';
import type { RunSummary } from '@aldo-ai/api-contract';
import Link from 'next/link';
import { useMemo, useReducer } from 'react';
import { EMPTY_SELECTION, modeForVisible, selectionReducer } from './bulk-selection';
import { SelectionToolbar } from './selection-toolbar';

export interface RunsListProps {
  readonly runs: ReadonlyArray<RunSummary>;
}

export function RunsList({ runs }: RunsListProps) {
  const [state, dispatch] = useReducer(selectionReducer, EMPTY_SELECTION);

  const visibleIds = useMemo(() => runs.map((r) => r.id), [runs]);
  const mode = modeForVisible(state, visibleIds);

  return (
    <>
      <Card className="overflow-hidden" data-tour="runs-list">
        <div className="flex items-center gap-3 border-b border-border bg-bg-subtle px-4 py-2">
          <Checkbox
            aria-label="Select all visible runs"
            checked={mode === 'all'}
            indeterminate={mode === 'some'}
            onChange={(e) =>
              dispatch(
                e.target.checked
                  ? { type: 'select-all', ids: visibleIds }
                  : { type: 'deselect-all', ids: visibleIds },
              )
            }
          />
          <span className="text-xs font-medium text-fg-muted">
            {state.selected.size > 0 ? `${state.selected.size} selected` : `${runs.length} runs`}
          </span>
        </div>
        <div className="flex flex-col">
          {runs.map((r) => (
            <RunRow
              key={r.id}
              run={r}
              checked={state.selected.has(r.id)}
              onToggle={() => dispatch({ type: 'toggle', id: r.id })}
            />
          ))}
        </div>
      </Card>
      <SelectionToolbar
        selectedIds={[...state.selected]}
        visibleRuns={runs}
        onClear={() => dispatch({ type: 'clear' })}
      />
    </>
  );
}

function RunRow({
  run,
  checked,
  onToggle,
}: {
  run: RunSummary;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <div
      className={`flex items-center gap-4 border-b border-border px-4 py-3 last:border-b-0 ${
        checked ? 'bg-accent/5' : ''
      }`}
    >
      <Checkbox
        aria-label={`Select ${run.id}`}
        checked={checked}
        onChange={onToggle}
        // Stop link clicks from firing when toggling the checkbox.
        onClick={(e) => e.stopPropagation()}
      />
      <Link
        href={`/runs/${encodeURIComponent(run.id)}`}
        className="flex flex-1 flex-wrap items-center gap-4"
      >
        <div className="w-24 shrink-0">
          <StatusBadge status={run.status} />
        </div>
        <div className="min-w-[180px] flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-fg">{run.agentName}</span>
            <span className="text-[11px] text-fg-muted">{run.agentVersion}</span>
            {run.hasChildren ? (
              <span title="This run delegated work to one or more subagents">
                <NeutralBadge>+ subagents</NeutralBadge>
              </span>
            ) : null}
            {run.archivedAt ? <NeutralBadge>archived</NeutralBadge> : null}
            {(run.tags ?? []).map((t) => (
              <span
                key={t}
                className="rounded bg-bg-subtle px-1.5 py-0.5 text-[10px] text-fg-muted"
              >
                #{t}
              </span>
            ))}
          </div>
          <div className="mt-0.5 flex items-center gap-2 text-[11px] text-fg-muted">
            <span title={run.startedAt}>{formatRelativeTime(run.startedAt)}</span>
            <span aria-hidden="true">·</span>
            <span title="Duration">{formatDuration(run.durationMs)}</span>
            {run.lastModel !== null ? (
              <>
                <span aria-hidden="true">·</span>
                <span className="font-mono text-[10px] text-fg-faint">{run.lastModel}</span>
              </>
            ) : null}
          </div>
        </div>
        <div className="w-20 shrink-0 text-right font-mono text-sm tabular-nums text-fg">
          {formatUsd(isLocalOnly(run.lastProvider) ? 0 : run.totalUsd)}
        </div>
        <div className="hidden w-28 shrink-0 text-right font-mono text-[11px] text-fg-faint md:block">
          {run.id.slice(0, 12)}
        </div>
      </Link>
    </div>
  );
}

function isLocalOnly(provider: string | null | undefined): boolean {
  return provider == null;
}
