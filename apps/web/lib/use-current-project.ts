'use client';

/**
 * Wave-17 (Tier 2.5) — `useCurrentProject()`.
 *
 * Source-of-truth for the currently selected project across the
 * authenticated surface. Used by:
 *   - `<ProjectPicker />` in the sidebar header (read + write)
 *   - `/agents` and `/runs` list pages (read-only via the URL `?project`)
 *
 * Resolution order on read:
 *   1. URL query param `?project=<slug>` — wins so deep links round-trip.
 *   2. `localStorage` key `aldo:current-project` — fallback so the
 *      picker remembers the user's last choice across sessions.
 *   3. `null` — "All projects" (= no filter).
 *
 * `setProject(slug | null)` writes BOTH localStorage AND the URL query
 * (via `router.push` so the back button works) on the current pathname.
 *
 * SSR-safe: the hook returns `null` during the first render on the
 * server. Hydration picks up the localStorage value in a `useEffect`.
 *
 * LLM-agnostic: nothing here references a provider.
 */

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

export const CURRENT_PROJECT_STORAGE_KEY = 'aldo:current-project';
export const CURRENT_PROJECT_QUERY_KEY = 'project';

/** Read the value the URL should win on mount; SSR returns null. */
function readUrlSlug(params: URLSearchParams | ReadonlyURLSearchParams | null): string | null {
  if (!params) return null;
  const v = params.get(CURRENT_PROJECT_QUERY_KEY);
  if (v == null) return null;
  const trimmed = v.trim();
  return trimmed.length === 0 ? null : trimmed;
}

/** Read the localStorage fallback. Safe in SSR (returns null). */
function readLocalSlug(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const v = window.localStorage.getItem(CURRENT_PROJECT_STORAGE_KEY);
    if (v == null) return null;
    const trimmed = v.trim();
    return trimmed.length === 0 ? null : trimmed;
  } catch {
    // localStorage can throw in private mode / disabled storage.
    return null;
  }
}

/** Write or clear the localStorage entry. Swallows storage exceptions. */
function writeLocalSlug(slug: string | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (slug === null) window.localStorage.removeItem(CURRENT_PROJECT_STORAGE_KEY);
    else window.localStorage.setItem(CURRENT_PROJECT_STORAGE_KEY, slug);
  } catch {
    // ignored
  }
}

/**
 * Internal type alias — matches Next.js's `ReadonlyURLSearchParams`
 * without importing the value (it's only re-exported as a type).
 */
type ReadonlyURLSearchParams = Pick<URLSearchParams, 'get' | 'toString'>;

/** Pure resolver, exported for unit tests. URL beats localStorage beats null. */
export function resolveCurrentProject(
  urlSlug: string | null,
  localSlug: string | null,
): string | null {
  if (urlSlug !== null) return urlSlug;
  if (localSlug !== null) return localSlug;
  return null;
}

/**
 * Pure helper, exported for unit tests. Build the next URL pathname +
 * query string after a project change. Removes the param when slug is
 * null; preserves all other params verbatim.
 */
export function buildProjectHref(
  pathname: string,
  currentParams: URLSearchParams | ReadonlyURLSearchParams,
  slug: string | null,
): string {
  const next = new URLSearchParams(currentParams.toString());
  if (slug === null) next.delete(CURRENT_PROJECT_QUERY_KEY);
  else next.set(CURRENT_PROJECT_QUERY_KEY, slug);
  // Drop pagination cursors — a project switch invalidates them.
  next.delete('cursor');
  const qs = next.toString();
  return qs.length === 0 ? pathname : `${pathname}?${qs}`;
}

export interface UseCurrentProjectResult {
  /** The slug currently in effect, or `null` for "All projects". */
  readonly projectSlug: string | null;
  /**
   * Update the active project. Pushes (not replaces) so the back
   * button restores the previous selection. Writes to localStorage
   * regardless so the next mount on a chromeless page still picks
   * the value up.
   */
  setProject(slug: string | null): void;
  /** True after the first client-side hydration tick. */
  readonly hydrated: boolean;
}

export function useCurrentProject(): UseCurrentProjectResult {
  const params = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();

  // SSR + first paint: trust the URL only. The localStorage fallback
  // is read in an effect below so we don't trip a hydration mismatch.
  const urlSlug = readUrlSlug(params);
  const [localSlug, setLocalSlug] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setLocalSlug(readLocalSlug());
    setHydrated(true);
  }, []);

  // If the URL already carries a slug, mirror it to localStorage so
  // a subsequent navigation to a chromeless page (no URL param) still
  // sees the user's intent. Cheap; localStorage writes are sync.
  useEffect(() => {
    if (urlSlug !== null) writeLocalSlug(urlSlug);
  }, [urlSlug]);

  const projectSlug = resolveCurrentProject(urlSlug, localSlug);

  const setProject = useCallback(
    (slug: string | null) => {
      writeLocalSlug(slug);
      setLocalSlug(slug);
      const href = buildProjectHref(pathname ?? '/', params ?? new URLSearchParams(), slug);
      router.push(href);
    },
    [params, pathname, router],
  );

  return { projectSlug, setProject, hydrated };
}
