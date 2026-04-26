'use client';

/**
 * App-level command palette.
 *
 * Mounted once in the root layout via a client island. The Cmd-K /
 * Ctrl-K hotkey is captured globally and toggles a Dialog containing
 * the cmdk Command surface.
 *
 * Result sources:
 *   - Static nav links + theme + logout (always available).
 *   - Recent agents (fetched once on first open from /api/auth-proxy
 *     so we get the auth-bearer token through the proxy).
 *   - Recent runs (same pattern).
 *
 * The static nav set is the wave-12 baseline; T/U/V can extend by
 * adding entries to `STATIC_NAV_RESULTS` in
 * `lib/command-palette-filter.ts` (no need to touch this file).
 */

import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command-palette';
import {
  type CommandGroup as CommandGroupKey,
  type CommandResult,
  STATIC_NAV_RESULTS,
  filterResults,
} from '@/lib/command-palette-filter';
import { setThemeAction } from '@/lib/theme-actions';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';

const GROUP_LABELS: Record<CommandGroupKey, string> = {
  nav: 'Navigation',
  agents: 'Agents',
  runs: 'Recent runs',
  models: 'Models',
  settings: 'Settings',
};

const GROUP_ORDER: ReadonlyArray<CommandGroupKey> = ['nav', 'agents', 'runs', 'models', 'settings'];

interface DynamicResults {
  agents: CommandResult[];
  runs: CommandResult[];
  models: CommandResult[];
}

const EMPTY_DYNAMIC: DynamicResults = { agents: [], runs: [], models: [] };

