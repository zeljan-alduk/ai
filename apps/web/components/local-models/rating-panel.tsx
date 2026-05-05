'use client';

/**
 * Rating panel — pick a suite, run it against the selected discovered
 * model, watch per-case results stream in.
 *
 * The table renders progressively: each `case` SSE frame appends a
 * row with a fade-in animation. The summary row pops in at the end.
 *
 * UX choices:
 *   - The CTA is the most prominent affordance; everything else is
 *     informational.
 *   - Pass/fail uses an icon plus colour, never colour alone (a11y).
 *   - tok/s gets a tiny inline bar so a glance answers "fastest case".
 *   - Reasoning ratio is a "thinking" share rendered as a percentage
 *     pill so users can see at a glance which models burn tokens
 *     thinking vs producing visible output.
 */

import type { BenchSuiteListEntry, DiscoveredModelRow } from '@/lib/api';
import type { BenchSuiteCaseRow, BenchSuiteSummaryView } from './rating-state';

interface Props {
  readonly suites: readonly BenchSuiteListEntry[];
  readonly selectedSuiteId: string | null;
  readonly onSelectSuite: (id: string) => void;
  readonly selectedModel: DiscoveredModelRow | null;
  readonly rows: readonly BenchSuiteCaseRow[];
  readonly summary: BenchSuiteSummaryView | null;
  readonly status: 'idle' | 'streaming' | 'done' | 'error';
  readonly error: string | null;
  readonly onRun: () => void;
}

export function RatingPanel(props: Props) {
  const selectedSuite =
    props.selectedSuiteId !== null
      ? (props.suites.find((s) => s.id === props.selectedSuiteId) ?? null)
      : null;
  const totalCases = selectedSuite?.caseCount ?? 0;
  const progressPct =
    totalCases > 0 ? Math.min(100, Math.round((props.rows.length / totalCases) * 100)) : 0;
  const peakTokPerSec = peakTokps(props.rows);

  const canRun =
    props.selectedModel !== null && props.selectedSuiteId !== null && props.status !== 'streaming';

  return (
    <section
      aria-labelledby="rating-heading"
      className="flex flex-col rounded-xl border border-border bg-bg-elevated shadow-sm"
    >
      <header className="flex flex-col gap-3 border-b border-border px-4 py-3">
        <div className="flex items-baseline justify-between gap-3">
          <div>
            <h2 id="rating-heading" className="text-sm font-semibold text-fg">
              Quality × speed rating
            </h2>
            <p className="text-xs text-fg-muted">
              Runs every case at temperature=0 and scores via the eval harness. Pass/fail per case
              is the evaluator's call; the bench just times it.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-0 flex-1">
            <label className="block text-[11px] font-medium text-fg-muted" htmlFor="suite-pick">
              Eval suite
            </label>
            <select
              id="suite-pick"
              value={props.selectedSuiteId ?? ''}
              onChange={(e) => props.onSelectSuite(e.target.value)}
              disabled={props.status === 'streaming' || props.suites.length === 0}
              className="mt-1 w-full rounded-md border border-border bg-bg px-2 py-1.5 text-sm text-fg disabled:opacity-50"
            >
              {props.suites.length === 0 ? (
                <option value="">no server-side suites available</option>
              ) : (
                props.suites.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} v{s.version} · {s.caseCount} cases
                  </option>
                ))
              )}
            </select>
          </div>

          <button
            type="button"
            onClick={props.onRun}
            disabled={!canRun}
            className={[
              'shrink-0 rounded-md px-4 py-2 text-sm font-semibold transition-all',
              canRun
                ? 'bg-accent text-accent-fg shadow-sm hover:shadow-md'
                : 'bg-bg-subtle text-fg-muted opacity-60',
            ].join(' ')}
          >
            {props.status === 'streaming' ? 'Running…' : 'Run rating'}
          </button>
        </div>

        {selectedSuite !== null ? (
          <p className="text-[11px] leading-snug text-fg-muted" title={selectedSuite.description}>
            {truncate(selectedSuite.description, 200)}
          </p>
        ) : null}

        {props.selectedModel === null ? (
          <p className="text-xs text-fg-muted">Select a discovered model on the left to begin.</p>
        ) : (
          <p className="text-xs text-fg-muted">
            Target: <span className="font-mono text-fg">{props.selectedModel.id}</span> at{' '}
            <span className="font-mono text-fg">{props.selectedModel.baseUrl}</span>
          </p>
        )}

        {props.status === 'streaming' && totalCases > 0 ? (
          <div className="flex items-center gap-2">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-bg-subtle">
              <div
                className="h-full bg-accent transition-all duration-300"
                style={{ width: `${progressPct}%` }}
              />
            </div>
            <span className="shrink-0 font-mono text-[11px] text-fg-muted">
              {props.rows.length}/{totalCases}
            </span>
          </div>
        ) : null}
      </header>

      {props.error !== null ? (
        <div className="m-4 rounded-md border border-danger/40 bg-danger/5 px-3 py-2 text-xs text-danger">
          {props.error}
        </div>
      ) : null}

      <div className="flex-1">
        {props.rows.length === 0 && props.status === 'idle' ? (
          <IdleHint />
        ) : (
          <ResultsTable rows={props.rows} peakTokPerSec={peakTokPerSec} />
        )}
      </div>

      {props.summary !== null ? <SummaryFooter summary={props.summary} /> : null}
    </section>
  );
}

