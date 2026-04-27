/**
 * Pure state machine for the /runs bulk-selection toolbar.
 *
 * Tracked separately from the React component so the transitions are
 * vitest-friendly. The shape mirrors what a typical "table-with-
 * checkboxes" UI needs:
 *
 *   * `selected` — the explicit set of selected ids (Set<string>).
 *   * `mode` — one of 'none' | 'some' | 'all', derived from the
 *     visible-rows snapshot. Renders the tristate "select all"
 *     header checkbox correctly.
 *
 * The reducer is intentionally not a class — a tiny `(state, action)
 * -> state` keeps the transition table explicit and makes pinning
 * the contract through tests straightforward.
 */

export interface SelectionState {
  readonly selected: ReadonlySet<string>;
}

export type SelectionAction =
  | { readonly type: 'toggle'; readonly id: string }
  | { readonly type: 'select'; readonly id: string }
  | { readonly type: 'deselect'; readonly id: string }
  | { readonly type: 'select-all'; readonly ids: ReadonlyArray<string> }
  | { readonly type: 'deselect-all'; readonly ids: ReadonlyArray<string> }
  | { readonly type: 'clear' };

export const EMPTY_SELECTION: SelectionState = { selected: new Set() };

export function selectionReducer(state: SelectionState, action: SelectionAction): SelectionState {
  switch (action.type) {
    case 'toggle': {
      const next = new Set(state.selected);
      if (next.has(action.id)) next.delete(action.id);
      else next.add(action.id);
      return { selected: next };
    }
    case 'select': {
      if (state.selected.has(action.id)) return state;
      const next = new Set(state.selected);
      next.add(action.id);
      return { selected: next };
    }
    case 'deselect': {
      if (!state.selected.has(action.id)) return state;
      const next = new Set(state.selected);
      next.delete(action.id);
      return { selected: next };
    }
    case 'select-all': {
      const next = new Set(state.selected);
      for (const id of action.ids) next.add(id);
      return { selected: next };
    }
    case 'deselect-all': {
      const next = new Set(state.selected);
      for (const id of action.ids) next.delete(id);
      return { selected: next };
    }
    case 'clear': {
      if (state.selected.size === 0) return state;
      return EMPTY_SELECTION;
    }
    default: {
      const _exhaustive: never = action;
      void _exhaustive;
      return state;
    }
  }
}

export type SelectionMode = 'none' | 'some' | 'all';

/**
 * Derive the tristate "select all" mode from the current selection
 * against a snapshot of visible row ids. `'none'` when nothing in
 * the snapshot is selected; `'all'` when every row is selected;
 * `'some'` otherwise. Used by the header checkbox to render the
 * indeterminate hatching.
 */
export function modeForVisible(
  state: SelectionState,
  visibleIds: ReadonlyArray<string>,
): SelectionMode {
  if (visibleIds.length === 0) return 'none';
  let hits = 0;
  for (const id of visibleIds) if (state.selected.has(id)) hits++;
  if (hits === 0) return 'none';
  if (hits === visibleIds.length) return 'all';
  return 'some';
}

/**
 * Compose CSV + JSON download payloads from a list of run summaries.
 * Pure so it round-trips through tests without a DOM.
 */
export interface ExportableRun {
  readonly id: string;
  readonly agentName: string;
  readonly agentVersion: string;
  readonly status: string;
  readonly startedAt: string;
  readonly endedAt: string | null;
  readonly durationMs: number | null;
  readonly totalUsd: number;
  readonly lastProvider: string | null;
  readonly lastModel: string | null;
  readonly tags?: ReadonlyArray<string> | undefined;
}

export function exportToCsv(rows: ReadonlyArray<ExportableRun>): string {
  const header = [
    'id',
    'agent_name',
    'agent_version',
    'status',
    'started_at',
    'ended_at',
    'duration_ms',
    'total_usd',
    'last_provider',
    'last_model',
    'tags',
  ];
  const lines = [header.join(',')];
  for (const r of rows) {
    lines.push(
      [
        csvField(r.id),
        csvField(r.agentName),
        csvField(r.agentVersion),
        csvField(r.status),
        csvField(r.startedAt),
        csvField(r.endedAt ?? ''),
        r.durationMs === null ? '' : String(r.durationMs),
        r.totalUsd.toString(),
        csvField(r.lastProvider ?? ''),
        csvField(r.lastModel ?? ''),
        csvField((r.tags ?? []).join('|')),
      ].join(','),
    );
  }
  // `\r\n` is the spec-friendly CSV line terminator.
  return `${lines.join('\r\n')}\r\n`;
}

export function exportToJson(rows: ReadonlyArray<ExportableRun>): string {
  return `${JSON.stringify(rows, null, 2)}\n`;
}

function csvField(v: string): string {
  if (v.includes(',') || v.includes('"') || v.includes('\n') || v.includes('\r')) {
    return `"${v.replace(/"/g, '""')}"`;
  }
  return v;
}
