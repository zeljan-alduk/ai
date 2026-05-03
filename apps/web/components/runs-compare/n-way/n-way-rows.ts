/**
 * Pure helpers for the N-way `/runs/compare` table.
 *
 * Wave-4 follow-up to the wave-13 2-way compare: the table is the
 * single source of truth for rendered cells, so the rendering logic is
 * isolated here as plain functions. Tests can pin the cell shape and
 * the median-deviation diff highlight without rendering React.
 *
 * LLM-agnostic: every model / provider field is forwarded as an opaque
 * string; nothing branches on a specific provider name.
 */

import type { RunDetail, RunEvent } from '@aldo-ai/api-contract';

/**
 * Hard cap on N. Six runs side-by-side is the readable ceiling we
 * commit to in the picker tooltip; the page enforces it before the
 * table is built so downstream code doesn't have to defensively slice.
 */
export const MAX_RUNS = 6;

/**
 * One side of the N-way table. May represent a real run, a "still
 * loading" placeholder (for SSR pre-fetch failures we want to surface
 * without nuking the page), or a not-found run id (404 from the
 * server) so the column can render a graceful badge.
 */
export type ComparisonColumn =
  | { readonly kind: 'run'; readonly id: string; readonly run: RunDetail }
  | { readonly kind: 'not-found'; readonly id: string; readonly reason: string };

/**
 * Diff highlight: per-cell tag the renderer uses to outline divergent
 * cells. `baseline` = the column the row's median (or the only-non-
 * numeric majority value) lives at; `divergent` = differs from
 * baseline; `match` = same as baseline; `none` = row has no useful
 * comparison signal (e.g. only one run, all values null).
 */
export type CellTag = 'baseline' | 'divergent' | 'match' | 'none';

/** A single rendered cell value. */
export interface ComparisonCell {
  /** Display string. Empty string is rendered as an em-dash. */
  readonly value: string;
  /** Optional tooltip / aria-label override; falls back to `value`. */
  readonly title?: string;
  readonly tag: CellTag;
}

/** A single row in the comparison table. */
export interface ComparisonRow {
  /** Stable key (also used as the test id). */
  readonly key: string;
  /** Left-column human label. */
  readonly label: string;
  /**
   * `quantitative` rows feed the median-deviation highlight; `text`
   * rows compare by string equality; `meta` rows never highlight (e.g.
   * the started-at timestamp — divergence is expected by definition).
   */
  readonly kind: 'quantitative' | 'text' | 'meta';
  /** N cells, one per column. Always same length as `columns`. */
  readonly cells: readonly ComparisonCell[];
  /**
   * True iff at least one pair of cells in the row has different
   * values. Drives the "Show only diffs" filter.
   */
  readonly hasDiff: boolean;
  /**
   * True iff the row is a quantitative metric (tokens, cost, latency,
   * count). Drives the "Show only metrics" filter.
   */
  readonly isMetric: boolean;
}

/* ------------------------------ stack-bar series ------------------------- */

export interface StackBarPoint {
  readonly label: string;
  /** % of the column's allocated stack relative to the row max (0..100). */
  readonly tokensIn: number;
  readonly tokensOut: number;
  readonly cost: number;
  readonly durationMs: number;
  /** Raw values for tooltips / badges. */
  readonly raw: {
    readonly tokensIn: number;
    readonly tokensOut: number;
    readonly cost: number;
    readonly durationMs: number;
  };
}

/* -------------------------------- public API ----------------------------- */

/**
 * Build the full comparison table from N columns. Pure; safe to call
 * during render. The returned shape is exactly what the renderer maps
 * over — if you need a new row, add it here and the table gets it for
 * free.
 */
