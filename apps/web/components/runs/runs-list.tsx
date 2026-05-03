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
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { addRunTag, removeRunTag } from '@/lib/api';
import { formatDuration, formatRelativeTime, formatUsd } from '@/lib/format';
import type { RunSummary } from '@aldo-ai/api-contract';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useReducer, useState, useTransition } from 'react';
import { EMPTY_SELECTION, modeForVisible, selectionReducer } from './bulk-selection';
import { SelectionToolbar } from './selection-toolbar';

export interface RunsListProps {
  readonly runs: ReadonlyArray<RunSummary>;
  /** Wave-4 — popular tags drive the inline tag editor's autocomplete. */
  readonly popularTags?: ReadonlyArray<string>;
}

export function RunsList({ runs, popularTags = [] }: RunsListProps) {
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
              popularTags={popularTags}
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
  popularTags,
}: {
  run: RunSummary;
  checked: boolean;
  onToggle: () => void;
  popularTags: ReadonlyArray<string>;
}) {
  // Local optimistic mirror of the server's tag list. Hover the
  // tags column → "+" reveals the inline editor popover.
  const [tags, setTags] = useState<readonly string[]>(run.tags ?? []);
  // Wave-4 — cap inline display at 3 chips; "+N" reveals the rest in
  // the editor so a heavily-tagged row doesn't wrap and dominate the
  // row height.
  const visible = tags.slice(0, 3);
  const overflow = Math.max(0, tags.length - visible.length);

  return (
    <div
      className={`group flex items-center gap-4 border-b border-border px-4 py-3 last:border-b-0 ${
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
      <div className="flex flex-1 flex-wrap items-center gap-4">
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
              {visible.map((t) => (
                <span
                  key={t}
                  className="rounded border border-border bg-bg-subtle px-1.5 py-0.5 text-[10px] text-fg-muted"
                >
                  #{t}
                </span>
              ))}
              {overflow > 0 ? (
                <span className="rounded bg-bg-subtle px-1.5 py-0.5 text-[10px] text-fg-faint">
                  +{overflow}
                </span>
              ) : null}
              {/* Wave-19 — aggregate annotation counts. Optional/additive
                  on the wire; the row falls back to no pill when the
                  field is undefined. */}
              <AnnotationCountsPill counts={run.annotationCounts} />
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
        </Link>
        <InlineTagEditor runId={run.id} tags={tags} onChange={setTags} suggestions={popularTags} />
        <div className="w-20 shrink-0 text-right font-mono text-sm tabular-nums text-fg">
          {formatUsd(isLocalOnly(run.lastProvider) ? 0 : run.totalUsd)}
        </div>
        <div className="hidden w-28 shrink-0 text-right font-mono text-[11px] text-fg-faint md:block">
          {run.id.slice(0, 12)}
        </div>
      </div>
    </div>
  );
}

/**
 * Wave-4 — inline tag editor on the runs list. Hover the row → "+"
 * reveals the popover. Adding a tag commits via
 * `POST /v1/runs/:id/tags/add`; removing via
 * `DELETE /v1/runs/:id/tags/:tag`. Both endpoints normalize at the
 * server (lowercase / trim / [a-z0-9-] / max 32 chars); the input is
 * locally normalized before commit so the optimistic UI state matches
 * what the server will store. A network failure rolls back local
 * state and surfaces the error inline.
 */
function InlineTagEditor({
  runId,
  tags,
  onChange,
  suggestions,
}: {
  runId: string;
  tags: readonly string[];
  onChange: (next: readonly string[]) => void;
  suggestions: ReadonlyArray<string>;
}) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const router = useRouter();
  const [, startTransition] = useTransition();

  const filtered = useMemo(() => {
    const needle = input.trim().toLowerCase();
    const set = new Set(tags);
    return suggestions
      .filter((s) => !set.has(s))
      .filter((s) => (needle.length === 0 ? true : s.includes(needle)))
      .slice(0, 6);
  }, [input, suggestions, tags]);

  const commitAdd = async (raw: string) => {
    const t = raw.trim().toLowerCase();
    if (t.length === 0) return;
    setError(null);
    setPending(true);
    const previous = tags;
    onChange([...tags, t]);
    setInput('');
    try {
      const res = await addRunTag(runId, t);
      onChange(res.tags);
      // Refresh the popular-tags fetch upstream.
      startTransition(() => router.refresh());
    } catch (e) {
      onChange(previous);
      setError((e as Error).message);
    } finally {
      setPending(false);
    }
  };

  const commitRemove = async (t: string) => {
    setError(null);
    setPending(true);
    const previous = tags;
    onChange(tags.filter((x) => x !== t));
    try {
      const res = await removeRunTag(runId, t);
      onChange(res.tags);
      startTransition(() => router.refresh());
    } catch (e) {
      onChange(previous);
      setError((e as Error).message);
    } finally {
      setPending(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`Edit tags for run ${runId}`}
          className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded border border-border bg-bg-elevated text-[11px] text-fg-muted opacity-0 transition-opacity hover:bg-bg-subtle hover:text-fg group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100"
          onClick={(e) => e.stopPropagation()}
        >
          +
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-64" align="end" onClick={(e) => e.stopPropagation()}>
        <div className="flex flex-col gap-2">
          <p className="text-[11px] font-medium text-fg-muted">Tags</p>
          {tags.length > 0 ? (
            <div className="flex flex-wrap gap-1">
              {tags.map((t) => (
                <span
                  key={t}
                  className="inline-flex items-center gap-1 rounded-full border border-border bg-bg-subtle px-2 py-0.5 text-[11px] text-fg"
                >
                  #{t}
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => void commitRemove(t)}
                    className="text-fg-faint hover:text-danger disabled:opacity-50"
                    aria-label={`Remove tag ${t}`}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          ) : (
            <p className="text-[11px] text-fg-faint">No tags yet.</p>
          )}
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void commitAdd(input);
              }
            }}
            placeholder="Add tag…"
            className="h-7 text-xs"
            disabled={pending}
            aria-label="Add tag"
          />
          {filtered.length > 0 ? (
            <div className="flex flex-wrap gap-1">
              {filtered.map((s) => (
                <button
                  key={s}
                  type="button"
                  disabled={pending}
                  onClick={() => void commitAdd(s)}
                  className="rounded border border-border bg-bg-elevated px-1.5 py-0.5 text-[10px] text-fg-muted hover:border-fg-muted hover:text-fg disabled:opacity-50"
                >
                  + {s}
                </button>
              ))}
            </div>
          ) : null}
          {error ? <p className="text-[11px] text-danger">{error}</p> : null}
          <p className="text-[10px] text-fg-faint">
            lowercase · letters · digits · dashes · max 32
          </p>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function isLocalOnly(provider: string | null | undefined): boolean {
  return provider == null;
}

/**
 * Wave-19 — aggregate annotation counts pill on the runs list.
 *
 * Renders a thin tri-segment pill: 👍 N · 👎 M · 💬 N. Empty segments
 * are dropped so a row with only thumbs-up and no comments shows just
 * the up count. The whole pill is suppressed when the field is missing
 * or every count is zero (the server already drops zero-count rows
 * from the wire — this is a defensive client-side check).
 */
function AnnotationCountsPill({
  counts,
}: {
  counts: { thumbsUp: number; thumbsDown: number; comments: number } | undefined;
}) {
  if (counts === undefined) return null;
  const total = counts.thumbsUp + counts.thumbsDown + counts.comments;
  if (total === 0) return null;
  const segments: Array<{ key: string; label: string; value: number; tone: string }> = [];
  if (counts.thumbsUp > 0) {
    segments.push({
      key: 'tu',
      label: '👍',
      value: counts.thumbsUp,
      tone: 'text-emerald-700 dark:text-emerald-400',
    });
  }
  if (counts.thumbsDown > 0) {
    segments.push({
      key: 'td',
      label: '👎',
      value: counts.thumbsDown,
      tone: 'text-rose-700 dark:text-rose-400',
    });
  }
  if (counts.comments > 0) {
    segments.push({
      key: 'cc',
      label: '💬',
      value: counts.comments,
      tone: 'text-fg-muted',
    });
  }
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border border-border bg-bg px-2 py-0.5 text-[10px] tabular-nums"
      title={`${counts.thumbsUp} thumbs up · ${counts.thumbsDown} thumbs down · ${counts.comments} comment${counts.comments === 1 ? '' : 's'}`}
    >
      {segments.map((seg, idx) => (
        <span key={seg.key} className="inline-flex items-center gap-0.5">
          {idx > 0 ? (
            <span aria-hidden="true" className="text-fg-faint">
              ·
            </span>
          ) : null}
          <span aria-hidden="true">{seg.label}</span>
          <span className={seg.tone}>{seg.value}</span>
        </span>
      ))}
    </span>
  );
}
