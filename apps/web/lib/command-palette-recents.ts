/**
 * Recently-used items for the Cmd-K palette.
 *
 * Persisted to localStorage under `aldo:cmdk:recent`. We cap each item
 * type at 10 entries so a power user who has touched 200 agents in a
 * day doesn't blow past the localStorage quota.
 *
 * Pure helpers (read/write/push) so the unit tests can exercise the
 * cap + dedup logic without booting jsdom.
 *
 * SSR-safe: every public function checks `typeof window` so the
 * palette can call them during render without crashing during the
 * server-side pass.
 */

import type { CommandResult } from './command-palette-filter';

export const RECENT_STORAGE_KEY = 'aldo:cmdk:recent';
export const RECENT_CAP_PER_TYPE = 10;
export const RECENT_VISIBLE = 5;

/**
 * Item types tracked separately. The cap applies per type so a busy
 * "runs" history doesn't push agents off the list.
 */
export type RecentType =
  | 'agents'
  | 'runs'
  | 'datasets'
  | 'evaluators'
  | 'prompts'
  | 'models'
  | 'nav';

export interface RecentItem {
  readonly id: string;
  readonly type: RecentType;
  readonly label: string;
  readonly href: string;
  readonly description?: string;
  /** Unix ms — used to order by recency. */
  readonly touchedAt: number;
}

interface RecentBag {
  readonly version: 1;
  readonly items: ReadonlyArray<RecentItem>;
}

const EMPTY_BAG: RecentBag = { version: 1, items: [] };

function safeParse(raw: string | null): RecentBag {
  if (!raw) return EMPTY_BAG;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (
      parsed &&
      typeof parsed === 'object' &&
      (parsed as RecentBag).version === 1 &&
      Array.isArray((parsed as RecentBag).items)
    ) {
      const items = (parsed as RecentBag).items.filter(isValidRecent);
      return { version: 1, items };
    }
  } catch {
    /* fall through */
  }
  return EMPTY_BAG;
}

function isValidRecent(x: unknown): x is RecentItem {
  if (!x || typeof x !== 'object') return false;
  const r = x as RecentItem;
  return (
    typeof r.id === 'string' &&
    typeof r.type === 'string' &&
    typeof r.label === 'string' &&
    typeof r.href === 'string' &&
    typeof r.touchedAt === 'number'
  );
}

/**
 * Pure: enforce the per-type cap on a list. Newest first; older
 * entries beyond `RECENT_CAP_PER_TYPE` for any one type get dropped.
 */
export function applyCap(items: ReadonlyArray<RecentItem>): RecentItem[] {
  const byType = new Map<RecentType, RecentItem[]>();
  // Sort newest-first so per-type slicing keeps the freshest entries.
  const sorted = [...items].sort((a, b) => b.touchedAt - a.touchedAt);
  for (const it of sorted) {
    const arr = byType.get(it.type) ?? [];
    if (arr.length < RECENT_CAP_PER_TYPE) {
      arr.push(it);
      byType.set(it.type, arr);
    }
  }
  // Re-flatten in the same newest-first order.
  return Array.from(byType.values())
    .flat()
    .sort((a, b) => b.touchedAt - a.touchedAt);
}

/**
 * Pure: push a new touch on top of an existing bag, deduping by id.
 */
export function pushRecent(bag: RecentBag, item: RecentItem): RecentBag {
  const filtered = bag.items.filter((x) => x.id !== item.id);
  return { version: 1, items: applyCap([item, ...filtered]) };
}

export function readRecents(): RecentItem[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(RECENT_STORAGE_KEY);
    return [...safeParse(raw).items];
  } catch {
    return [];
  }
}

export function recordRecentUsage(result: CommandResult): void {
  if (typeof window === 'undefined') return;
  const type = recentTypeForResult(result);
  if (!type) return;
  try {
    const raw = window.localStorage.getItem(RECENT_STORAGE_KEY);
    const next = pushRecent(safeParse(raw), {
      id: result.id,
      type,
      label: result.label,
      href: result.href,
      ...(result.description !== undefined ? { description: result.description } : {}),
      touchedAt: Date.now(),
    });
    window.localStorage.setItem(RECENT_STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* localStorage may be disabled (private mode); silently skip. */
  }
}

/**
 * Map a CommandResult → a `RecentType`, or `null` if the result is
 * not recordable (e.g. action-group entries; we want fresh prompts
 * from the user, not "you ran Sign out twice yesterday").
 */
export function recentTypeForResult(result: CommandResult): RecentType | null {
  switch (result.group) {
    case 'agents':
      return 'agents';
    case 'runs':
      return 'runs';
    case 'datasets':
      return 'datasets';
    case 'evaluators':
      return 'evaluators';
    case 'prompts':
      return 'prompts';
    case 'models':
      return 'models';
    case 'nav':
      return 'nav';
    default:
      return null;
  }
}

/**
 * Adapt a RecentItem back into a CommandResult so the palette can
 * render it inside its standard row component without a special case.
 */
export function recentToResult(item: RecentItem): CommandResult {
  return {
    id: `recent:${item.id}`,
    label: item.label,
    ...(item.description !== undefined ? { description: item.description } : {}),
    group: 'recent',
    href: item.href,
    keywords: [item.type, 'recent'],
  };
}
