'use client';

/**
 * Discovery panel — lists local LLM servers, with three scan modes:
 *   - default:   named probes only (Ollama/vLLM/llama.cpp/LM Studio)
 *   - common:    named probes + curated ~60-port list
 *   - exhaustive: named probes + full localhost sweep (1024..65535)
 *
 * Each model is a clickable card. The selected card pops out with a
 * `ring-2` accent so the user knows which one the rating panel is
 * pointed at.
 */

import type { DiscoveredModelRow } from '@/lib/api';
import type { ScanMode } from './local-models-shell';

interface Props {
  readonly models: readonly DiscoveredModelRow[];
  readonly scanMode: ScanMode;
  readonly status: 'idle' | 'scanning' | 'error';
  readonly error: string | null;
  readonly lastScannedAt: string | null;
  readonly selectedId: string | null;
  readonly onSelect: (m: DiscoveredModelRow) => void;
  readonly onRescan: (mode: ScanMode) => void;
}

const SCAN_MODES: ReadonlyArray<{
  mode: ScanMode;
  label: string;
  hint: string;
}> = [
  {
    mode: 'default',
    label: 'Default ports',
    hint: 'Ollama (11434), LM Studio (1234), vLLM (8000), llama.cpp (8080).',
  },
  {
    mode: 'common',
    label: 'Common dev ports',
    hint: '~60 ports documented across local-LLM tools. Adds 1-2 s.',
  },
  {
    mode: 'exhaustive',
    label: 'Every localhost port',
    hint: '1024..65535. 10–30 s on a typical laptop.',
  },
];

export function DiscoveryPanel(props: Props) {
  return (
    <section
      aria-labelledby="discovery-heading"
      className="rounded-xl border border-border bg-bg-elevated shadow-sm"
    >
      <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div>
          <h2 id="discovery-heading" className="text-sm font-semibold text-fg">
            Discovered models
          </h2>
          <p className="text-xs text-fg-muted">
            {props.lastScannedAt !== null
              ? `Last scanned ${formatRelative(props.lastScannedAt)}`
              : 'Probing localhost…'}
          </p>
        </div>
        <RescanMenu
          currentMode={props.scanMode}
          disabled={props.status === 'scanning'}
          onPick={props.onRescan}
        />
      </header>

      {props.error !== null ? (
        <div className="m-4 rounded-md border border-danger/40 bg-danger/5 px-3 py-2 text-xs text-danger">
          {props.error}
        </div>
      ) : null}

      {props.status === 'scanning' && props.models.length === 0 ? (
        <ScanningSkeleton mode={props.scanMode} />
      ) : props.models.length === 0 ? (
        <EmptyState />
      ) : (
        <ul className="grid gap-2 p-3 sm:grid-cols-2">
          {props.models.map((m) => (
            <li key={`${m.provider}::${m.id}::${m.baseUrl ?? ''}`}>
              <ModelCard
                model={m}
                selected={props.selectedId === m.id}
                onClick={() => props.onSelect(m)}
              />
            </li>
          ))}
        </ul>
      )}

      {props.status === 'scanning' && props.models.length > 0 ? (
        <div className="border-t border-border px-4 py-2 text-xs text-fg-muted">Scanning…</div>
      ) : null}
    </section>
  );
}

function RescanMenu({
  currentMode,
  disabled,
  onPick,
}: {
  currentMode: ScanMode;
  disabled: boolean;
  onPick: (m: ScanMode) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {SCAN_MODES.map(({ mode, label, hint }) => (
        <button
          key={mode}
          type="button"
          disabled={disabled}
          onClick={() => onPick(mode)}
          title={hint}
          aria-pressed={currentMode === mode}
          className={[
            'rounded-md border px-2.5 py-1 text-xs font-medium transition-colors',
            currentMode === mode
              ? 'border-accent bg-accent/10 text-accent'
              : 'border-border bg-bg text-fg-muted hover:bg-bg-subtle hover:text-fg',
            disabled ? 'cursor-not-allowed opacity-50' : '',
          ].join(' ')}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function ModelCard({
  model,
  selected,
  onClick,
}: {
  model: DiscoveredModelRow;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        'group flex w-full flex-col gap-2 rounded-lg border bg-bg p-3 text-left transition-all',
        selected
          ? 'border-accent ring-2 ring-accent/30'
          : 'border-border hover:border-accent/50 hover:bg-bg-elevated',
      ].join(' ')}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate font-mono text-xs font-medium text-fg" title={model.id}>
            {model.id}
          </p>
          <p className="mt-0.5 truncate text-[10px] text-fg-muted" title={model.baseUrl ?? ''}>
            {model.baseUrl ?? '—'}
          </p>
        </div>
        <SourceBadge source={model.source} />
      </div>
      <div className="flex flex-wrap items-center gap-1 text-[10px] text-fg-muted">
        <span className="rounded bg-bg-elevated px-1.5 py-0.5 font-medium">
          {model.capabilityClass}
        </span>
        {typeof model.effectiveContextTokens === 'number' && model.effectiveContextTokens > 0 ? (
          <span className="rounded bg-bg-elevated px-1.5 py-0.5">
            {formatContext(model.effectiveContextTokens)} ctx
          </span>
        ) : null}
        {(model.provides ?? []).slice(0, 3).map((cap) => (
          <span key={cap} className="rounded bg-bg-elevated px-1.5 py-0.5">
            {cap}
          </span>
        ))}
      </div>
    </button>
  );
}

function SourceBadge({ source }: { source: string }) {
  // Color-code by named-probe vs. port-scan — only two categories so the
  // signal stays obvious without keying on a specific provider name.
  const isPortScan = source === 'openai-compat';
  return (
    <span
      className={[
        'shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium',
        isPortScan
          ? 'bg-amber-500/15 text-amber-700 dark:text-amber-400'
          : 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400',
      ].join(' ')}
      title={isPortScan ? 'Found by port scan (no named probe matched)' : `Named probe: ${source}`}
    >
      {source}
    </span>
  );
}

function ScanningSkeleton({ mode }: { mode: ScanMode }) {
  return (
    <div className="flex flex-col items-center gap-3 px-4 py-10 text-fg-muted">
      <div
        aria-hidden
        className="h-6 w-6 animate-spin rounded-full border-2 border-border border-t-accent"
      />
      <p className="text-xs">
        {mode === 'exhaustive'
          ? 'Sweeping every localhost port (this takes 10-30 s)…'
          : mode === 'common'
            ? 'Probing common dev ports…'
            : 'Probing default ports…'}
      </p>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="px-4 py-10 text-center text-xs text-fg-muted">
      <p>No local LLM servers responded.</p>
      <p className="mt-1">
        Start Ollama / LM Studio / vLLM / llama.cpp, or try a wider port scan above.
      </p>
    </div>
  );
}

function formatContext(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${Math.round(n / 1000)}k`;
  return String(n);
}

function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(diff) || diff < 0) return 'just now';
  if (diff < 5_000) return 'just now';
  if (diff < 60_000) return `${Math.floor(diff / 1000)} s ago`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} min ago`;
  return new Date(iso).toLocaleTimeString();
}
