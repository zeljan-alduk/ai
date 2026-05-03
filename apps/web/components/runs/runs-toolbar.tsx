'use client';

/**
 * Wave-13 /runs toolbar — search + filter sheet + saved-views.
 *
 * Top-of-page client island:
 *   * Search box (debounced 250ms) writes to the URL `q` param.
 *   * Filter button opens a Sheet containing every facet (status[],
 *     agent[], cost / duration ranges, started-after/before,
 *     has_children / has_failed_event / include_archived).
 *   * Saved-views dropdown lists pinned views; "Save current" pushes
 *     the active query to the API; "Edit views..." opens a CRUD Sheet.
 *
 * URL is the source of truth for filter state. Navigating preserves
 * filters; "saved view = id in URL" round-trips deterministically.
 *
 * LLM-agnostic: every filter token is opaque to the UI; provider
 * names never appear here.
 */

import { Button, Input } from '@/components/ui';
import { Checkbox } from '@/components/ui/checkbox';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { bulkRunAction, createSavedView, deleteSavedView, updateSavedView } from '@/lib/api';
import type { SavedView } from '@aldo-ai/api-contract';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState, useTransition } from 'react';
import {
  type RunSearchQuery,
  isEmptyQuery,
  parseRunSearchQuery,
  serializeRunSearchQuery,
  toSavedViewQuery,
} from './search-query';

const STATUSES: ReadonlyArray<{ readonly value: string; readonly label: string }> = [
  { value: 'queued', label: 'Queued' },
  { value: 'running', label: 'Running' },
  { value: 'completed', label: 'Completed' },
  { value: 'failed', label: 'Failed' },
  { value: 'cancelled', label: 'Cancelled' },
];

export interface RunsToolbarProps {
  readonly agentNames: ReadonlyArray<string>;
  /** Wave-4 — model ids the gateway knows about; drives the model dropdown. */
  readonly modelIds?: ReadonlyArray<string>;
  /** Wave-4 — top-N popular tags for autocomplete in the tag chip picker. */
  readonly popularTags?: ReadonlyArray<string>;
  readonly views: ReadonlyArray<SavedView>;
  readonly query: RunSearchQuery;
  readonly total: number;
}

export function RunsToolbar({
  agentNames,
  modelIds = [],
  popularTags = [],
  views,
  query,
  total,
}: RunsToolbarProps) {
  const router = useRouter();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [searchText, setSearchText] = useState(query.q ?? '');

  // 250ms debounce for the search box → URL. We intentionally only
  // re-run when the user-typed `searchText` changes — re-running on
  // every `params`/`router` reference change would fight the
  // `router.replace` we just emitted and cause a jitter loop.
  // biome-ignore lint/correctness/useExhaustiveDependencies: debounce-on-edit only
  useEffect(() => {
    const handle = setTimeout(() => {
      const current = params.get('q') ?? '';
      if (searchText === current) return;
      const next = new URLSearchParams(params.toString());
      if (searchText.length > 0) next.set('q', searchText);
      else next.delete('q');
      next.delete('cursor');
      // Editing the query box invalidates any active saved view.
      next.delete('view');
      startTransition(() => {
        router.replace(`/runs${next.toString() ? `?${next}` : ''}`);
      });
    }, 250);
    return () => clearTimeout(handle);
  }, [searchText]);

  const activeView = useMemo(() => views.find((v) => v.id === query.view), [views, query.view]);

  const applyView = useCallback(
    (view: SavedView | null) => {
      if (view === null) {
        startTransition(() => router.replace('/runs'));
        return;
      }
      const next = serializeRunSearchQuery({
        ...(view.query as RunSearchQuery),
        view: view.id,
      });
      startTransition(() => {
        router.replace(`/runs${next.toString() ? `?${next}` : ''}`);
      });
    },
    [router],
  );

  return (
    <div className="sticky top-0 z-20 mb-4 -mx-1 bg-bg/95 backdrop-blur supports-[backdrop-filter]:bg-bg/70">
      <div className="flex flex-wrap items-center gap-2 px-1 pt-1 pb-2">
        <Input
          type="search"
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          placeholder="Search runs by id, agent, error, or tool args…"
          aria-label="Search runs"
          className="max-w-md flex-1"
        />
        <StatusPills query={query} />
        <TimeRangeMenu query={query} />
        <FilterSheet
          agentNames={agentNames}
          modelIds={modelIds}
          popularTags={popularTags}
          query={query}
        />
        <SavedViewsMenu
          views={views}
          activeView={activeView ?? null}
          onApply={applyView}
          currentQuery={query}
        />
        <p className="ml-auto text-xs text-fg-muted">
          {total.toLocaleString()} run{total === 1 ? '' : 's'}
          {pending ? ' · updating…' : ''}
        </p>
      </div>
      <ActiveFilterChips query={query} />
    </div>
  );
}