export function buildComparisonTable(columns: readonly ComparisonColumn[]): {
  readonly columns: readonly ComparisonColumn[];
  readonly rows: readonly ComparisonRow[];
  readonly stackBars: readonly StackBarPoint[];
} {
  const rows: ComparisonRow[] = [];

  rows.push(stringRow('status', 'Status', columns, (r) => r.status, 'meta'));
  rows.push(
    stringRow('agent', 'Agent', columns, (r) => `${r.agentName} ${r.agentVersion}`, 'meta'),
  );
  rows.push(stringRow('startedAt', 'Started', columns, (r) => r.startedAt, 'meta'));
  rows.push(
    quantitativeRow('durationMs', 'Duration (ms)', columns, (r) =>
      typeof r.durationMs === 'number' ? r.durationMs : null,
    ),
  );
  rows.push(
    quantitativeRow('totalUsd', 'Cost (USD)', columns, (r) => r.totalUsd, {
      formatter: usdPrecision4,
      withRelativeBadge: true,
    }),
  );
  rows.push(quantitativeRow('tokensIn', 'Input tokens', columns, (r) => sumTokensIn(r)));
  rows.push(quantitativeRow('tokensOut', 'Output tokens', columns, (r) => sumTokensOut(r)));
  rows.push(
    stringRow(
      'lastModel',
      'Model',
      columns,
      (r) =>
        r.lastModel === null
          ? ''
          : `${r.lastProvider !== null ? `${r.lastProvider} / ` : ''}${r.lastModel}`,
      'text',
    ),
  );
  rows.push(
    stringRow(
      'terminationReason',
      'Termination reason',
      columns,
      (r) => terminationReason(r.events) ?? '',
      'text',
    ),
  );
  rows.push(
    stringRow('errorEvent', 'Error', columns, (r) => firstErrorMessage(r.events) ?? '', 'text'),
  );
  rows.push(
    quantitativeRow('toolCallCount', 'Tool calls', columns, (r) => toolCallCount(r.events)),
  );
  rows.push(
    stringRow('finalOutput', 'Final output', columns, (r) => finalOutput(r.events), 'text'),
  );

  return { columns, rows, stackBars: buildStackBars(columns) };
}

/* ------------------------------ row builders ----------------------------- */

function stringRow(
  key: string,
  label: string,
  columns: readonly ComparisonColumn[],
  pick: (r: RunDetail) => string,
  kind: ComparisonRow['kind'],
): ComparisonRow {
  const values: (string | null)[] = columns.map((c) => (c.kind === 'run' ? pick(c.run) : null));
  // Baseline = the most common non-empty string. If there's no
  // majority, the first non-null wins.
  const baseline = pickStringBaseline(values);
  const cells: ComparisonCell[] = columns.map((c, i) => {
    if (c.kind !== 'run') {
      return { value: 'not found', tag: 'none', title: c.kind === 'not-found' ? c.reason : '' };
    }
    const v = values[i] ?? '';
    if (kind === 'meta') return { value: v, tag: 'none' };
    if (baseline === null) return { value: v, tag: 'none' };
    if (v === baseline) return { value: v, tag: 'baseline' };
    if (v.length === 0) return { value: '', tag: 'divergent' };
    return { value: v, tag: 'divergent' };
  });
  const hasDiff = computeHasDiff(values);
  return { key, label, kind, cells, hasDiff, isMetric: false };
}

function quantitativeRow(
  key: string,
  label: string,
  columns: readonly ComparisonColumn[],
  pick: (r: RunDetail) => number | null,
  opts?: {
    readonly formatter?: (n: number) => string;
    readonly withRelativeBadge?: boolean;
  },
): ComparisonRow {
  const fmt = opts?.formatter ?? defaultNumberFormatter;
  const values: (number | null)[] = columns.map((c) => (c.kind === 'run' ? pick(c.run) : null));
  const numeric = values.filter((v): v is number => typeof v === 'number');
  const median = numeric.length > 0 ? medianOf(numeric) : null;
  const minimum = numeric.length > 0 ? Math.min(...numeric) : null;
  const tagged: ComparisonCell[] = columns.map((c, i) => {
    if (c.kind !== 'run') {
      return { value: 'not found', tag: 'none', title: c.kind === 'not-found' ? c.reason : '' };
    }
    const v = values[i];
    if (v === null || v === undefined) return { value: '—', tag: 'none' };
    let display = fmt(v);
    if (opts?.withRelativeBadge && minimum !== null && minimum >= 0 && minimum < v) {
      const pct = minimum === 0 ? 100 : Math.round(((v - minimum) / minimum) * 100);
      display = `${display}  (+${pct}% vs cheapest)`;
    }
    if (median === null) return { value: display, tag: 'none' };
    if (v === median) return { value: display, tag: 'baseline' };
    // "Divergent" iff the cell is not equal to the median; the renderer
    // colours the outlier amber. Tied values get `match`.
    return { value: display, tag: 'divergent' };
  });
  const hasDiff = computeHasDiff(values);
  return { key, label, kind: 'quantitative', cells: tagged, hasDiff, isMetric: true };
}

