'use client';

/**
 * Wave-3 (Tier-3.1) — Playground client view.
 *
 * Three-pane layout (mirrors Braintrust's known shape):
 *   1. Top picker bar — evaluator + dataset + sample-size + Run.
 *   2. Results table (left) — one row per dataset example with score
 *      pill + per-row latency. Click a row → detail panel with full
 *      input/expected/output/score breakdown.
 *   3. Aggregate panel (right) — pass-rate big number, score
 *      distribution bars, p50/p95 latency, total cost, "Save as suite".
 *
 * Live updates use the same polling shape as `/eval/sweeps/[id]`:
 * GET `/v1/eval/playground/runs/:id` every 1.5s until status is
 * terminal. We deliberately do NOT add SSE for v0; the existing
 * pattern is what the runs/timeline + sweep-view ship today.
 *
 * Semantic tokens only (no hardcoded slate-*).
 */

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { ApiClientError, getPlaygroundRun, startPlaygroundRun } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatUsd } from '@/lib/format';
import type { PlaygroundRun, PlaygroundScoredRow } from '@aldo-ai/api-contract';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

/** Structural subset of the wire `Evaluator` we actually consume in the picker. */
export interface PlaygroundEvaluatorChoice {
  readonly id: string;
  readonly name: string;
  readonly kind: string;
}

/** Structural subset of the wire `Dataset` we actually consume in the picker. */
export interface PlaygroundDatasetChoice {
  readonly id: string;
  readonly name: string;
  readonly exampleCount: number;
}

const POLL_INTERVAL_MS = 1_500;

