/**
 * Docs search index — shape of the JSON file written to
 * `apps/web/public/docs-search-index.json` and consumed by the Cmd-K
 * palette client-side.
 *
 * Each row is one page. The body is truncated to 1.2 KB per page so
 * the index stays small enough to load on every palette open without
 * a noticeable hitch. Keeping `headings` in addition to `body` lets
 * fuse.js promote heading hits over body hits.
 *
 * The index is built by `apps/web/scripts/build-docs-search-index.ts`
 * (run as part of `prebuild`) and read at runtime by
 * `lib/docs/search-client.ts`.
 *
 * LLM-agnostic: the index never names a provider — it's just doc text.
 */

export interface DocsSearchEntry {
  /** URL path, e.g. `/docs/concepts/privacy-tier`. */
  readonly path: string;
  /** Sidebar title. */
  readonly title: string;
  /** One-line summary. */
  readonly summary: string;
  /** All h2/h3 headings, lowercased. */
  readonly headings: ReadonlyArray<string>;
  /** Truncated body text, lowercased. */
  readonly body: string;
}

export const SEARCH_INDEX_PATH = '/docs-search-index.json';

/** Cap each entry's body to keep the index small. */
export const SEARCH_BODY_MAX_CHARS = 1200;