function ResultsTable({
  rows,
  peakTokPerSec,
}: {
  rows: readonly BenchSuiteCaseRow[];
  peakTokPerSec: number;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-border bg-bg-elevated/50 text-[10px] uppercase tracking-wide text-fg-muted">
            <th className="px-3 py-2 text-left font-medium">Case</th>
            <th className="px-2 py-2 text-center font-medium">Pass</th>
            <th className="px-2 py-2 text-right font-medium">Total</th>
            <th className="px-2 py-2 text-right font-medium">TTFT</th>
            <th className="px-2 py-2 text-right font-medium">Tok in</th>
            <th className="px-2 py-2 text-right font-medium">Tok out</th>
            <th className="px-2 py-2 text-right font-medium">Reason</th>
            <th className="px-2 py-2 text-right font-medium">Tok/s</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <CaseRow key={r.id} row={r} peakTokPerSec={peakTokPerSec} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CaseRow({
  row,
  peakTokPerSec,
}: {
  row: BenchSuiteCaseRow;
  peakTokPerSec: number;
}) {
  const passSymbol = row.passed
    ? { glyph: '✓', class: 'text-emerald-600 dark:text-emerald-400', label: 'pass' }
    : row.error !== undefined
      ? { glyph: '!', class: 'text-amber-600 dark:text-amber-400', label: 'error' }
      : { glyph: '✗', class: 'text-red-600 dark:text-red-400', label: 'fail' };

  const tpsBarPct =
    row.tokPerSec !== null && peakTokPerSec > 0
      ? Math.min(100, Math.max(4, (row.tokPerSec / peakTokPerSec) * 100))
      : 0;

  return (
    <tr className="animate-fade-in border-b border-border/60 last:border-0">
      <td className="px-3 py-2 font-mono text-fg">
        <div className="flex flex-col gap-0.5">
          <span>{row.id}</span>
          {row.error !== undefined ? (
            <span className="truncate text-[10px] font-normal text-amber-600/80 dark:text-amber-400/80">
              {row.error}
            </span>
          ) : null}
        </div>
      </td>
      <td className="px-2 py-2 text-center">
        <span
          className={`inline-flex h-5 w-5 items-center justify-center rounded-full bg-bg ${passSymbol.class}`}
          aria-label={passSymbol.label}
          title={passSymbol.label}
        >
          {passSymbol.glyph}
        </span>
      </td>
      <td className="px-2 py-2 text-right font-mono text-fg-muted">{fmtMs(row.totalMs)}</td>
      <td className="px-2 py-2 text-right font-mono text-fg-muted">
        {row.ttftMs !== null ? fmtMs(row.ttftMs) : '—'}
      </td>
      <td className="px-2 py-2 text-right font-mono text-fg-muted">{row.tokensIn ?? '—'}</td>
      <td className="px-2 py-2 text-right font-mono text-fg-muted">{row.tokensOut ?? '—'}</td>
      <td className="px-2 py-2 text-right">
        {row.reasoningRatio !== null ? (
          <span
            className="rounded-full bg-violet-500/10 px-2 py-0.5 font-mono text-[10px] text-violet-700 dark:text-violet-400"
            title="Fraction of output tokens spent in reasoning_content"
          >
            {Math.round(row.reasoningRatio * 100)}%
          </span>
        ) : (
          <span className="font-mono text-[10px] text-fg-muted">—</span>
        )}
      </td>
      <td className="px-2 py-2 text-right">
        {row.tokPerSec !== null ? (
          <div className="flex items-center justify-end gap-2">
            <div className="hidden h-1.5 w-12 overflow-hidden rounded-full bg-bg-subtle sm:block">
              <div className="h-full bg-accent" style={{ width: `${tpsBarPct}%` }} />
            </div>
            <span className="font-mono tabular-nums text-fg">{row.tokPerSec.toFixed(1)}</span>
          </div>
        ) : (
          <span className="font-mono text-fg-muted">—</span>
        )}
      </td>
    </tr>
  );
}

function SummaryFooter({ summary }: { summary: BenchSuiteSummaryView }) {
  const passClass =
    summary.passRate >= 0.9
      ? 'text-emerald-600 dark:text-emerald-400'
      : summary.passRate >= 0.6
        ? 'text-amber-600 dark:text-amber-400'
        : 'text-red-600 dark:text-red-400';
  return (
    <footer className="grid grid-cols-2 gap-x-4 gap-y-2 border-t border-border bg-bg-elevated/40 px-4 py-3 text-xs sm:grid-cols-4">
      <Stat
        label="Pass rate"
        value={`${summary.passed}/${summary.total}`}
        accent={passClass}
        sub={`${Math.round(summary.passRate * 100)}%`}
      />
      <Stat
        label="Avg tok/s"
        value={summary.avgTokPerSec === null ? '—' : summary.avgTokPerSec.toFixed(1)}
      />
      <Stat
        label="Avg reasoning"
        value={
          summary.avgReasoningRatio === null
            ? '—'
            : `${Math.round(summary.avgReasoningRatio * 100)}%`
        }
      />
      <Stat label="P95 latency" value={`${(summary.p95LatencyMs / 1000).toFixed(1)} s`} />
    </footer>
  );
}

function Stat({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: string;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] uppercase tracking-wide text-fg-muted">{label}</span>
      <span className={`font-mono text-base font-semibold tabular-nums text-fg ${accent ?? ''}`}>
        {value}
        {sub !== undefined ? (
          <span className="ml-1 text-[10px] font-normal text-fg-muted">{sub}</span>
        ) : null}
      </span>
    </div>
  );
}

function IdleHint() {
  return (
    <div className="px-6 py-12 text-center">
      <p className="text-sm font-medium text-fg">Pick a model and a suite, then hit run.</p>
      <p className="mt-1 text-xs text-fg-muted">
        Each case streams in as it finishes. The full suite usually takes 30 s – 2 min on a warm
        local model.
      </p>
    </div>
  );
}

function peakTokps(rows: readonly BenchSuiteCaseRow[]): number {
  let p = 0;
  for (const r of rows) {
    if (r.tokPerSec !== null && r.tokPerSec > p) p = r.tokPerSec;
  }
  return p;
}

function fmtMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n - 1)}…`;
}
