'use client';

/**
 * Comparative view across multiple selected models.
 *
 * Renders, in order:
 *   1. A compact comparison strip — one row per model with pass-rate,
 *      avg tok/s, p95 latency. Visible once the second model is queued
 *      (no point comparing against a single column).
 *   2. One stacked results section per model — its own `BenchTable`,
 *      its own header with a phase badge ("running"/"done"/"queued"/
 *      "stopped"/"error"). The currently-running model auto-scrolls
 *      into view via a heading anchor.
 *
 * Sequential by design: only one model runs at a time. The shell
 * advances `phase` from `queued` → `running` → `done` per model as it
 * iterates the selection list.
 */

import type { BenchCaseRow, BenchSummary } from './bench-direct';
import { BenchTable } from './bench-table';
import type { DiscoveredLocalModel } from './discovery-direct';

export type RunPhase = 'queued' | 'running' | 'done' | 'stopped' | 'error';

export interface ModelRunState {
  readonly model: DiscoveredLocalModel;
  readonly phase: RunPhase;
  readonly rows: readonly BenchCaseRow[];
  readonly summary: BenchSummary | null;
  readonly error: string | null;
}

interface Props {
  readonly runs: readonly ModelRunState[];
  readonly suiteCases: number;
}

export function MultiBenchPanel({ runs, suiteCases }: Props) {
  if (runs.length === 0) return null;
  const showCompare = runs.length >= 2;
  return (
    <div className="flex flex-col gap-6">
      {showCompare ? <ComparisonStrip runs={runs} /> : null}
      {runs.map((r, idx) => (
        <ModelSection
          key={`${r.model.source}-${r.model.id}-${r.model.port}-${idx}`}
          run={r}
          suiteCases={suiteCases}
        />
      ))}
    </div>
  );
}

function ComparisonStrip({ runs }: { runs: readonly ModelRunState[] }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-bg">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-bg-subtle/40 text-[10px] uppercase tracking-wide text-fg-muted">
            <th className="px-3 py-2 text-left font-medium">Model</th>
            <th className="px-3 py-2 text-left font-medium">Status</th>
            <th className="px-3 py-2 text-right font-medium">Pass</th>
            <th className="px-3 py-2 text-right font-medium">Avg tok/s</th>
            <th className="px-3 py-2 text-right font-medium">P95 latency</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((r, i) => (
            <CompareRow key={`${r.model.source}-${r.model.id}-${r.model.port}-${i}`} run={r} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CompareRow({ run }: { run: ModelRunState }) {
  const s = run.summary;
  const passLabel = s === null ? '—' : `${s.passed}/${s.total}`;
  const passPct = s === null ? null : Math.round(s.passRate * 100);
  const passClass =
    passPct === null
      ? 'text-fg-muted'
      : passPct >= 90
        ? 'text-emerald-600 dark:text-emerald-400'
        : passPct >= 60
          ? 'text-amber-600 dark:text-amber-400'
          : 'text-red-600 dark:text-red-400';
  return (
    <tr className="border-b border-border/60 last:border-0">
      <td className="px-3 py-2 align-top">
        <div className="flex flex-col gap-0.5">
          <span className="truncate font-mono text-[12px] text-fg" title={run.model.id}>
            {run.model.id}
          </span>
          <span className="font-mono text-[10px] text-fg-muted">{run.model.source}</span>
        </div>
      </td>
      <td className="px-3 py-2 align-top">
        <PhaseChip phase={run.phase} />
      </td>
      <td className="px-3 py-2 text-right align-top">
        <span className={`font-mono tabular-nums ${passClass}`}>
          {passLabel}
          {passPct !== null ? (
            <span className="ml-1 text-[10px] font-normal text-fg-muted">{passPct}%</span>
          ) : null}
        </span>
      </td>
      <td className="px-3 py-2 text-right align-top font-mono tabular-nums text-fg">
        {s === null || s.avgTokPerSec === null ? '—' : s.avgTokPerSec.toFixed(1)}
      </td>
      <td className="px-3 py-2 text-right align-top font-mono tabular-nums text-fg">
        {s === null ? '—' : `${(s.p95LatencyMs / 1000).toFixed(1)} s`}
      </td>
    </tr>
  );
}

function ModelSection({ run, suiteCases }: { run: ModelRunState; suiteCases: number }) {
  return (
    <section className="rounded-2xl border border-border bg-bg-elevated shadow-sm">
      <header className="flex flex-wrap items-baseline justify-between gap-3 border-b border-border px-5 py-4">
        <div className="min-w-0">
          <p className="truncate font-mono text-sm font-medium text-fg" title={run.model.id}>
            {run.model.id}
          </p>
          <p className="mt-0.5 truncate font-mono text-[11px] text-fg-muted">
            {run.model.source} · {run.model.displayBaseUrl}
          </p>
        </div>
        <PhaseChip phase={run.phase} />
      </header>
      <div className="px-5 py-5">
        <BenchTable
          rows={run.rows}
          summary={run.summary}
          runError={run.error}
          // Show pending placeholders only while running — once stopped or
          // done, the row count is final and placeholders would mislead.
          suiteCases={run.phase === 'running' ? suiteCases : run.rows.length}
        />
      </div>
    </section>
  );
}

function PhaseChip({ phase }: { phase: RunPhase }) {
  const map: Record<RunPhase, { label: string; tone: string }> = {
    queued: { label: 'Queued', tone: 'bg-bg-subtle text-fg-muted' },
    running: { label: 'Running', tone: 'bg-accent/15 text-accent' },
    done: { label: 'Done', tone: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400' },
    stopped: { label: 'Stopped', tone: 'bg-amber-500/15 text-amber-700 dark:text-amber-400' },
    error: { label: 'Error', tone: 'bg-red-500/15 text-red-600 dark:text-red-400' },
  };
  const { label, tone } = map[phase];
  return (
    <span
      className={`shrink-0 rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${tone}`}
    >
      {label}
    </span>
  );
}
