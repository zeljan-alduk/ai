'use client';

/**
 * `/local-models` — top-level interactive island.
 *
 * Runs entirely from the browser:
 *   - discovery: probe well-known LLM ports on `127.0.0.1` directly
 *     via `fetch()` (no API server in the path — the hosted control
 *     plane can't reach the visitor's loopback anyway).
 *   - bench: stream `/chat/completions` from the browser, score with
 *     a tiny browser-side evaluator port, render rows as they finish.
 *
 * Multiselect comparison: clicking model cards toggles them into the
 * selected set. Pressing "Run rating" iterates the selection in order
 * (sequential, never parallel — bandwidth + RAM contention on a laptop
 * is real and parallel runs would also distort tok/s).
 *
 * Two cancellation surfaces:
 *   - Stop:  global abort → cuts the current case, doesn't queue the
 *            next models, marks pending models as "stopped".
 *   - Skip:  per-case abort → cuts the in-flight case, marks the row
 *            as `skipped: true` (excluded from pass-rate denominator),
 *            continues with the next case (or next model).
 *
 * When every probe fails (most likely cause: CORS preflight blocked
 * because the LLM didn't allow our origin), we surface a CORS help
 * panel with copy-pasteable per-runtime config.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { type BenchCaseRow, type BenchSummary, runBenchDirect, summarise } from './bench-direct';
import { LOCAL_MODEL_RATING_SUITE } from './builtin-suite';
import { CorsHelpPanel } from './cors-help-panel';
import {
  type DiscoverDirectResult,
  type DiscoveredLocalModel,
  discoverDirect,
} from './discovery-direct';
import { ModelGrid } from './model-grid';
import { type ModelRunState, MultiBenchPanel, type RunPhase } from './multi-bench-panel';
import { ProbeStatus } from './probe-status';
import { type SelectedKey, modelKey } from './selection';

type Phase = 'idle' | 'scanning' | 'ready' | 'running' | 'done' | 'error';

export function LocalModelsShell() {
  const [phase, setPhase] = useState<Phase>('idle');
  const [scan, setScan] = useState<DiscoverDirectResult | null>(null);
  const [selectedKeys, setSelectedKeys] = useState<ReadonlySet<SelectedKey>>(new Set());
  const [runs, setRuns] = useState<readonly ModelRunState[]>([]);
  const [runError, setRunError] = useState<string | null>(null);
  // Global abort: stops the whole campaign across all selected models.
  const globalAbortRef = useRef<AbortController | null>(null);
  // Per-case abort: skip just the in-flight case, run continues.
  const caseSkipRef = useRef<(() => void) | null>(null);

  const startScan = useCallback(async () => {
    setPhase('scanning');
    setScan(null);
    try {
      const r = await discoverDirect();
      setScan(r);
      setSelectedKeys((prev) => {
        // Auto-pick the first discovered model on the very first scan
        // so a one-model laptop still gets a one-click run experience.
        if (prev.size > 0) return prev;
        const first = r.models[0];
        if (first === undefined) return prev;
        return new Set([modelKey(first)]);
      });
      setPhase('ready');
    } catch {
      setPhase('error');
    }
  }, []);

  useEffect(() => {
    void startScan();
  }, [startScan]);

  const toggleSelected = useCallback((m: DiscoveredLocalModel) => {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      const k = modelKey(m);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  }, []);

  // Resolve the ordered list of selected models from the scan + selection set.
  const selectedList = useMemo<DiscoveredLocalModel[]>(() => {
    const found = scan?.models ?? [];
    return found.filter((m) => selectedKeys.has(modelKey(m)));
  }, [scan, selectedKeys]);

  const startBench = useCallback(async () => {
    if (selectedList.length === 0) return;
    setRunError(null);
    setPhase('running');
    const ac = new AbortController();
    globalAbortRef.current = ac;

    // Initialise per-model run state up-front so the comparison strip
    // shows every queued model immediately, not as cases stream in.
    const initial: ModelRunState[] = selectedList.map((m, idx) => ({
      model: m,
      phase: idx === 0 ? 'running' : 'queued',
      rows: [],
      summary: null,
      error: null,
    }));
    setRuns(initial);

    try {
      for (let mi = 0; mi < selectedList.length; mi++) {
        if (ac.signal.aborted) break;
        const m = selectedList[mi];
        if (m === undefined) continue;
        if (mi > 0) {
          setRuns((prev) =>
            prev.map((r, i) => (i === mi ? { ...r, phase: 'running' as RunPhase } : r)),
          );
        }
        const accumulated: BenchCaseRow[] = [];
        try {
          const res = await runBenchDirect({
            suite: LOCAL_MODEL_RATING_SUITE,
            modelId: m.id,
            chatBaseUrl: m.chatBaseUrl,
            signal: ac.signal,
            onCaseStart: (_id, skip) => {
              caseSkipRef.current = skip;
            },
            onCase: (row) => {
              accumulated.push(row);
              const snapshot = [...accumulated];
              const summary = summarise(snapshot);
              setRuns((prev) =>
                prev.map((r, i) => (i === mi ? { ...r, rows: snapshot, summary } : r)),
              );
            },
          });
          // Decide how this model's run terminated. If the global abort
          // fired during this model, we mark it stopped; otherwise it
          // ran to completion (some cases may have been skipped — those
          // are still a "done" outcome from the campaign's perspective).
          const finalPhase: RunPhase = ac.signal.aborted ? 'stopped' : 'done';
          setRuns((prev) =>
            prev.map((r, i) => (i === mi ? { ...r, phase: finalPhase, summary: res.summary } : r)),
          );
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          setRuns((prev) =>
            prev.map((r, i) => (i === mi ? { ...r, phase: 'error' as RunPhase, error: msg } : r)),
          );
        } finally {
          caseSkipRef.current = null;
        }
      }
      // Mark any models we didn't reach (because of global stop) as stopped.
      setRuns((prev) =>
        prev.map((r) => (r.phase === 'queued' ? { ...r, phase: 'stopped' as RunPhase } : r)),
      );
      setPhase('done');
    } catch (e) {
      setRunError(e instanceof Error ? e.message : String(e));
      setPhase('error');
    } finally {
      globalAbortRef.current = null;
      caseSkipRef.current = null;
    }
  }, [selectedList]);

  const stopBench = useCallback(() => {
    globalAbortRef.current?.abort();
  }, []);

  const skipCase = useCallback(() => {
    caseSkipRef.current?.();
  }, []);

  const totalCasesPerModel = LOCAL_MODEL_RATING_SUITE.cases.length;
  const completedRows = useMemo(() => runs.reduce((sum, r) => sum + r.rows.length, 0), [runs]);
  const totalRows = totalCasesPerModel * Math.max(1, selectedList.length);
  const progress =
    phase === 'running' && totalRows > 0 ? Math.round((completedRows / totalRows) * 100) : 0;

  const found = scan?.models ?? [];
  const showCorsHelp = phase === 'ready' && (scan?.likelyBlocked ?? false);
  const showEmpty = phase === 'ready' && found.length === 0 && !showCorsHelp;
  const selectionLabel =
    selectedList.length === 0
      ? 'Pick at least one discovered model.'
      : selectedList.length === 1
        ? '1 model selected — pick more to compare side-by-side.'
        : `${selectedList.length} models selected — they will run sequentially.`;

  return (
    <div className="flex flex-col gap-6">
      <StatusStrip
        phase={phase}
        scan={scan}
        onRescan={startScan}
        progress={progress}
        progressLabel={
          phase === 'running'
            ? `${completedRows}/${totalRows} cases · ${selectedList.length} model${selectedList.length === 1 ? '' : 's'}`
            : null
        }
      />

      <section className="rounded-2xl border border-border bg-bg-elevated shadow-sm">
        <header className="flex flex-wrap items-baseline justify-between gap-3 border-b border-border px-5 py-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-accent">
              Step 1
            </p>
            <h2 className="mt-1 text-base font-semibold text-fg">Discover local LLMs</h2>
          </div>
          <p className="font-mono text-[11px] text-fg-muted">
            Probing 127.0.0.1 — Ollama · LM Studio · vLLM · llama.cpp
          </p>
        </header>
        <div className="flex flex-col gap-4 px-5 py-5">
          {phase === 'scanning' && found.length === 0 ? (
            <ScanningHint />
          ) : showCorsHelp ? (
            <CorsHelpPanel onRetry={startScan} />
          ) : showEmpty ? (
            <NoServersFound onRetry={startScan} />
          ) : (
            <ModelGrid
              models={found}
              selectedKeys={selectedKeys}
              onToggle={toggleSelected}
              disabled={phase === 'running'}
            />
          )}
          {/* Per-probe transparency: which runtimes responded, which
              didn't, and an inline CORS recipe for the ones that
              failed. The big CorsHelpPanel above already covers the
              case where every probe failed — skip the strip there to
              avoid duplication. */}
          {scan !== null && !showCorsHelp ? <ProbeStatus probes={scan.probes} /> : null}
        </div>
      </section>

      <section className="rounded-2xl border border-border bg-bg-elevated shadow-sm">
        <header className="flex flex-wrap items-baseline justify-between gap-3 border-b border-border px-5 py-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-accent">
              Step 2
            </p>
            <h2 className="mt-1 text-base font-semibold text-fg">Rate quality × speed</h2>
            <p className="mt-1 max-w-xl text-xs leading-relaxed text-fg-muted">
              Thirteen cases probe instruction-following, JSON output, code reasoning, retrieval,
              multi-step inference, refusal, arithmetic, character-level reasoning, tool-call shape,
              and strict multi-line formatting. Pick multiple models to compare side-by-side — they
              run one at a time. Skip a case if it stalls; stop to abort the whole run.
            </p>
            <p className="mt-2 text-xs font-medium text-fg-muted">{selectionLabel}</p>
          </div>
          <div className="flex items-center gap-2">
            {phase === 'running' ? (
              <>
                <button
                  type="button"
                  onClick={skipCase}
                  className="rounded-lg border border-border bg-bg px-3 py-2 text-sm font-medium text-fg hover:bg-bg-subtle"
                  title="Skip the in-flight case and continue with the next one"
                >
                  Skip case
                </button>
                <button
                  type="button"
                  onClick={stopBench}
                  className="rounded-lg border border-border bg-bg px-3 py-2 text-sm font-medium text-fg hover:bg-bg-subtle"
                  title="Stop the whole run — pending models will not start"
                >
                  Stop
                </button>
              </>
            ) : null}
            <button
              type="button"
              onClick={startBench}
              disabled={selectedList.length === 0 || phase === 'running'}
              className={[
                'inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold shadow-sm transition-all',
                selectedList.length > 0 && phase !== 'running'
                  ? 'bg-accent text-accent-fg hover:shadow-md'
                  : 'bg-bg-subtle text-fg-muted opacity-60',
              ].join(' ')}
            >
              {phase === 'running' ? (
                <>
                  <Spinner /> Running…
                </>
              ) : selectedList.length > 1 ? (
                <>Compare {selectedList.length} models →</>
              ) : (
                <>Run rating →</>
              )}
            </button>
          </div>
        </header>

        <div className="px-5 py-5">
          {runError !== null ? (
            <div className="mb-4 rounded-lg border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
              {runError}
            </div>
          ) : null}
          {runs.length === 0 ? (
            <p className="text-sm text-fg-muted">
              {selectedList.length === 0
                ? 'Pick one or more discovered models above, then run the rating.'
                : 'Press “Run rating” to start.'}
            </p>
          ) : (
            <MultiBenchPanel runs={runs} suiteCases={totalCasesPerModel} />
          )}
        </div>
      </section>
    </div>
  );
}

