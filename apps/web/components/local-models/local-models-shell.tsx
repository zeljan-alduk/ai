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
 * When every probe fails (most likely cause: CORS preflight blocked
 * because the LLM didn't allow our origin), we surface a CORS help
 * panel with copy-pasteable per-runtime config.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { type BenchCaseRow, type BenchSummary, runBenchDirect, summarise } from './bench-direct';
import { BenchTable } from './bench-table';
import { LOCAL_MODEL_RATING_SUITE } from './builtin-suite';
import { CorsHelpPanel } from './cors-help-panel';
import {
  type DiscoverDirectResult,
  type DiscoveredLocalModel,
  discoverDirect,
} from './discovery-direct';
import { ModelGrid } from './model-grid';
import { ProbeStatus } from './probe-status';

type Phase = 'idle' | 'scanning' | 'ready' | 'running' | 'done' | 'error';

export function LocalModelsShell() {
  const [phase, setPhase] = useState<Phase>('idle');
  const [scan, setScan] = useState<DiscoverDirectResult | null>(null);
  const [selected, setSelected] = useState<DiscoveredLocalModel | null>(null);
  const [rows, setRows] = useState<readonly BenchCaseRow[]>([]);
  const [summary, setSummary] = useState<BenchSummary | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const startScan = useCallback(async () => {
    setPhase('scanning');
    setScan(null);
    try {
      const r = await discoverDirect();
      setScan(r);
      setSelected((cur) => cur ?? r.models[0] ?? null);
      setPhase('ready');
    } catch {
      setPhase('error');
    }
  }, []);

  useEffect(() => {
    void startScan();
  }, [startScan]);

  const startBench = useCallback(async () => {
    if (selected === null) return;
    setRows([]);
    setSummary(null);
    setRunError(null);
    setPhase('running');
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      const accumulated: BenchCaseRow[] = [];
      const res = await runBenchDirect({
        suite: LOCAL_MODEL_RATING_SUITE,
        modelId: selected.id,
        chatBaseUrl: selected.chatBaseUrl,
        signal: ac.signal,
        onCase: (row) => {
          accumulated.push(row);
          setRows([...accumulated]);
          setSummary(summarise(accumulated));
        },
      });
      setSummary(res.summary);
      setPhase('done');
    } catch (e) {
      setRunError(e instanceof Error ? e.message : String(e));
      setPhase('error');
    } finally {
      abortRef.current = null;
    }
  }, [selected]);

  const stopBench = useCallback(() => {
    abortRef.current?.abort();
    setPhase('done');
  }, []);

  const total = LOCAL_MODEL_RATING_SUITE.cases.length;
  const progress = phase === 'running' ? Math.round((rows.length / total) * 100) : 0;

  const found = scan?.models ?? [];
  const showCorsHelp = phase === 'ready' && (scan?.likelyBlocked ?? false);
  const showEmpty = phase === 'ready' && found.length === 0 && !showCorsHelp;

  return (
    <div className="flex flex-col gap-6">
      <StatusStrip
        phase={phase}
        scan={scan}
        onRescan={startScan}
        progress={progress}
        progressLabel={phase === 'running' ? `${rows.length}/${total} cases` : null}
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
            <ModelGrid models={found} selectedId={selected?.id ?? null} onSelect={setSelected} />
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
              Eight cases probe instruction-following, JSON output, code reasoning, retrieval,
              multi-step inference, refusal, and long-context recall. Pass/fail per case is the
              evaluator's call; the bench just times it.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {phase === 'running' ? (
              <button
                type="button"
                onClick={stopBench}
                className="rounded-lg border border-border bg-bg px-3 py-2 text-sm font-medium text-fg hover:bg-bg-subtle"
              >
                Stop
              </button>
            ) : null}
            <button
              type="button"
              onClick={startBench}
              disabled={selected === null || phase === 'running'}
              className={[
                'inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold shadow-sm transition-all',
                selected !== null && phase !== 'running'
                  ? 'bg-accent text-accent-fg hover:shadow-md'
                  : 'bg-bg-subtle text-fg-muted opacity-60',
              ].join(' ')}
            >
              {phase === 'running' ? (
                <>
                  <Spinner /> Running…
                </>
              ) : (
                <>Run rating →</>
              )}
            </button>
          </div>
        </header>

        <div className="px-5 py-5">
          {selected === null && phase !== 'running' ? (
            <p className="text-sm text-fg-muted">
              Pick a discovered model above, then run the rating.
            </p>
          ) : (
            <BenchTable rows={rows} summary={summary} runError={runError} suiteCases={total} />
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
