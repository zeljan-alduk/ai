'use client';

/**
 * App-level command palette — Linear / Vercel / Braintrust parity.
 *
 * Mounted once in the root layout via a client island. The Cmd-K /
 * Ctrl-K hotkey is captured globally and toggles a Dialog containing
 * the cmdk Command surface. Open also responds to a custom
 * `aldo:cmdk:open` window event so the optional sidebar hint button
 * can fire without sharing state.
 *
 * Result sources, in render order:
 *
 *   1. Recents (top 5 across all types from localStorage)
 *   2. Actions (Compare runs…, Fork template…, Connect a repo…,
 *      New prompt…, New dataset…, Toggle dark mode, Sign out)
 *   3. Pages (every top-level route, static)
 *   4. Agents (live, fetched on first open, 60s cache)
 *   5. Runs (live)
 *   6. Datasets (live)
 *   7. Evaluators (live)
 *   8. Prompts (live, optional — endpoint may 404; we silently skip)
 *   9. Models (live)
 *  10. Settings sub-routes
 *  11. Docs (Fuse search against the static docs index)
 *
 * Sub-prompts (Compare runs → pick 2-N runs; Fork template → pick a
 * gallery template) swap the palette into a constrained mode where
 * the input filters only that source and the Enter target collects
 * picks until the user dispatches the action.
 *
 * Wave-4 — designer + frontend pair pass. New since Wave-12 baseline:
 *   - Recents group + localStorage persistence
 *   - Actions group with sub-prompts
 *   - Datasets / evaluators / prompts sources
 *   - Highlighted substring match in result rows
 *   - Custom `aldo:cmdk:open` event hook (sidebar hint button)
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
  COMMAND_ACTIONS,
  type CommandActionId,
  type CommandGroup as CommandGroupKey,
  type CommandResult,
  STATIC_NAV_RESULTS,
  filterResults,
  highlightMatch,
} from '@/lib/command-palette-filter';
import {
  RECENT_VISIBLE,
  readRecents,
  recentToResult,
  recordRecentUsage,
} from '@/lib/command-palette-recents';
import { searchDocs } from '@/lib/docs/search-client';
import { setThemeAction } from '@/lib/theme-actions';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const GROUP_LABELS: Record<CommandGroupKey, string> = {
  recent: 'Recently used',
  actions: 'Actions',
  nav: 'Pages',
  agents: 'Agents',
  runs: 'Runs',
  datasets: 'Datasets',
  evaluators: 'Evaluators',
  prompts: 'Prompts',
  models: 'Models',
  settings: 'Settings',
  docs: 'Docs',
};

const GROUP_ORDER: ReadonlyArray<CommandGroupKey> = [
  'recent',
  'actions',
  'nav',
  'agents',
  'runs',
  'datasets',
  'evaluators',
  'prompts',
  'models',
  'settings',
  'docs',
];

interface DynamicResults {
  agents: CommandResult[];
  runs: CommandResult[];
  datasets: CommandResult[];
  evaluators: CommandResult[];
  prompts: CommandResult[];
  models: CommandResult[];
}

const EMPTY_DYNAMIC: DynamicResults = {
  agents: [],
  runs: [],
  datasets: [],
  evaluators: [],
  prompts: [],
  models: [],
};

/** Cache TTL for the dynamic-source fetches. */
const DYNAMIC_TTL_MS = 60_000;

/**
 * Sub-prompt mode — when set, the palette filters down to one source
 * and the Enter target accumulates picks until the action fires.
 */
type SubPromptMode =
  | { kind: 'compare-runs'; picks: ReadonlyArray<{ id: string; label: string }> }
  | { kind: 'fork-template' };

