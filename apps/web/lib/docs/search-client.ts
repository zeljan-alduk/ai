/**
 * Client-side docs search — fuse.js, lazily loaded, against the
 * pre-built `/docs-search-index.json`.
 *
 * Fuse instantiation is cached at module level: the first query pays
 * the parse + indexing cost (~5-10ms for ~25 entries), every
 * subsequent query is sub-millisecond. The index file itself is
 * fetched once and cached in a module-level promise so multiple Cmd-K
 * opens don't re-fetch.
 *
 * Returns up to N results, lightly normalised for the palette row
 * shape (label/description/href via the CommandResult type).
 *
 * LLM-agnostic: search is over public doc strings; nothing here
 * branches on a provider name.
 */

import Fuse, { type IFuseOptions } from 'fuse.js';

import type { CommandResult } from '@/lib/command-palette-filter';
import { type DocsSearchEntry, SEARCH_INDEX_PATH } from './search-index.js';

const FUSE_OPTIONS: IFuseOptions<DocsSearchEntry> = {
  includeScore: true,
  ignoreLocation: true,
  threshold: 0.4,
  keys: [
    { name: 'title', weight: 5 },
    { name: 'headings', weight: 3 },
    { name: 'summary', weight: 2 },
    { name: 'body', weight: 1 },
  ],
};

let fusePromise: Promise<Fuse<DocsSearchEntry>> | null = null;

async function loadFuse(): Promise<Fuse<DocsSearchEntry>> {
  if (fusePromise === null) {
    fusePromise = (async () => {
      const res = await fetch(SEARCH_INDEX_PATH, { cache: 'force-cache' });
      if (!res.ok) {
        // Fall through to an empty index — search just returns 0 hits
        // rather than crashing the palette.
        return new Fuse<DocsSearchEntry>([], FUSE_OPTIONS);
      }
      const entries = (await res.json()) as DocsSearchEntry[];
      return new Fuse(entries, FUSE_OPTIONS);
    })();
  }
  return fusePromise;
}

/**
 * Search the docs index. Returns at most `limit` rows in the same
 * `CommandResult` shape the rest of the palette uses, so the docs
 * group renders identically to nav/agents/runs.
 */
export async function searchDocs(query: string, limit = 8): Promise<CommandResult[]> {
  const trimmed = query.trim();
  if (trimmed.length === 0) return [];
  const fuse = await loadFuse();
  const results = fuse.search(trimmed, { limit });
  return results.map(({ item }) => ({
    id: `docs:${item.path}`,
    label: item.title,
    description: item.summary,
    group: 'docs',
    href: item.path,
    keywords: item.headings.slice(0, 8),
  }));
}