function StatusStrip({
  phase,
  scan,
  onRescan,
  progress,
  progressLabel,
}: {
  phase: Phase;
  scan: DiscoverDirectResult | null;
  onRescan: () => void;
  progress: number;
  progressLabel: string | null;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-bg-elevated px-4 py-3 shadow-sm">
      <PhaseBadge phase={phase} />
      <div className="min-w-0 flex-1 text-xs text-fg-muted">
        {phase === 'scanning' ? (
          <>Probing localhost ports…</>
        ) : phase === 'ready' ? (
          scan === null ? null : scan.models.length === 0 ? (
            <>
              No LLM servers responded on default ports.
              {scan.likelyBlocked ? ' CORS may be blocking — see below.' : ''}
            </>
          ) : (
            <>
              Found <span className="font-mono text-fg">{scan.models.length}</span> model
              {scan.models.length === 1 ? '' : 's'} on{' '}
              <span className="font-mono text-fg">localhost</span>.
            </>
          )
        ) : phase === 'running' ? (
          <>Rating in progress — {progressLabel}</>
        ) : phase === 'done' ? (
          <>Run complete.</>
        ) : phase === 'error' ? (
          <>Something went wrong. Click rescan to retry.</>
        ) : null}
      </div>
      {phase === 'running' ? (
        <div className="flex items-center gap-2">
          <div className="h-1.5 w-32 overflow-hidden rounded-full bg-bg-subtle">
            <div
              className="h-full bg-accent transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
          <span className="font-mono text-[11px] tabular-nums text-fg-muted">{progress}%</span>
        </div>
      ) : null}
      <button
        type="button"
        onClick={onRescan}
        disabled={phase === 'scanning' || phase === 'running'}
        className="rounded-md border border-border bg-bg px-2.5 py-1.5 text-xs font-medium text-fg hover:bg-bg-subtle disabled:opacity-50"
      >
        Rescan
      </button>
    </div>
  );
}

