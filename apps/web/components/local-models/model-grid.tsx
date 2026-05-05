'use client';

/**
 * Selectable card grid of discovered local LLMs.
 */

import type { DiscoveredLocalModel } from './discovery-direct';

interface Props {
  readonly models: readonly DiscoveredLocalModel[];
  readonly selectedId: string | null;
  readonly onSelect: (m: DiscoveredLocalModel) => void;
}

export function ModelGrid({ models, selectedId, onSelect }: Props) {
  if (models.length === 0) return null;
  return (
    <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {models.map((m) => {
        const selected = selectedId === m.id;
        return (
          <li key={`${m.source}::${m.id}::${m.port}`}>
            <button
              type="button"
              onClick={() => onSelect(m)}
              className={[
                'group flex w-full flex-col gap-3 rounded-xl border bg-bg p-4 text-left transition-all',
                selected
                  ? 'border-accent shadow-sm ring-2 ring-accent/30'
                  : 'border-border hover:border-accent/50 hover:bg-bg-subtle',
              ].join(' ')}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-mono text-sm font-medium text-fg" title={m.id}>
                    {m.id}
                  </p>
                  <p className="mt-1 truncate font-mono text-[11px] text-fg-muted">
                    {m.displayBaseUrl}
                  </p>
                </div>
                <SourceBadge source={m.source} />
              </div>
              <div className="flex flex-wrap items-center gap-1.5 text-[10px] text-fg-muted">
                <Chip>{m.capability}</Chip>
                {typeof m.contextTokens === 'number' && m.contextTokens > 0 ? (
                  <Chip>{formatContext(m.contextTokens)} ctx</Chip>
                ) : null}
                {selected ? (
                  <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-accent/10 px-2 py-0.5 text-[10px] font-semibold text-accent">
                    Selected
                  </span>
                ) : null}
              </div>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return <span className="rounded bg-bg-subtle px-1.5 py-0.5 font-medium">{children}</span>;
}

function SourceBadge({ source }: { source: string }) {
  const palette: Record<string, string> = {
    ollama: 'bg-violet-500/15 text-violet-700 dark:text-violet-400',
    lmstudio: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400',
    vllm: 'bg-sky-500/15 text-sky-700 dark:text-sky-400',
    llamacpp: 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
  };
  return (
    <span
      className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${
        palette[source] ?? 'bg-bg-subtle text-fg-muted'
      }`}
    >
      {source}
    </span>
  );
}

function formatContext(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${Math.round(n / 1000)}k`;
  return String(n);
}
