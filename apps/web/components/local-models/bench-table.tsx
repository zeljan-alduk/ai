'use client';

/**
 * Live bench results table — rows fade in as each case completes.
 */

import type { BenchCaseRow, BenchSummary } from './bench-direct';

interface Props {
  readonly rows: readonly BenchCaseRow[];
  readonly summary: BenchSummary | null;
  readonly runError: string | null;
  readonly suiteCases: number;
}

export function BenchTable({ rows, summary, runError, suiteCases }: Props) {
  const peakTps = peakTokps(rows);
  const placeholders = Math.max(0, suiteCases - rows.length);

  return (
    <div className="flex flex-col gap-4">
      {runError !== null ? (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
          {runError}
        </div>
      ) : null}

      <div className="overflow-x-auto rounded-lg border border-border bg-bg">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-bg-subtle/40 text-[10px] uppercase tracking-wide text-fg-muted">
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
              <Row key={r.id} row={r} peakTps={peakTps} />
            ))}
            {Array.from({ length: placeholders }, (_, i) => (
              <tr key={`pending-${i}`} className="border-b border-border/40 last:border-0">
                <td colSpan={8} className="px-3 py-2 text-xs text-fg-muted">
                  <span className="inline-block h-2 w-32 animate-pulse rounded bg-bg-subtle" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {summary !== null ? <SummaryFooter summary={summary} /> : null}
    </div>
  );
}

function Row({ row, peakTps }: { row: BenchCaseRow; peakTps: number }) {
  const passSym = row.passed
    ? {
        glyph: '✓',
        class: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400',
        label: 'pass',
      }
    : row.error !== undefined
      ? { glyph: '!', class: 'bg-amber-500/15 text-amber-700 dark:text-amber-400', label: 'error' }
      : { glyph: '✗', class: 'bg-red-500/15 text-red-600 dark:text-red-400', label: 'fail' };
  const tpsBarPct =
    row.tokPerSec !== null && peakTps > 0
      ? Math.min(100, Math.max(4, (row.tokPerSec / peakTps) * 100))
      : 0;
  return (
    <tr className="animate-fade-in border-b border-border/60 last:border-0">
      <td className="px-3 py-2 align-top font-mono text-fg">
        <div className="flex flex-col gap-0.5">
          <span>{row.id}</span>
          {row.error !== undefined ? (
            <span className="truncate font-normal text-[10px] text-amber-600/80 dark:text-amber-400/80">
              {row.error}
            </span>
          ) : null}
        </div>
      </td>
      <td className="px-2 py-2 text-center">
        <span
          className={`inline-flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-semibold ${passSym.class}`}
          aria-label={passSym.label}
          title={passSym.label}
        >
          {passSym.glyph}
        </span>
      </td>
      <td className="px-2 py-2 text-right font-mono tabular-nums text-fg-muted">
        {fmtMs(row.totalMs)}
      </td>
      <td className="px-2 py-2 text-right font-mono tabular-nums text-fg-muted">
        {row.ttftMs !== null ? fmtMs(row.ttftMs) : '—'}
      </td>
      <td className="px-2 py-2 text-right font-mono tabular-nums text-fg-muted">
        {row.tokensIn ?? '—'}
      </td>
      <td className="px-2 py-2 text-right font-mono tabular-nums text-fg-muted">
        {row.tokensOut ?? '—'}
      </td>
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

function SummaryFooter({ summary }: { summary: BenchSummary }) {
  const passClass =
    summary.passRate >= 0.9
      ? 'text-emerald-600 dark:text-emerald-400'
      : summary.passRate >= 0.6
        ? 'text-amber-600 dark:text-amber-400'
        : 'text-red-600 dark:text-red-400';
  return (
    <div className="grid grid-cols-2 gap-3 rounded-lg border border-border bg-bg px-4 py-3 text-xs sm:grid-cols-4">
      <Stat
        label="Pass"
        value={`${summary.passed}/${summary.total}`}
        sub={`${Math.round(summary.passRate * 100)}%`}
        accent={passClass}
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
    </div>
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

function peakTokps(rows: readonly BenchCaseRow[]): number {
  let p = 0;
  for (const r of rows) if (r.tokPerSec !== null && r.tokPerSec > p) p = r.tokPerSec;
  return p;
}

function fmtMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}