function PhaseBadge({ phase }: { phase: Phase }) {
  const map: Record<Phase, { label: string; tone: string }> = {
    idle: { label: 'Idle', tone: 'bg-bg-subtle text-fg-muted' },
    scanning: { label: 'Scanning', tone: 'bg-accent/15 text-accent' },
    ready: { label: 'Ready', tone: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400' },
    running: { label: 'Running', tone: 'bg-accent/15 text-accent' },
    done: { label: 'Done', tone: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400' },
    error: { label: 'Error', tone: 'bg-amber-500/15 text-amber-700 dark:text-amber-400' },
  };
  const { label, tone } = map[phase];
  return (
    <span
      className={`rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${tone}`}
    >
      {label}
    </span>
  );
}

function ScanningHint() {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-dashed border-border bg-bg px-4 py-6 text-sm text-fg-muted">
      <Spinner />
      <span>Probing default LLM ports on 127.0.0.1…</span>
    </div>
  );
}

function NoServersFound({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="rounded-lg border border-dashed border-border bg-bg px-4 py-6 text-sm">
      <p className="font-medium text-fg">No local LLM servers responded.</p>
      <p className="mt-1 text-fg-muted">
        Start one of: Ollama (port 11434), LM Studio (1234), vLLM (8000), llama.cpp (8080) — then
        rescan.
      </p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-3 rounded-md border border-border bg-bg-elevated px-3 py-1.5 text-xs font-medium text-fg hover:bg-bg-subtle"
      >
        Rescan
      </button>
    </div>
  );
}

function Spinner() {
  return (
    <span
      aria-hidden
      className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-border border-t-accent"
    />
  );
}