export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [dynamic, setDynamic] = useState<DynamicResults>(EMPTY_DYNAMIC);
  const [docsHits, setDocsHits] = useState<CommandResult[]>([]);
  const [recents, setRecents] = useState<CommandResult[]>([]);
  const [subPrompt, setSubPrompt] = useState<SubPromptMode | null>(null);

  // Track the last-fetched timestamp so we can refresh the dynamic
  // sources after the cache window expires. Keyed in a ref to avoid
  // re-running the open-effect every time it ticks.
  const lastFetchRef = useRef<number>(0);

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

  // Programmatic-open hook for the sidebar's ⌘K hint button. Other
  // surfaces can `window.dispatchEvent(new CustomEvent('aldo:cmdk:open'))`
  // and the palette will pop without grabbing the focus by accident.
  useEffect(() => {
    const onOpenEvent = () => setOpen(true);
    window.addEventListener('aldo:cmdk:open', onOpenEvent);
    return () => window.removeEventListener('aldo:cmdk:open', onOpenEvent);
  }, []);

  // Refresh recents from localStorage on every open — cheap and the
  // user's freshest action is always at the top.
  useEffect(() => {
    if (!open) return;
    const items = readRecents()
      .slice(0, RECENT_VISIBLE)
      .map((r) => recentToResult(r));
    setRecents(items);
  }, [open]);

  // Reset sub-prompt + query when the palette closes so it opens
  // clean next time. Selecting an item also clears these directly.
  useEffect(() => {
    if (!open) {
      setSubPrompt(null);
      setQuery('');
    }
  }, [open]);

  // Lazy-load the dynamic sources the first time the palette opens
  // and whenever the 60s cache has expired since the last fetch.
  useEffect(() => {
    if (!open) return;
    const now = Date.now();
    if (now - lastFetchRef.current < DYNAMIC_TTL_MS && lastFetchRef.current > 0) return;
    let cancelled = false;
    void (async () => {
      const next = await loadDynamicSources();
      if (!cancelled) {
        lastFetchRef.current = Date.now();
        setDynamic(next);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  // Docs search: debounce 200ms so we don't hammer Fuse on every
  // keystroke. The index is small and queries are sub-ms once loaded
  // but the brief explicitly asks for a 200ms debounce on cross-source
  // fetches, and consistency wins.
  useEffect(() => {
    if (!open) {
      setDocsHits([]);
      return;
    }
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setDocsHits([]);
      return;
    }
    let cancelled = false;
    const handle = setTimeout(() => {
      void (async () => {
        const hits = await searchDocs(trimmed, 8);
        if (!cancelled) setDocsHits(hits);
      })();
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [open, query]);

  const allResults = useMemo<CommandResult[]>(() => {
    if (subPrompt?.kind === 'compare-runs') {
      // Constrain to the runs source only; the user is picking which
      // runs to diff.
      return dynamic.runs;
    }
    if (subPrompt?.kind === 'fork-template') {
      // The gallery templates aren't a paginated API — for now,
      // navigate to the gallery and the page itself collects the pick.
      // Fall back to the static "Gallery" nav row plus any dynamic
      // matches we already have.
      return [...STATIC_NAV_RESULTS.filter((r) => r.id === 'nav:gallery'), ...dynamic.agents];
    }
    return [
      ...recents,
      ...COMMAND_ACTIONS,
      ...STATIC_NAV_RESULTS,
      ...dynamic.agents,
      ...dynamic.runs,
      ...dynamic.datasets,
      ...dynamic.evaluators,
      ...dynamic.prompts,
      ...dynamic.models,
      ...docsHits,
    ];
  }, [subPrompt, recents, dynamic, docsHits]);

  const ranked = useMemo(() => filterResults(allResults, query), [allResults, query]);

  const grouped = useMemo(() => groupResults(ranked), [ranked]);

  const onSelect = useCallback(
    (result: CommandResult) => {
      // Sub-prompt: compare-runs picks accumulate.
      if (subPrompt?.kind === 'compare-runs' && result.group === 'runs') {
        const runId = result.id.startsWith('run:') ? result.id.slice(4) : result.id;
        const nextPicks = [
          ...subPrompt.picks.filter((p) => p.id !== runId),
          { id: runId, label: result.label },
        ];
        if (nextPicks.length >= 2) {
          // Fire navigation once we have two picks (the page accepts
          // more via `ids=...` but two is the minimum useful diff).
          setOpen(false);
          setSubPrompt(null);
          const params = new URLSearchParams();
          params.set('ids', nextPicks.map((p) => p.id).join(','));
          router.push(`/runs/compare?${params.toString()}`);
          return;
        }
        setSubPrompt({ kind: 'compare-runs', picks: nextPicks });
        setQuery('');
        return;
      }

      // Action dispatcher: theme toggle / sign out / sub-prompt entry.
      if (result.action) {
        const handled = dispatchAction(result.action);
        if (handled === 'sub:compare-runs') {
          setSubPrompt({ kind: 'compare-runs', picks: [] });
          setQuery('');
          return;
        }
        if (handled === 'sub:fork-template') {
          setSubPrompt({ kind: 'fork-template' });
          setQuery('');
          return;
        }
        if (handled === 'closed') {
          setOpen(false);
          setQuery('');
          recordRecentUsage(result);
          return;
        }
        // The action has run and we don't need to navigate; just close.
        setOpen(false);
        setQuery('');
        return;
      }

      // Default: navigate. Persist the pick to recents (the recent
      // helper no-ops on action/recent group entries).
      recordRecentUsage(result);
      setOpen(false);
      setQuery('');
      setSubPrompt(null);
      if (result.href.startsWith('http')) {
        window.location.href = result.href;
        return;
      }
      router.push(result.href);
    },
    [router, subPrompt],
  );

  const inputPlaceholder = useMemo(() => {
    if (subPrompt?.kind === 'compare-runs') {
      const remaining = Math.max(0, 2 - subPrompt.picks.length);
      const picked =
        subPrompt.picks.length > 0
          ? `Picked: ${subPrompt.picks.map((p) => p.label).join(', ')}. `
          : '';
      return `${picked}Pick ${remaining} more run${remaining === 1 ? '' : 's'} to compare…`;
    }
    if (subPrompt?.kind === 'fork-template') {
      return 'Pick a template to fork…';
    }
    return 'Search pages, agents, runs, datasets, evaluators, prompts, models, docs…';
  }, [subPrompt]);

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput
        aria-label="Command palette search"
        placeholder={inputPlaceholder}
        value={query}
        onValueChange={setQuery}
      />
      <CommandList>
        <CommandEmpty>
          {query.length === 0
            ? 'Start typing to search across pages, agents, runs, datasets, and docs.'
            : 'No matches.'}
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
                    <CommandRow item={item} query={query} />
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

/**
 * Single-row renderer. Highlights matched substrings in the label
 * (Linear / Vercel / Braintrust all do this; it's the cheapest visual
 * cue that the palette is paying attention).
 */
function CommandRow({ item, query }: { item: CommandResult; query: string }) {
  const segments = highlightMatch(item.label, query);
  return (
    <>
      <span className="text-sm text-fg">
        {segments.map((seg, i) => (
          // The (text + offset) tuple is unique inside the per-(label,
          // query) segment list, so it works as a stable React key
          // without tripping biome's noArrayIndexKey lint.
          <span
            key={`${i}:${seg.text}`}
            className={seg.match ? 'font-semibold text-accent' : undefined}
          >
            {seg.text}
          </span>
        ))}
      </span>
      {item.description ? (
        <span className="ml-auto truncate text-xs text-fg-muted">{item.description}</span>
      ) : null}
    </>
  );
}

function groupResults(
  results: ReadonlyArray<CommandResult>,
): Record<CommandGroupKey, CommandResult[]> {
  const out: Record<CommandGroupKey, CommandResult[]> = {
    recent: [],
    actions: [],
    nav: [],
    agents: [],
    runs: [],
    datasets: [],
    evaluators: [],
    prompts: [],
    models: [],
    settings: [],
    docs: [],
  };
  for (const r of results) {
    out[r.group].push(r);
  }
  return out;
}

/**
 * Dispatch a side-effecting action. Returns:
 *   - 'sub:compare-runs' / 'sub:fork-template' to ask the caller to
 *     enter sub-prompt mode.
 *   - 'closed' if the action navigates the page itself (e.g. logout).
 *   - 'done' for fire-and-forget actions (theme toggle); the caller
 *     should close the palette.
 */
function dispatchAction(
  action: CommandActionId,
): 'sub:compare-runs' | 'sub:fork-template' | 'closed' | 'done' {
  if (action === 'sub:compare-runs') return 'sub:compare-runs';
  if (action === 'sub:fork-template') return 'sub:fork-template';
  if (action === 'theme:toggle') {
    const root = document.documentElement;
    const dark = root.classList.contains('dark');
    if (dark) {
      root.classList.remove('dark');
      void setThemeAction('light');
    } else {
      root.classList.add('dark');
      void setThemeAction('dark');
    }
    return 'done';
  }
  if (action === 'theme:dark') {
    document.documentElement.classList.add('dark');
    void setThemeAction('dark');
    return 'done';
  }
  if (action === 'theme:light') {
    document.documentElement.classList.remove('dark');
    void setThemeAction('light');
    return 'done';
  }
  if (action === 'auth:signout') {
    window.location.href = '/api/auth/logout';
    return 'closed';
  }
  return 'done';
}

/**
 * Best-effort dynamic-source loader. Hits the auth-proxy (so the
 * HTTP-only session cookie is unwrapped server-side) for each source.
 * Failures are silent — the static nav set remains usable even when
 * the API is down. As of Wave-4 every source listed below is live in
 * the API (prompts shipped alongside this slice); we keep the silent
 * 404 fallback so older deploys still render the palette.
 */
async function loadDynamicSources(): Promise<DynamicResults> {
  const [agents, runs, datasets, evaluators, prompts, models] = await Promise.all([
    fetchOrEmpty('/api/auth-proxy/v1/agents?limit=20'),
    fetchOrEmpty('/api/auth-proxy/v1/runs?limit=50'),
    fetchOrEmpty('/api/auth-proxy/v1/datasets?limit=20'),
    fetchOrEmpty('/api/auth-proxy/v1/evaluators?limit=20'),
    fetchOrEmpty('/api/auth-proxy/v1/prompts?limit=20'),
    fetchOrEmpty('/api/auth-proxy/v1/models'),
  ]);
  return {
    agents: extractAgents(agents),
    runs: extractRuns(runs),
    datasets: extractGeneric(datasets, 'datasets', '/datasets'),
    evaluators: extractGeneric(evaluators, 'evaluators', '/evaluators'),
    prompts: extractGeneric(prompts, 'prompts', '/prompts'),
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

interface MaybeIdentified {
  id?: unknown;
  name?: unknown;
  description?: unknown;
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

/**
 * Generic extractor for sources that share the `{ items: [{ id?,
 * name?, description? }] }` envelope (datasets, evaluators, prompts).
 *
 * `group` is the CommandGroup key + the keyword tag. `basePath` is the
 * route stem (`/datasets` for "/datasets/<id>") — id wins over name
 * for the path because the API canonicalises by id.
 */
function extractGeneric(
  data: unknown,
  group: 'datasets' | 'evaluators' | 'prompts',
  basePath: string,
): CommandResult[] {
  if (!data || typeof data !== 'object') return [];
  const items = (data as { items?: unknown }).items;
  if (!Array.isArray(items)) return [];
  return items
    .map((raw): CommandResult | null => {
      const obj = raw as MaybeIdentified;
      const idOrName =
        typeof obj.id === 'string' ? obj.id : typeof obj.name === 'string' ? obj.name : null;
      if (!idOrName) return null;
      const label = typeof obj.name === 'string' ? obj.name : idOrName;
      const description = typeof obj.description === 'string' ? obj.description : undefined;
      return {
        id: `${group.slice(0, -1)}:${idOrName}`,
        label,
        ...(description !== undefined ? { description } : {}),
        group,
        href: `${basePath}/${encodeURIComponent(idOrName)}`,
        keywords: [group],
      };
    })
    .filter((x): x is CommandResult => x !== null);
}