/* ------------------------------ stack bars ------------------------------- */

function buildStackBars(columns: readonly ComparisonColumn[]): readonly StackBarPoint[] {
  // Normalise each metric independently (token-stack vs cost-stack vs
  // latency-stack); the renderer maps each to its own chart.
  const points = columns.map((c, i) => {
    const label = `${i + 1}. ${c.id.slice(0, 8)}`;
    if (c.kind !== 'run') {
      return {
        label,
        tokensIn: 0,
        tokensOut: 0,
        cost: 0,
        durationMs: 0,
        raw: { tokensIn: 0, tokensOut: 0, cost: 0, durationMs: 0 },
      };
    }
    const r = c.run;
    return {
      label,
      tokensIn: sumTokensIn(r),
      tokensOut: sumTokensOut(r),
      cost: r.totalUsd,
      durationMs: typeof r.durationMs === 'number' ? r.durationMs : 0,
      raw: {
        tokensIn: sumTokensIn(r),
        tokensOut: sumTokensOut(r),
        cost: r.totalUsd,
        durationMs: typeof r.durationMs === 'number' ? r.durationMs : 0,
      },
    };
  });

  const maxTokens = Math.max(1, ...points.map((p) => p.raw.tokensIn + p.raw.tokensOut));
  const maxCost = Math.max(0.000001, ...points.map((p) => p.raw.cost));
  const maxDuration = Math.max(1, ...points.map((p) => p.raw.durationMs));

  return points.map((p) => ({
    ...p,
    tokensIn: (p.raw.tokensIn / maxTokens) * 100,
    tokensOut: (p.raw.tokensOut / maxTokens) * 100,
    cost: (p.raw.cost / maxCost) * 100,
    durationMs: (p.raw.durationMs / maxDuration) * 100,
  }));
}

/* -------------------------- run-event extractors ------------------------- */

function sumTokensIn(r: RunDetail): number {
  return r.usage.reduce((acc, u) => acc + u.tokensIn, 0);
}

function sumTokensOut(r: RunDetail): number {
  return r.usage.reduce((acc, u) => acc + u.tokensOut, 0);
}

function toolCallCount(events: readonly RunEvent[]): number {
  return events.filter((e) => e.type === 'tool_call').length;
}

/**
 * Extract the `reason` from a `run.terminated_by` event payload.
 * Returns `null` when the event is absent or the payload is mis-shaped
 * (the event type may not be in the api-contract enum on pre-MVP
 * servers; we accept anything that looks like the runtime payload).
 */
export function terminationReason(events: readonly RunEvent[]): string | null {
  for (const e of events) {
    // The api-contract enum predates the runtime addition; check the
    // string directly so we tolerate either schema version.
    if ((e.type as string) !== 'run.terminated_by') continue;
    const p = e.payload as { reason?: unknown; detail?: unknown } | null;
    if (p && typeof p === 'object' && typeof p.reason === 'string') {
      return p.reason;
    }
  }
  return null;
}

function firstErrorMessage(events: readonly RunEvent[]): string | null {
  for (const e of events) {
    if (e.type !== 'error') continue;
    const p = e.payload as { message?: unknown } | string | null;
    if (typeof p === 'string') return p;
    if (p && typeof p === 'object' && typeof p.message === 'string') {
      return p.message;
    }
    return 'error';
  }
  return null;
}