export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [dynamic, setDynamic] = useState<DynamicResults>(EMPTY_DYNAMIC);

  // Bind Cmd-K / Ctrl-K globally.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // Lazy-load the dynamic sources the first time the palette opens.
  useEffect(() => {
    if (!open) return;
    if (dynamic !== EMPTY_DYNAMIC) return;
    let cancelled = false;
    void (async () => {
      const next = await loadDynamicSources();
      if (!cancelled) setDynamic(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, dynamic]);

  const allResults = useMemo<CommandResult[]>(
    () => [...STATIC_NAV_RESULTS, ...dynamic.agents, ...dynamic.runs, ...dynamic.models],
    [dynamic],
  );

  const ranked = useMemo(() => filterResults(allResults, query), [allResults, query]);

  const grouped = useMemo(() => groupResults(ranked), [ranked]);

  function onSelect(result: CommandResult) {
    setOpen(false);
    setQuery('');
    // Special-case: theme actions don't navigate.
    if (result.id === 'settings:theme-light') {
      void setThemeAction('light');
      document.documentElement.classList.remove('dark');
      return;
    }
    if (result.id === 'settings:theme-dark') {
      void setThemeAction('dark');
      document.documentElement.classList.add('dark');
      return;
    }
    if (result.href.startsWith('http')) {
      window.location.href = result.href;
      return;
    }
    router.push(result.href);
  }

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput
        placeholder="Search agents, runs, models, or settings…"
        value={query}
        onValueChange={setQuery}
      />
      <CommandList>
        <CommandEmpty>
          {query.length === 0 ? 'Type to search agents, runs, models, or settings.' : 'No matches.'}
        </CommandEmpty>
        {GROUP_ORDER.map((groupKey, idx) => {
          const items = grouped[groupKey];
          if (!items || items.length === 0) return null;
          return (
            <div key={groupKey}>
              {idx > 0 ? <CommandSeparator /> : null}
              <CommandGroup heading={GROUP_LABELS[groupKey]}>
                {items.map((item) => (
                  <CommandItem
                    key={item.id}
                    value={`${item.label} ${item.description ?? ''} ${(item.keywords ?? []).join(' ')}`}
                    onSelect={() => onSelect(item)}
                  >
                    <span className="text-sm text-fg">{item.label}</span>
                    {item.description ? (
                      <span className="ml-auto text-xs text-fg-muted">{item.description}</span>
                    ) : null}
                  </CommandItem>
                ))}
              </CommandGroup>
            </div>
          );
        })}
      </CommandList>
    </CommandDialog>
  );
}

function groupResults(
  results: ReadonlyArray<CommandResult>,
): Record<CommandGroupKey, CommandResult[]> {
  const out: Record<CommandGroupKey, CommandResult[]> = {
    nav: [],
    agents: [],
    runs: [],
    models: [],
    settings: [],
  };
  for (const r of results) {
    out[r.group].push(r);
  }
  return out;
}

/**
 * Best-effort dynamic-source loader. Hits the auth-proxy (so the
 * HTTP-only session cookie is unwrapped server-side) for each source.
 * Failures are silent — the static nav set remains usable even when
 * the API is down.
 */
async function loadDynamicSources(): Promise<DynamicResults> {
  const [agents, runs, models] = await Promise.all([
    fetchOrEmpty('/api/auth-proxy/v1/agents?limit=10'),
    fetchOrEmpty('/api/auth-proxy/v1/runs?limit=10'),
    fetchOrEmpty('/api/auth-proxy/v1/models'),
  ]);
  return {
    agents: extractAgents(agents),
    runs: extractRuns(runs),
    models: extractModels(models),
  };
}

async function fetchOrEmpty(url: string): Promise<unknown> {
  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

interface MaybeNamed {
  name?: unknown;
  description?: unknown;
}

interface MaybeRun {
  id?: unknown;
  agent_name?: unknown;
  status?: unknown;
}

interface MaybeModel {
  name?: unknown;
  provider?: unknown;
}

function extractAgents(data: unknown): CommandResult[] {
  if (!data || typeof data !== 'object') return [];
  const items = (data as { items?: unknown }).items;
  if (!Array.isArray(items)) return [];
  return items
    .map((raw): CommandResult | null => {
      const obj = raw as MaybeNamed;
      if (typeof obj.name !== 'string') return null;
      const description = typeof obj.description === 'string' ? obj.description : undefined;
      return {
        id: `agent:${obj.name}`,
        label: obj.name,
        ...(description !== undefined ? { description } : {}),
        group: 'agents',
        href: `/agents/${encodeURIComponent(obj.name)}`,
        keywords: ['agent'],
      };
    })
    .filter((x): x is CommandResult => x !== null);
}

function extractRuns(data: unknown): CommandResult[] {
  if (!data || typeof data !== 'object') return [];
  const items = (data as { items?: unknown }).items;
  if (!Array.isArray(items)) return [];
  return items
    .map((raw): CommandResult | null => {
      const obj = raw as MaybeRun;
      if (typeof obj.id !== 'string') return null;
      const agentName = typeof obj.agent_name === 'string' ? obj.agent_name : 'run';
      const status = typeof obj.status === 'string' ? obj.status : '';
      return {
        id: `run:${obj.id}`,
        label: `${agentName} · ${obj.id.slice(0, 8)}`,
        description: status,
        group: 'runs',
        href: `/runs/${encodeURIComponent(obj.id)}`,
        keywords: ['run', agentName, status],
      };
    })
    .filter((x): x is CommandResult => x !== null);
}

function extractModels(data: unknown): CommandResult[] {
  if (!data || typeof data !== 'object') return [];
  const items = (data as { items?: unknown }).items;
  if (!Array.isArray(items)) return [];
  return items
    .map((raw): CommandResult | null => {
      const obj = raw as MaybeModel;
      if (typeof obj.name !== 'string') return null;
      const provider = typeof obj.provider === 'string' ? obj.provider : '';
      return {
        id: `model:${obj.name}`,
        label: obj.name,
        description: provider,
        group: 'models',
        href: `/models#${encodeURIComponent(obj.name)}`,
        keywords: ['model', provider],
      };
    })
    .filter((x): x is CommandResult => x !== null);
}
