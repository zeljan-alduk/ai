'use client';

/**
 * `/local-models` — top-level client island.
 *
 * Composes the discovery panel and the rating panel. State is local —
 * the page is a single coherent flow (find a model, pick a suite, run,
 * watch results), so a lifted-up state model keeps the wiring obvious.
 *
 * LLM-agnostic: every model card displays its `provider` / `source` as
 * an opaque label. The UI never branches on a specific provider name.
 */

import {
  AUTH_PROXY_PREFIX,
  type BenchSuiteListEntry,
  type DiscoveredModelRow,
  discoverLocalModels,
  listBenchSuites,
} from '@/lib/api';
import { useCallback, useEffect, useState } from 'react';
import { DiscoveryPanel } from './discovery-panel';
import { RatingPanel } from './rating-panel';
import type { BenchSuiteCaseRow, BenchSuiteSummaryView } from './rating-state';

export type ScanMode = 'default' | 'common' | 'exhaustive';

export function LocalModelsShell() {
  const [models, setModels] = useState<readonly DiscoveredModelRow[]>([]);
  const [scanMode, setScanMode] = useState<ScanMode>('default');
  const [discoveryStatus, setDiscoveryStatus] = useState<'idle' | 'scanning' | 'error'>('idle');
  const [discoveryError, setDiscoveryError] = useState<string | null>(null);
  const [lastScannedAt, setLastScannedAt] = useState<string | null>(null);

  const [suites, setSuites] = useState<readonly BenchSuiteListEntry[]>([]);
  const [selectedModel, setSelectedModel] = useState<DiscoveredModelRow | null>(null);
  const [selectedSuiteId, setSelectedSuiteId] = useState<string | null>(null);

  const [rows, setRows] = useState<readonly BenchSuiteCaseRow[]>([]);
  const [summary, setSummary] = useState<BenchSuiteSummaryView | null>(null);
  const [runStatus, setRunStatus] = useState<'idle' | 'streaming' | 'done' | 'error'>('idle');
  const [runError, setRunError] = useState<string | null>(null);

  const runDiscovery = useCallback(async (mode: ScanMode) => {
    setDiscoveryStatus('scanning');
    setDiscoveryError(null);
    setScanMode(mode);
    try {
      const r = await discoverLocalModels(mode === 'default' ? {} : { scan: mode });
      setModels(r.models);
      setLastScannedAt(r.discoveredAt);
      setDiscoveryStatus('idle');
      // Auto-select the first model if the user hasn't picked one yet.
      setSelectedModel((current) => current ?? r.models[0] ?? null);
    } catch (e) {
      setDiscoveryError(e instanceof Error ? e.message : 'discovery failed');
      setDiscoveryStatus('error');
    }
  }, []);

  // First-load: fire a default-mode discovery and fetch the suite list.
  useEffect(() => {
    runDiscovery('default');
    listBenchSuites()
      .then((r) => {
        setSuites(r.suites);
        // Default to local-model-rating if it's there.
        const lmr = r.suites.find((s) => s.id === 'local-model-rating');
        setSelectedSuiteId(lmr?.id ?? r.suites[0]?.id ?? null);
      })
      .catch(() => {
        // Quietly ignore — the rating panel will display "no suites available".
      });
  }, [runDiscovery]);

  const onRunRating = useCallback(async () => {
    if (selectedModel === null || selectedSuiteId === null) return;
    if (selectedModel.baseUrl === null) {
      setRunError('selected model has no baseUrl recorded — try rescanning');
      setRunStatus('error');
      return;
    }
    // The bench-suite engine wants the base URL WITHOUT a `/v1` suffix.
    const baseUrl = stripV1Suffix(selectedModel.baseUrl);
    setRows([]);
    setSummary(null);
    setRunError(null);
    setRunStatus('streaming');

    try {
      const res = await fetch(`${AUTH_PROXY_PREFIX}/v1/bench/suite`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'text/event-stream',
        },
        credentials: 'include',
        body: JSON.stringify({
          suiteId: selectedSuiteId,
          model: selectedModel.id,
          baseUrl,
        }),
      });
      if (!res.ok || res.body === null) {
        const text = await res.text();
        let msg = `HTTP ${res.status}`;
        try {
          const env = JSON.parse(text) as { error?: { message?: string } };
          if (env.error?.message) msg = env.error.message;
        } catch {
          /* fall through */
        }
        setRunError(msg);
        setRunStatus('error');
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      const localRows: BenchSuiteCaseRow[] = [];
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let idx = buf.indexOf('\n\n');
        while (idx !== -1) {
          const block = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          idx = buf.indexOf('\n\n');
          const eventLine = block.split('\n').find((l) => l.startsWith('event:'));
          const dataLine = block.split('\n').find((l) => l.startsWith('data:'));
          if (dataLine === undefined) continue;
          const eventName = eventLine?.slice(6).trim() ?? 'message';
          const json = dataLine.slice(5).trim();
          if (json.length === 0) continue;
          if (eventName === 'frame') {
            try {
              const ev = JSON.parse(json) as
                | {
                    type: 'start';
                    totalCases: number;
                    suite: string;
                    version: string;
                    model: string;
                    baseUrl: string;
                  }
                | { type: 'case'; index: number; row: BenchSuiteCaseRow }
                | { type: 'summary'; summary: BenchSuiteSummaryView };
              if (ev.type === 'case') {
                localRows.push(ev.row);
                setRows([...localRows]);
              } else if (ev.type === 'summary') {
                setSummary(ev.summary);
              }
            } catch {
              /* skip malformed frames */
            }
          } else if (eventName === 'error') {
            try {
              const e = JSON.parse(json) as { message?: string };
              setRunError(e.message ?? 'streaming error');
              setRunStatus('error');
            } catch {
              setRunError('streaming error');
              setRunStatus('error');
            }
            return;
          }
        }
      }
      setRunStatus('done');
    } catch (e) {
      setRunError(e instanceof Error ? e.message : 'streaming failed');
      setRunStatus('error');
    }
  }, [selectedModel, selectedSuiteId]);

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
      <DiscoveryPanel
        models={models}
        scanMode={scanMode}
        status={discoveryStatus}
        error={discoveryError}
        lastScannedAt={lastScannedAt}
        selectedId={selectedModel?.id ?? null}
        onSelect={setSelectedModel}
        onRescan={runDiscovery}
      />
      <RatingPanel
        suites={suites}
        selectedSuiteId={selectedSuiteId}
        onSelectSuite={setSelectedSuiteId}
        selectedModel={selectedModel}
        rows={rows}
        summary={summary}
        status={runStatus}
        error={runError}
        onRun={onRunRating}
      />
    </div>
  );
}

function stripV1Suffix(s: string): string {
  let v = s.replace(/\/$/, '');
  if (v.endsWith('/v1')) v = v.slice(0, -3);
  return v;
}