function finalOutput(events: readonly RunEvent[]): string {
  // The "final output" is the most recent message payload; messages
  // are emitted as the assistant talks. Mirrors the v0 output-diff
  // panel in the 2-way compare.
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e === undefined) continue;
    if (e.type !== 'message') continue;
    if (typeof e.payload === 'string') return e.payload;
    if (e.payload && typeof e.payload === 'object') {
      try {
        return JSON.stringify(e.payload);
      } catch {
        return '[unserialisable payload]';
      }
    }
    return '';
  }
  return '';
}

/* --------------------------- diff & math helpers ------------------------- */

function pickStringBaseline(values: readonly (string | null)[]): string | null {
  const counts = new Map<string, number>();
  for (const v of values) {
    if (v === null || v.length === 0) continue;
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  if (counts.size === 0) return null;
  let best: string | null = null;
  let bestCount = 0;
  for (const [k, c] of counts) {
    if (c > bestCount) {
      best = k;
      bestCount = c;
    }
  }
  return best;
}

function computeHasDiff(values: readonly (string | number | null)[]): boolean {
  let seen: string | number | null | undefined;
  let initialised = false;
  for (const v of values) {
    if (!initialised) {
      seen = v;
      initialised = true;
      continue;
    }
    if (v !== seen) return true;
  }
  return false;
}

/** Median of a non-empty numeric array. */
export function medianOf(xs: readonly number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  if (s.length % 2 === 1) {
    return s[m] ?? 0;
  }
  const lo = s[m - 1] ?? 0;
  const hi = s[m] ?? 0;
  return (lo + hi) / 2;
}

function defaultNumberFormatter(n: number): string {
  if (Number.isInteger(n)) return n.toLocaleString('en-US');
  return n.toFixed(3);
}

function usdPrecision4(n: number): string {
  return `$${n.toFixed(4)}`;
}

/* -------------------------- URL parsing helpers -------------------------- */

/**
 * Parse the `/runs/compare` query string into an ordered, de-duped,
 * length-capped list of run ids. Supports both the new `?ids=a,b,c`
 * form and the wave-13 `?a=&b=` form (preferring `ids` when both are
 * present).
 */
export function parseCompareQuery(sp: {
  readonly ids?: string;
  readonly a?: string;
  readonly b?: string;
}): readonly string[] {
  const raw = sp.ids ?? '';
  const fromIds = raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (fromIds.length > 0) {
    return dedupe(fromIds).slice(0, MAX_RUNS);
  }
  const a = (sp.a ?? '').trim();
  const b = (sp.b ?? '').trim();
  const out: string[] = [];
  if (a.length > 0) out.push(a);
  if (b.length > 0) out.push(b);
  return dedupe(out).slice(0, MAX_RUNS);
}

function dedupe(xs: readonly string[]): readonly string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of xs) {
    if (seen.has(x)) continue;
    seen.add(x);
    out.push(x);
  }
  return out;
}

/* ----------------------------- fork lineage ------------------------------ */

export interface ForkEdge {
  readonly childId: string;
  readonly parentId: string;
  readonly childIndex: number;
  readonly parentIndex: number;
}

/**
 * Detect fork edges among the supplied columns: a column whose
 * `parentRunId` matches another column in the set is a fork of that
 * column. Used by the lineage banner.
 */
export function detectForkLineage(columns: readonly ComparisonColumn[]): readonly ForkEdge[] {
  const idIndex = new Map<string, number>();
  columns.forEach((c, i) => {
    if (c.kind === 'run') idIndex.set(c.run.id, i);
  });
  const edges: ForkEdge[] = [];
  columns.forEach((c, i) => {
    if (c.kind !== 'run') return;
    const parent = c.run.parentRunId;
    if (parent === null) return;
    const parentIndex = idIndex.get(parent);
    if (parentIndex === undefined) return;
    edges.push({
      childId: c.run.id,
      parentId: parent,
      childIndex: i,
      parentIndex,
    });
  });
  return edges;
}