export function PlaygroundView({
  initialEvaluators,
  initialDatasets,
}: {
  initialEvaluators: readonly PlaygroundEvaluatorChoice[];
  initialDatasets: readonly PlaygroundDatasetChoice[];
}) {
  const evaluators = initialEvaluators;
  const datasets = initialDatasets;
  const noEvaluators = evaluators.length === 0;
  const noDatasets = datasets.length === 0;

  const [evaluatorId, setEvaluatorId] = useState<string>(evaluators[0]?.id ?? '');
  const [datasetId, setDatasetId] = useState<string>(datasets[0]?.id ?? '');
  const initialDataset = datasets[0];
  const [sampleSize, setSampleSize] = useState<number>(
    Math.min(initialDataset?.exampleCount ?? 10, 25),
  );
  const [run, setRun] = useState<PlaygroundRun | null>(null);
  const [busy, setBusy] = useState(false);
  const [pollError, setPollError] = useState<string | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const [selectedRowId, setSelectedRowId] = useState<string | null>(null);
  const seenRunId = useRef<string | null>(null);

  const selectedDataset = datasets.find((d) => d.id === datasetId);
  const selectedEvaluator = evaluators.find((e) => e.id === evaluatorId);

  // Clamp sample size when the dataset switches.
  useEffect(() => {
    const ec = selectedDataset?.exampleCount ?? 0;
    if (ec === 0) {
      setSampleSize(0);
      return;
    }
    setSampleSize((n) => Math.min(Math.max(1, n), ec));
  }, [selectedDataset?.exampleCount]);

  // Poll the run endpoint while non-terminal. Mirrors the pattern in
  // /eval/sweeps/[id]/sweep-view.tsx.
  useEffect(() => {
    if (run === null) return;
    if (run.id !== seenRunId.current) {
      seenRunId.current = run.id;
    }
    if (run.status === 'completed' || run.status === 'failed' || run.status === 'cancelled') {
      return;
    }
    let cancelled = false;
    const ctrl = new AbortController();
    const tick = async () => {
      if (cancelled) return;
      try {
        const res = await getPlaygroundRun(run.id, { signal: ctrl.signal });
        if (cancelled) return;
        setRun(res.run);
        setPollError(null);
      } catch (err) {
        if (cancelled) return;
        if ((err as { name?: string }).name === 'AbortError') return;
        setPollError(err instanceof ApiClientError ? err.message : 'Polling failed.');
      }
    };
    const handle = setInterval(tick, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(handle);
      ctrl.abort();
    };
  }, [run]);

  const onRun = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setStartError(null);
    setSelectedRowId(null);
    setRun(null);
    try {
      const { runId } = await startPlaygroundRun({
        evaluatorId,
        datasetId,
        sampleSize,
      });
      // Seed the run state with a placeholder shell so the UI shows
      // "running" instantly. The next poll tick replaces it.
      const placeholder: PlaygroundRun = {
        id: runId,
        evaluatorId,
        evaluatorName: selectedEvaluator?.name ?? evaluatorId,
        evaluatorKind: selectedEvaluator?.kind ?? '',
        datasetId,
        datasetName: selectedDataset?.name ?? datasetId,
        sampleSize,
        status: 'running',
        startedAt: new Date().toISOString(),
        endedAt: null,
        rows: [],
        aggregate: {
          scored: 0,
          total: sampleSize,
          passed: 0,
          failed: 0,
          passRate: 0,
          meanScore: 0,
          p50Score: 0,
          p95Score: 0,
          minScore: 0,
          maxScore: 0,
          meanDurationMs: 0,
          totalCostUsd: 0,
        },
      };
      setRun(placeholder);
    } catch (err) {
      setStartError(
        err instanceof ApiClientError ? err.message : 'Could not start playground run.',
      );
    } finally {
      setBusy(false);
    }
  }, [busy, evaluatorId, datasetId, sampleSize, selectedEvaluator, selectedDataset]);

  const selectedRow = useMemo(() => {
    if (run === null || selectedRowId === null) return null;
    return run.rows.find((r) => r.exampleId === selectedRowId) ?? null;
  }, [run, selectedRowId]);

  if (noEvaluators || noDatasets) {
    return (
      <EmptyState
        title="Playground needs an evaluator and a dataset"
        description={
          noEvaluators && noDatasets
            ? 'Create at least one evaluator and one dataset, then come back to score them in bulk.'
            : noEvaluators
              ? 'Create at least one evaluator to start scoring.'
              : 'Create at least one dataset (with examples) to score against.'
        }
      />
    );
  }

  return (
    <div className="flex flex-col gap-4" data-testid="playground-root">
      <PickerBar
        evaluators={evaluators}
        datasets={datasets}
        evaluatorId={evaluatorId}
        datasetId={datasetId}
        sampleSize={sampleSize}
        busy={busy}
        runStatus={run?.status ?? null}
        onEvaluatorChange={setEvaluatorId}
        onDatasetChange={(id) => {
          setDatasetId(id);
          setSelectedRowId(null);
        }}
        onSampleSizeChange={setSampleSize}
        onRun={onRun}
      />

      {startError ? (
        <div
          role="alert"
          className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger"
        >
          {startError}
        </div>
      ) : null}
      {pollError ? (
        <div className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
          Last refresh failed: {pollError}. Will keep retrying every {POLL_INTERVAL_MS / 1000}s.
        </div>
      ) : null}

      {run === null ? (
        <EmptyState
          title="No run yet"
          description="Pick an evaluator + dataset above and hit Run. Per-row scores stream in below."
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
          <div className="lg:col-span-3">
            <ResultsTable run={run} selectedRowId={selectedRowId} onSelectRow={setSelectedRowId} />
            {selectedRow ? (
              <RowDetail row={selectedRow} onClose={() => setSelectedRowId(null)} />
            ) : null}
          </div>
          <div className="lg:col-span-2">
            <AggregatePanel run={run} />
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Picker bar
// ---------------------------------------------------------------------------

function PickerBar({
  evaluators,
  datasets,
  evaluatorId,
  datasetId,
  sampleSize,
  busy,
  runStatus,
  onEvaluatorChange,
  onDatasetChange,
  onSampleSizeChange,
  onRun,
}: {
  evaluators: readonly PlaygroundEvaluatorChoice[];
  datasets: readonly PlaygroundDatasetChoice[];
  evaluatorId: string;
  datasetId: string;
  sampleSize: number;
  busy: boolean;
  runStatus: PlaygroundRun['status'] | null;
  onEvaluatorChange: (id: string) => void;
  onDatasetChange: (id: string) => void;
  onSampleSizeChange: (n: number) => void;
  onRun: () => void;
}) {
  const dataset = datasets.find((d) => d.id === datasetId);
  const exampleCount = dataset?.exampleCount ?? 0;
  const isRunning = runStatus === 'running';
  const disabled = busy || isRunning || exampleCount === 0 || evaluatorId === '';

  return (
    <Card className="flex flex-col gap-3 p-4 sm:flex-row sm:flex-wrap sm:items-end">
      <label className="flex flex-1 min-w-[180px] flex-col gap-1">
        <span className="text-[11px] font-medium uppercase tracking-wide text-fg-muted">
          Evaluator
        </span>
        <select
          value={evaluatorId}
          onChange={(e) => onEvaluatorChange(e.target.value)}
          aria-label="Evaluator"
          className="min-h-touch h-11 rounded-md border border-border bg-bg-elevated px-3 text-base text-fg sm:h-9 sm:text-sm focus:outline-none focus:ring-2 focus:ring-ring/30"
        >
          {evaluators.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name} · {e.kind}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-1 min-w-[180px] flex-col gap-1">
        <span className="text-[11px] font-medium uppercase tracking-wide text-fg-muted">
          Dataset
        </span>
        <select
          value={datasetId}
          onChange={(e) => onDatasetChange(e.target.value)}
          aria-label="Dataset"
          className="min-h-touch h-11 rounded-md border border-border bg-bg-elevated px-3 text-base text-fg sm:h-9 sm:text-sm focus:outline-none focus:ring-2 focus:ring-ring/30"
        >
          {datasets.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name} · {d.exampleCount} ex
            </option>
          ))}
        </select>
      </label>
      <label className="flex w-full flex-col gap-1 sm:w-auto sm:min-w-[200px]">
        <span className="text-[11px] font-medium uppercase tracking-wide text-fg-muted">
          Sample size · {sampleSize} of {exampleCount}
        </span>
        <Input
          type="range"
          min={Math.min(1, exampleCount)}
          max={Math.max(1, exampleCount)}
          step={1}
          value={sampleSize}
          onChange={(e) => onSampleSizeChange(Number(e.target.value))}
          disabled={exampleCount === 0}
          aria-label="Sample size"
          className="h-11 px-0 sm:h-9"
        />
      </label>
      <div className="flex flex-col gap-1">
        <span className="text-[11px] font-medium uppercase tracking-wide text-fg-muted">
          &nbsp;
        </span>
        <Button
          type="button"
          onClick={onRun}
          disabled={disabled}
          data-testid="playground-run-button"
        >
          {isRunning ? 'Scoring…' : busy ? 'Starting…' : 'Run'}
        </Button>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Results table
// ---------------------------------------------------------------------------

function ResultsTable({
  run,
  selectedRowId,
  onSelectRow,
}: {
  run: PlaygroundRun;
  selectedRowId: string | null;
  onSelectRow: (id: string) => void;
}) {
  const polling = run.status === 'running' ? `· polling every ${POLL_INTERVAL_MS / 1000}s` : '';
  return (
    <Card className="overflow-hidden" data-testid="playground-results">
      <div className="flex items-center justify-between border-b border-border px-4 py-2">
        <h2 className="text-sm font-semibold text-fg">
          Per-row scores
          <span className="ml-2 text-xs font-normal text-fg-muted">
            {run.aggregate.scored} of {run.aggregate.total} {polling}
          </span>
        </h2>
        <StatusBadge status={run.status} />
      </div>
      {run.rows.length === 0 ? (
        <div className="px-4 py-10 text-center text-xs text-fg-muted">
          {run.status === 'running' ? 'Scoring rows…' : 'No rows scored.'}
        </div>
      ) : (
        <div className="max-h-[640px] overflow-y-auto">
          <table className="w-full table-fixed text-sm">
            <thead className="sticky top-0 bg-bg-elevated text-left text-[11px] uppercase tracking-wide text-fg-muted">
              <tr className="border-b border-border">
                <th className="w-[36%] px-3 py-2 font-medium">Input</th>
                <th className="w-[36%] px-3 py-2 font-medium">Expected</th>
                <th className="w-[10%] px-3 py-2 text-right font-medium">Score</th>
                <th className="w-[8%] px-3 py-2 text-center font-medium">Result</th>
                <th className="w-[10%] px-3 py-2 text-right font-medium">Latency</th>
              </tr>
            </thead>
            <tbody>
              {run.rows.map((r) => (
                <tr
                  key={r.exampleId}
                  className={cn(
                    'cursor-pointer border-b border-border/50 hover:bg-bg-subtle',
                    selectedRowId === r.exampleId ? 'bg-bg-subtle' : '',
                  )}
                  onClick={() => onSelectRow(r.exampleId)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onSelectRow(r.exampleId);
                    }
                  }}
                  tabIndex={0}
                  data-testid="playground-row"
                >
                  <td className="truncate px-3 py-2 font-mono text-xs text-fg">
                    {r.inputPreview || <span className="text-fg-faint">—</span>}
                  </td>
                  <td className="truncate px-3 py-2 font-mono text-xs text-fg">
                    {r.expectedPreview || <span className="text-fg-faint">—</span>}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-fg">
                    {r.score.toFixed(2)}
                  </td>
                  <td className="px-3 py-2 text-center">
                    <PassPill passed={r.passed} />
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-xs text-fg-muted">
                    {r.durationMs}ms
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function RowDetail({
  row,
  onClose,
}: {
  row: PlaygroundScoredRow;
  onClose: () => void;
}) {
  return (
    <Card className="mt-3 p-4" data-testid="playground-row-detail">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-fg">Row detail</h3>
        <Button type="button" variant="ghost" size="sm" onClick={onClose}>
          Close
        </Button>
      </div>
      <dl className="grid grid-cols-1 gap-3 text-xs">
        <DetailField label="Example id">
          <code className="break-all font-mono text-fg">{row.exampleId}</code>
        </DetailField>
        <DetailField label="Input">
          <pre className="max-h-32 overflow-auto rounded-md border border-border bg-bg-subtle p-2 font-mono text-fg">
            {row.inputPreview || '(empty)'}
          </pre>
        </DetailField>
        <DetailField label="Expected">
          <pre className="max-h-32 overflow-auto rounded-md border border-border bg-bg-subtle p-2 font-mono text-fg">
            {row.expectedPreview || '(empty)'}
          </pre>
        </DetailField>
        <DetailField label="Output scored">
          <pre className="max-h-32 overflow-auto rounded-md border border-border bg-bg-subtle p-2 font-mono text-fg">
            {row.output || '(empty)'}
          </pre>
        </DetailField>
        <DetailField label="Score">
          <span className="font-mono tabular-nums text-fg">{row.score.toFixed(4)}</span>
          <span className="ml-2">
            <PassPill passed={row.passed} />
          </span>
        </DetailField>
        {row.detail !== undefined && row.detail !== null ? (
          <DetailField label="Evaluator detail">
            <pre className="max-h-40 overflow-auto rounded-md border border-border bg-bg-subtle p-2 font-mono text-fg">
              {JSON.stringify(row.detail, null, 2)}
            </pre>
          </DetailField>
        ) : null}
      </dl>
    </Card>
  );
}

function DetailField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="mb-1 text-[10px] font-medium uppercase tracking-wide text-fg-muted">
        {label}
      </dt>
      <dd>{children}</dd>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Aggregate panel
// ---------------------------------------------------------------------------

function AggregatePanel({ run }: { run: PlaygroundRun }) {
  const a = run.aggregate;
  const passRatePct = a.scored === 0 ? '—' : `${Math.round(a.passRate * 100)}%`;
  const meanLatency = a.scored === 0 ? '—' : `${Math.round(a.meanDurationMs)}ms`;

  return (
    <div className="flex flex-col gap-4">
      <Card className="p-4" data-testid="playground-aggregate">
        <h2 className="mb-3 text-sm font-semibold text-fg">Aggregate</h2>
        <div className="grid grid-cols-2 gap-3">
          <BigStat
            label="Pass rate"
            value={passRatePct}
            accent={a.scored > 0 ? a.passRate : null}
          />
          <BigStat label="Scored" value={`${a.scored} / ${a.total}`} accent={null} />
          <SmallStat label="Mean score" value={a.scored === 0 ? '—' : a.meanScore.toFixed(2)} />
          <SmallStat
            label="Min / max"
            value={a.scored === 0 ? '—' : `${a.minScore.toFixed(2)} / ${a.maxScore.toFixed(2)}`}
          />
          <SmallStat label="P50 score" value={a.scored === 0 ? '—' : a.p50Score.toFixed(2)} />
          <SmallStat label="P95 score" value={a.scored === 0 ? '—' : a.p95Score.toFixed(2)} />
          <SmallStat label="Mean latency" value={meanLatency} />
          <SmallStat label="Total cost" value={formatUsd(a.totalCostUsd)} />
        </div>
        <div className="mt-4">
          <h3 className="mb-2 text-[11px] font-medium uppercase tracking-wide text-fg-muted">
            Score distribution
          </h3>
          <ScoreHistogram rows={run.rows} />
        </div>
      </Card>
      <Card className="flex flex-col gap-2 p-4">
        <h2 className="text-sm font-semibold text-fg">Save as suite</h2>
        <p className="text-xs text-fg-muted">
          Promote this evaluator + dataset combination into a permanent suite + sweep. Coming in a
          follow-up — for now this run lives in-memory and is GC'd after 30 minutes.
        </p>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled
          title="Save-as-suite ships in a follow-up wave"
          data-testid="playground-save-as-suite"
        >
          Save as suite
        </Button>
      </Card>
    </div>
  );
}

function BigStat({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent: number | null;
}) {
  // Use an accent colour when we have a pass rate to encode green/amber/red.
  let accentClass = 'text-fg';
  if (accent !== null) {
    if (accent >= 0.8) accentClass = 'text-success';
    else if (accent >= 0.5) accentClass = 'text-warning';
    else accentClass = 'text-danger';
  }
  return (
    <div>
      <div className="text-[10px] font-medium uppercase tracking-wide text-fg-muted">{label}</div>
      <div className={cn('mt-1 text-2xl font-semibold tabular-nums', accentClass)}>{value}</div>
    </div>
  );
}

function SmallStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] font-medium uppercase tracking-wide text-fg-muted">{label}</div>
      <div className="mt-1 text-sm font-medium tabular-nums text-fg">{value}</div>
    </div>
  );
}

function ScoreHistogram({ rows }: { rows: readonly PlaygroundScoredRow[] }) {
  const buckets = bucketScores(rows.map((r) => r.score));
  const max = Math.max(1, ...buckets);
  return (
    <div className="flex h-20 items-end gap-1" aria-label="Score distribution">
      {buckets.map((n, i) => {
        const pct = (n / max) * 100;
        const accent = i / 10 >= 0.8 ? 'bg-success' : i / 10 >= 0.5 ? 'bg-warning' : 'bg-danger';
        return (
          <div
            key={i}
            className="flex-1"
            title={`${(i / 10).toFixed(1)}–${((i + 1) / 10).toFixed(1)}: ${n}`}
          >
            <div className="w-full rounded-sm bg-bg-subtle" style={{ height: '100%' }}>
              <div
                className={cn('w-full rounded-sm', accent)}
                style={{ height: `${pct}%`, marginTop: `${100 - pct}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Bucket scores in [0, 1] into ten 0.1-wide bins for the histogram.
 * Pure for testability — exported so the unit test can assert against
 * 0/1/many rows.
 */
export function bucketScores(scores: readonly number[]): number[] {
  const out = new Array<number>(10).fill(0);
  for (const s of scores) {
    const idx = Math.min(9, Math.max(0, Math.floor(s * 10)));
    out[idx] = (out[idx] ?? 0) + 1;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Pills + badges
// ---------------------------------------------------------------------------

function PassPill({ passed }: { passed: boolean }) {
  return (
    <span
      className={cn(
        'inline-block rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide',
        passed ? 'bg-success/15 text-success' : 'bg-danger/15 text-danger',
      )}
    >
      {passed ? 'Pass' : 'Fail'}
    </span>
  );
}

function StatusBadge({ status }: { status: PlaygroundRun['status'] }) {
  const cls =
    status === 'completed'
      ? 'bg-success/15 text-success'
      : status === 'failed'
        ? 'bg-danger/15 text-danger'
        : status === 'cancelled'
          ? 'bg-bg-subtle text-fg-muted'
          : 'bg-warning/15 text-warning';
  return (
    <span
      className={cn(
        'rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide',
        cls,
      )}
    >
      {status}
    </span>
  );
}