function FilterSheet({
  agentNames,
  modelIds,
  popularTags,
  query,
}: {
  agentNames: ReadonlyArray<string>;
  modelIds: ReadonlyArray<string>;
  popularTags: ReadonlyArray<string>;
  query: RunSearchQuery;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [draft, setDraft] = useState<RunSearchQuery>(query);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (open) setDraft(query);
  }, [open, query]);

  const apply = () => {
    const next = serializeRunSearchQuery({ ...draft, q: query.q });
    next.delete('cursor');
    next.delete('view'); // editing filters invalidates the active view
    startTransition(() => {
      router.replace(`/runs${next.toString() ? `?${next}` : ''}`);
    });
    setOpen(false);
  };
  const reset = () => {
    setDraft({});
    startTransition(() => router.replace('/runs'));
    setOpen(false);
  };

  const activeCount = filterCount(query);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="secondary" size="sm" type="button">
          Filters{activeCount > 0 ? ` (${activeCount})` : ''}
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="w-[420px]">
        <SheetHeader>
          <SheetTitle>Filter runs</SheetTitle>
          <SheetDescription>
            All facets compose with AND. Multi-value pickers compose ANY-of within.
          </SheetDescription>
        </SheetHeader>
        <div className="mt-4 flex flex-col gap-5">
          <FacetGroup label="Status">
            <div className="flex flex-wrap gap-2">
              {STATUSES.map((s) => {
                const checked = (draft.status ?? []).includes(s.value);
                return (
                  <label
                    key={s.value}
                    htmlFor={`runs-status-${s.value}`}
                    className="inline-flex items-center gap-1.5 text-xs"
                  >
                    <Checkbox
                      id={`runs-status-${s.value}`}
                      checked={checked}
                      onChange={(e) =>
                        setDraft((d) => ({
                          ...d,
                          status: toggle(d.status ?? [], s.value, e.target.checked),
                        }))
                      }
                    />
                    {s.label}
                  </label>
                );
              })}
            </div>
          </FacetGroup>
          <FacetGroup label="Agent">
            <select
              multiple
              value={draft.agent ?? []}
              onChange={(e) =>
                setDraft((d) => ({
                  ...d,
                  agent: Array.from(e.target.selectedOptions, (o) => o.value),
                }))
              }
              className="h-32 w-full rounded border border-border bg-bg-elevated px-2 py-1 text-xs"
            >
              {agentNames.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </FacetGroup>
          {modelIds.length > 0 ? (
            <FacetGroup label="Model">
              <select
                multiple
                value={draft.model ?? []}
                onChange={(e) =>
                  setDraft((d) => ({
                    ...d,
                    model: Array.from(e.target.selectedOptions, (o) => o.value),
                  }))
                }
                className="h-32 w-full rounded border border-border bg-bg-elevated px-2 py-1 text-xs"
                aria-label="Filter by model"
              >
                {modelIds.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </FacetGroup>
          ) : null}
          <FacetGroup label="Tags">
            <TagChipPicker
              selected={draft.tag ?? []}
              suggestions={popularTags}
              onChange={(tags) =>
                setDraft((d) => ({ ...d, tag: tags.length > 0 ? tags : undefined }))
              }
            />
          </FacetGroup>
          <FacetGroup label="Cost (USD)">
            <div className="flex items-center gap-2 text-xs">
              <RangeInput
                value={draft.cost_gte}
                onChange={(v) => setDraft((d) => ({ ...d, cost_gte: v }))}
                placeholder="min"
              />
              <span className="text-fg-muted">–</span>
              <RangeInput
                value={draft.cost_lte}
                onChange={(v) => setDraft((d) => ({ ...d, cost_lte: v }))}
                placeholder="max"
              />
            </div>
          </FacetGroup>
          <FacetGroup label="Duration (ms)">
            <div className="flex items-center gap-2 text-xs">
              <RangeInput
                value={draft.duration_gte}
                onChange={(v) => setDraft((d) => ({ ...d, duration_gte: v }))}
                placeholder="min"
              />
              <span className="text-fg-muted">–</span>
              <RangeInput
                value={draft.duration_lte}
                onChange={(v) => setDraft((d) => ({ ...d, duration_lte: v }))}
                placeholder="max"
              />
            </div>
          </FacetGroup>
          <FacetGroup label="Started">
            <div className="flex items-center gap-2 text-xs">
              <Input
                type="datetime-local"
                value={draft.started_after?.slice(0, 16) ?? ''}
                onChange={(e) =>
                  setDraft((d) => ({
                    ...d,
                    started_after:
                      e.target.value.length > 0
                        ? new Date(e.target.value).toISOString()
                        : undefined,
                  }))
                }
                className="h-8 text-xs"
              />
              <span className="text-fg-muted">–</span>
              <Input
                type="datetime-local"
                value={draft.started_before?.slice(0, 16) ?? ''}
                onChange={(e) =>
                  setDraft((d) => ({
                    ...d,
                    started_before:
                      e.target.value.length > 0
                        ? new Date(e.target.value).toISOString()
                        : undefined,
                  }))
                }
                className="h-8 text-xs"
              />
            </div>
          </FacetGroup>
          <FacetGroup label="Other">
            <label htmlFor="runs-has-children" className="flex items-center gap-2 text-xs">
              <Checkbox
                id="runs-has-children"
                checked={draft.has_children === true}
                onChange={(e) =>
                  setDraft((d) => ({
                    ...d,
                    has_children: e.target.checked ? true : undefined,
                  }))
                }
              />
              Composite (has subagents)
            </label>
            <label htmlFor="runs-has-failed" className="mt-1 flex items-center gap-2 text-xs">
              <Checkbox
                id="runs-has-failed"
                checked={draft.has_failed_event === true}
                onChange={(e) =>
                  setDraft((d) => ({
                    ...d,
                    has_failed_event: e.target.checked ? true : undefined,
                  }))
                }
              />
              Has at least one error event
            </label>
            <label htmlFor="runs-include-archived" className="mt-1 flex items-center gap-2 text-xs">
              <Checkbox
                id="runs-include-archived"
                checked={draft.include_archived === true}
                onChange={(e) =>
                  setDraft((d) => ({
                    ...d,
                    include_archived: e.target.checked ? true : undefined,
                  }))
                }
              />
              Include archived
            </label>
          </FacetGroup>
        </div>
        <SheetFooter className="mt-6">
          <Button variant="ghost" type="button" onClick={reset}>
            Clear
          </Button>
          <SheetClose asChild>
            <Button variant="secondary" type="button">
              Cancel
            </Button>
          </SheetClose>
          <Button type="button" onClick={apply}>
            Apply
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

function SavedViewsMenu({
  views,
  activeView,
  onApply,
  currentQuery,
}: {
  views: ReadonlyArray<SavedView>;
  activeView: SavedView | null;
  onApply: (v: SavedView | null) => void;
  currentQuery: RunSearchQuery;
}) {
  const [editing, setEditing] = useState(false);
  const [savingDialogOpen, setSavingDialogOpen] = useState(false);
  const router = useRouter();
  const [, startTransition] = useTransition();

  const refresh = () => startTransition(() => router.refresh());

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="secondary" size="sm" type="button">
            {activeView ? `View: ${activeView.name}` : 'Saved views'}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-72">
          <DropdownMenuLabel>Saved views</DropdownMenuLabel>
          {views.length === 0 ? (
            <DropdownMenuItem disabled>No saved views yet</DropdownMenuItem>
          ) : (
            views.map((v) => (
              <DropdownMenuItem key={v.id} onSelect={() => onApply(v)}>
                <span className="truncate">{v.name}</span>
                {v.isShared ? (
                  <span className="ml-auto text-[10px] text-fg-faint">shared</span>
                ) : null}
              </DropdownMenuItem>
            ))
          )}
          <DropdownMenuSeparator />
          {!isEmptyQuery(currentQuery) ? (
            <DropdownMenuItem onSelect={() => setSavingDialogOpen(true)}>
              Save current as view…
            </DropdownMenuItem>
          ) : null}
          {activeView !== null ? (
            <DropdownMenuItem onSelect={() => onApply(null)}>Clear active view</DropdownMenuItem>
          ) : null}
          <DropdownMenuItem onSelect={() => setEditing(true)}>Edit views…</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <SaveViewDialog
        open={savingDialogOpen}
        onOpenChange={setSavingDialogOpen}
        currentQuery={currentQuery}
        onSaved={refresh}
      />
      <EditViewsSheet open={editing} onOpenChange={setEditing} views={views} onChange={refresh} />
    </>
  );
}

function SaveViewDialog({
  open,
  onOpenChange,
  currentQuery,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  currentQuery: RunSearchQuery;
  onSaved: () => void;
}) {
  const [name, setName] = useState('');
  const [shared, setShared] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (name.trim().length === 0) return;
    setSubmitting(true);
    setError(null);
    try {
      await createSavedView({
        name: name.trim(),
        surface: 'runs',
        query: toSavedViewQuery(currentQuery) as Record<string, unknown>,
        isShared: shared,
      });
      setName('');
      setShared(false);
      onOpenChange(false);
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-[380px]">
        <SheetHeader>
          <SheetTitle>Save view</SheetTitle>
          <SheetDescription>
            Pin this filter set as a one-click shortcut. Shared views are visible to other members
            of your tenant.
          </SheetDescription>
        </SheetHeader>
        <div className="mt-4 flex flex-col gap-3">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="View name"
            aria-label="View name"
          />
          <label htmlFor="save-view-shared" className="flex items-center gap-2 text-xs">
            <Checkbox
              id="save-view-shared"
              checked={shared}
              onChange={(e) => setShared(e.target.checked)}
            />
            Share with my tenant
          </label>
          {error ? <p className="text-xs text-danger">{error}</p> : null}
        </div>
        <SheetFooter className="mt-6">
          <SheetClose asChild>
            <Button variant="secondary" type="button">
              Cancel
            </Button>
          </SheetClose>
          <Button type="button" disabled={submitting || name.trim().length === 0} onClick={submit}>
            {submitting ? 'Saving…' : 'Save'}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

function EditViewsSheet({
  open,
  onOpenChange,
  views,
  onChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  views: ReadonlyArray<SavedView>;
  onChange: () => void;
}) {
  const onRename = async (id: string, name: string) => {
    if (name.trim().length === 0) return;
    await updateSavedView(id, { name: name.trim() });
    onChange();
  };
  const onShare = async (id: string, isShared: boolean) => {
    await updateSavedView(id, { isShared });
    onChange();
  };
  const onDelete = async (id: string) => {
    await deleteSavedView(id);
    onChange();
  };
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-[480px]">
        <SheetHeader>
          <SheetTitle>Edit views</SheetTitle>
          <SheetDescription>Rename, share, or delete your saved views.</SheetDescription>
        </SheetHeader>
        <div className="mt-4 flex flex-col gap-2">
          {views.length === 0 ? (
            <p className="text-sm text-fg-muted">No saved views yet.</p>
          ) : (
            views.map((v) => (
              <ViewEditRow
                key={v.id}
                view={v}
                onRename={(n) => onRename(v.id, n)}
                onShare={(s) => onShare(v.id, s)}
                onDelete={() => onDelete(v.id)}
              />
            ))
          )}
        </div>
        <SheetFooter className="mt-6">
          <SheetClose asChild>
            <Button variant="secondary" type="button">
              Done
            </Button>
          </SheetClose>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

function ViewEditRow({
  view,
  onRename,
  onShare,
  onDelete,
}: {
  view: SavedView;
  onRename: (name: string) => Promise<void>;
  onShare: (shared: boolean) => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const [name, setName] = useState(view.name);
  const isMine = view.ownedByMe ?? true;
  return (
    <div className="flex items-center gap-2 rounded border border-border bg-bg-elevated p-2">
      <Input
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => name !== view.name && void onRename(name)}
        disabled={!isMine}
        className="h-8 text-xs"
      />
      <label
        htmlFor={`view-shared-${view.id}`}
        className="flex shrink-0 items-center gap-1 text-[11px]"
      >
        <Checkbox
          id={`view-shared-${view.id}`}
          checked={view.isShared}
          onChange={(e) => void onShare(e.target.checked)}
          disabled={!isMine}
        />
        Shared
      </label>
      <Button
        variant="destructive"
        size="sm"
        type="button"
        disabled={!isMine}
        onClick={() => void onDelete()}
      >
        Delete
      </Button>
    </div>
  );
}

function FacetGroup({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs font-medium text-fg-muted">{label}</span>
      {children}
    </div>
  );
}

function RangeInput({
  value,
  onChange,
  placeholder,
}: {
  value: number | undefined;
  onChange: (v: number | undefined) => void;
  placeholder: string;
}) {
  return (
    <Input
      type="number"
      value={value === undefined ? '' : String(value)}
      onChange={(e) => {
        const raw = e.target.value;
        if (raw.length === 0) onChange(undefined);
        else {
          const n = Number(raw);
          if (Number.isFinite(n)) onChange(n);
        }
      }}
      placeholder={placeholder}
      className="h-8 w-24 text-xs"
    />
  );
}

function toggle(arr: ReadonlyArray<string>, v: string, checked: boolean): string[] {
  const set = new Set(arr);
  if (checked) set.add(v);
  else set.delete(v);
  return [...set];
}

function filterCount(q: RunSearchQuery): number {
  let n = 0;
  if (q.status?.length) n++;
  if (q.agent?.length) n++;
  if (q.model?.length) n++;
  if (q.tag?.length) n++;
  if (q.cost_gte !== undefined || q.cost_lte !== undefined) n++;
  if (q.duration_gte !== undefined || q.duration_lte !== undefined) n++;
  if (q.started_after || q.started_before) n++;
  if (q.has_children !== undefined) n++;
  if (q.has_failed_event !== undefined) n++;
  if (q.include_archived !== undefined) n++;
  return n;
}

// ---------------------------------------------------------------------------
// Wave-4 — quick-access toolbar pieces (status pills, time-range presets,
// tag chip picker, active-filter chips with "Clear all").
//
// All four are deep-link-safe: every interaction round-trips through the
// URL via `router.replace`, so reload + share + back-button behave the
// same way the Filter Sheet's apply path does.
// ---------------------------------------------------------------------------

const STATUS_PILLS: ReadonlyArray<{
  readonly value: string;
  readonly label: string;
  readonly tone: 'success' | 'danger' | 'info' | 'neutral';
}> = [
  { value: 'completed', label: 'Completed', tone: 'success' },
  { value: 'failed', label: 'Failed', tone: 'danger' },
  { value: 'running', label: 'Running', tone: 'info' },
];

function StatusPills({ query }: { query: RunSearchQuery }) {
  const router = useRouter();
  const params = useSearchParams();
  const [, startTransition] = useTransition();
  const active = new Set(query.status ?? []);
  const toggleStatus = (value: string) => {
    const next = new URLSearchParams(params.toString());
    const set = new Set(active);
    if (set.has(value)) set.delete(value);
    else set.add(value);
    if (set.size > 0) next.set('status', [...set].join(','));
    else next.delete('status');
    next.delete('cursor');
    next.delete('view');
    startTransition(() => {
      router.replace(`/runs${next.toString() ? `?${next}` : ''}`);
    });
  };
  return (
    <fieldset className="m-0 flex items-center gap-1 border-0 p-0">
      <legend className="sr-only">Quick status filter</legend>
      {STATUS_PILLS.map((s) => {
        const on = active.has(s.value);
        const tone =
          s.tone === 'success'
            ? on
              ? 'bg-success/15 text-success border-success/30'
              : 'border-border text-fg-muted hover:border-success/40 hover:text-success'
            : s.tone === 'danger'
              ? on
                ? 'bg-danger/15 text-danger border-danger/30'
                : 'border-border text-fg-muted hover:border-danger/40 hover:text-danger'
              : on
                ? 'bg-accent/15 text-accent border-accent/30'
                : 'border-border text-fg-muted hover:border-accent/40 hover:text-accent';
        return (
          <button
            key={s.value}
            type="button"
            onClick={() => toggleStatus(s.value)}
            aria-pressed={on}
            className={`rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition-colors ${tone}`}
          >
            {s.label}
          </button>
        );
      })}
    </fieldset>
  );
}

const TIME_PRESETS: ReadonlyArray<{
  readonly id: string;
  readonly label: string;
  readonly hours: number;
}> = [
  { id: '1h', label: 'Last hour', hours: 1 },
  { id: '24h', label: 'Last 24 h', hours: 24 },
  { id: '7d', label: 'Last 7 d', hours: 24 * 7 },
  { id: '30d', label: 'Last 30 d', hours: 24 * 30 },
];

function detectActivePreset(q: RunSearchQuery): string | null {
  if (!q.started_after || q.started_before) return null;
  const after = new Date(q.started_after);
  if (Number.isNaN(after.getTime())) return null;
  const ageHours = (Date.now() - after.getTime()) / 3_600_000;
  // Tolerate ±5 min skew for "Last 1 h" (so a slightly-stale URL still
  // highlights the pill the user set).
  for (const p of TIME_PRESETS) {
    if (Math.abs(ageHours - p.hours) < 0.1 + p.hours * 0.01) return p.id;
  }
  return null;
}

function TimeRangeMenu({ query }: { query: RunSearchQuery }) {
  const router = useRouter();
  const params = useSearchParams();
  const [, startTransition] = useTransition();
  const active = detectActivePreset(query);

  const apply = (hoursAgo: number | null) => {
    const next = new URLSearchParams(params.toString());
    if (hoursAgo === null) {
      next.delete('started_after');
      next.delete('started_before');
    } else {
      next.set('started_after', new Date(Date.now() - hoursAgo * 3_600_000).toISOString());
      next.delete('started_before');
    }
    next.delete('cursor');
    next.delete('view');
    startTransition(() => {
      router.replace(`/runs${next.toString() ? `?${next}` : ''}`);
    });
  };
  const activeLabel = TIME_PRESETS.find((p) => p.id === active)?.label ?? 'Any time';
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="secondary" size="sm" type="button">
          {activeLabel}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-44">
        <DropdownMenuLabel>Time range</DropdownMenuLabel>
        {TIME_PRESETS.map((p) => (
          <DropdownMenuItem key={p.id} onSelect={() => apply(p.hours)}>
            {p.label}
            {active === p.id ? <span className="ml-auto text-[10px]">active</span> : null}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => apply(null)}>Any time</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

interface ActiveChip {
  readonly key: string;
  readonly label: string;
  /** URLSearchParams keys to delete to clear this chip. */
  readonly clearKeys: readonly string[];
}

function buildActiveChips(q: RunSearchQuery): ReadonlyArray<ActiveChip> {
  const chips: ActiveChip[] = [];
  if (q.q) chips.push({ key: 'q', label: `“${q.q}”`, clearKeys: ['q'] });
  for (const s of q.status ?? [])
    chips.push({ key: `status:${s}`, label: `status: ${s}`, clearKeys: ['status'] });
  for (const a of q.agent ?? [])
    chips.push({ key: `agent:${a}`, label: `agent: ${a}`, clearKeys: ['agent'] });
  for (const m of q.model ?? [])
    chips.push({ key: `model:${m}`, label: `model: ${m}`, clearKeys: ['model'] });
  for (const t of q.tag ?? []) chips.push({ key: `tag:${t}`, label: `#${t}`, clearKeys: ['tag'] });
  if (q.cost_gte !== undefined || q.cost_lte !== undefined) {
    const lo = q.cost_gte !== undefined ? `$${q.cost_gte}` : '$0';
    const hi = q.cost_lte !== undefined ? `$${q.cost_lte}` : '∞';
    chips.push({ key: 'cost', label: `cost ${lo}–${hi}`, clearKeys: ['cost_gte', 'cost_lte'] });
  }
  if (q.duration_gte !== undefined || q.duration_lte !== undefined) {
    const lo = q.duration_gte !== undefined ? `${q.duration_gte}ms` : '0ms';
    const hi = q.duration_lte !== undefined ? `${q.duration_lte}ms` : '∞';
    chips.push({
      key: 'latency',
      label: `latency ${lo}–${hi}`,
      clearKeys: ['duration_gte', 'duration_lte'],
    });
  }
  if (q.started_after || q.started_before) {
    chips.push({
      key: 'time',
      label: 'time range',
      clearKeys: ['started_after', 'started_before'],
    });
  }
  if (q.has_children !== undefined)
    chips.push({ key: 'composite', label: 'composite', clearKeys: ['has_children'] });
  if (q.has_failed_event !== undefined)
    chips.push({ key: 'has-failed', label: 'has failed event', clearKeys: ['has_failed_event'] });
  if (q.include_archived !== undefined)
    chips.push({
      key: 'include-archived',
      label: 'include archived',
      clearKeys: ['include_archived'],
    });
  return chips;
}

function ActiveFilterChips({ query }: { query: RunSearchQuery }) {
  const router = useRouter();
  const params = useSearchParams();
  const [, startTransition] = useTransition();
  const chips = buildActiveChips(query);
  if (chips.length === 0) return null;
  const removeChip = (clearKeys: readonly string[]) => {
    const next = new URLSearchParams(params.toString());
    for (const k of clearKeys) next.delete(k);
    next.delete('cursor');
    next.delete('view');
    startTransition(() => router.replace(`/runs${next.toString() ? `?${next}` : ''}`));
  };
  const clearAll = () => startTransition(() => router.replace('/runs'));
  return (
    <div className="flex flex-wrap items-center gap-1.5 px-1 pb-2">
      <span className="text-[11px] font-medium text-fg-muted">
        {chips.length} active filter{chips.length === 1 ? '' : 's'}:
      </span>
      {chips.map((chip) => (
        <button
          key={chip.key}
          type="button"
          onClick={() => removeChip(chip.clearKeys)}
          className="group inline-flex items-center gap-1 rounded-full border border-border bg-bg-elevated px-2 py-0.5 text-[11px] text-fg hover:border-fg-muted hover:bg-bg-subtle"
          aria-label={`Remove filter ${chip.label}`}
        >
          {chip.label}
          <span aria-hidden className="text-fg-faint group-hover:text-fg">
            ×
          </span>
        </button>
      ))}
      <button
        type="button"
        onClick={clearAll}
        className="ml-1 text-[11px] font-medium text-accent hover:underline"
      >
        Clear all
      </button>
    </div>
  );
}

/**
 * Chip-style multi-select for tags. Renders selected tags as removable
 * pills + a free-text input that autocompletes from the supplied
 * `suggestions` (top-N popular tags). Submitting a new tag (Enter or
 * suggestion click) adds it to the selection. The picker delegates URL
 * sync to the parent — it just calls `onChange(nextTags)`.
 *
 * Local-only normalization: lowercase + trim before adding so the URL
 * round-trip matches the server's tag-normalize rules.
 */
function TagChipPicker({
  selected,
  suggestions,
  onChange,
}: {
  selected: ReadonlyArray<string>;
  suggestions: ReadonlyArray<string>;
  onChange: (tags: string[]) => void;
}) {
  const [input, setInput] = useState('');
  const set = new Set(selected);
  const filteredSuggestions = useMemo(() => {
    const needle = input.trim().toLowerCase();
    return suggestions
      .filter((s) => !set.has(s))
      .filter((s) => (needle.length === 0 ? true : s.includes(needle)))
      .slice(0, 8);
  }, [input, suggestions, set]);

  const add = (raw: string) => {
    const t = raw.trim().toLowerCase();
    if (t.length === 0 || set.has(t)) return;
    onChange([...selected, t]);
    setInput('');
  };
  const remove = (t: string) => onChange(selected.filter((s) => s !== t));

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-1">
        {selected.map((t) => (
          <span
            key={t}
            className="inline-flex items-center gap-1 rounded-full border border-border bg-bg-subtle px-2 py-0.5 text-[11px] text-fg"
          >
            #{t}
            <button
              type="button"
              onClick={() => remove(t)}
              className="text-fg-faint hover:text-fg"
              aria-label={`Remove tag ${t}`}
            >
              ×
            </button>
          </span>
        ))}
      </div>
      <Input
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            add(input);
          }
        }}
        placeholder="Add tag…"
        aria-label="Add tag filter"
        className="h-8 text-xs"
      />
      {filteredSuggestions.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {filteredSuggestions.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => add(s)}
              className="rounded border border-border bg-bg-elevated px-1.5 py-0.5 text-[10px] text-fg-muted hover:border-fg-muted hover:text-fg"
            >
              + {s}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

// Re-export the bulk-action helper for the selection toolbar's optimistic
// path so the toolbar component can stay focused on UI state.
export { bulkRunAction };

// Convenience: silence the unused `bulkRunAction` import when the page
// only uses the toolbar (the selection-toolbar component does the
// import directly).
void 0;
