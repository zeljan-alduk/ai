/**
 * Server-only shiki wrapper.
 *
 * Used by the API-endpoint renderer to highlight curl / Python / TS
 * snippets at request time (which Next caches across builds). The
 * highlighter instance is reused across calls — see `loader.ts` for
 * the same lazy-init pattern.
 *
 * This module imports `shiki` at the top level on purpose: it's
 * cheap to keep around (the WASM payload is fetched once) and the
 * compile-time DCE keeps it out of any client bundles because no
 * client component imports it.
 *
 * LLM-agnostic: highlighting is purely a presentation concern.
 */

import { type BundledLanguage, type Highlighter, createHighlighter } from 'shiki';

const HIGHLIGHT_LANGS: ReadonlyArray<BundledLanguage> = [
  'typescript',
  'javascript',
  'tsx',
  'python',
  'bash',
  'json',
  'yaml',
];

let highlighterPromise: Promise<Highlighter> | null = null;

function getHighlighter(): Promise<Highlighter> {
  if (highlighterPromise === null) {
    highlighterPromise = createHighlighter({
      themes: ['aurora-x'],
      langs: HIGHLIGHT_LANGS as BundledLanguage[],
    });
  }
  return highlighterPromise;
}

export async function renderCodeServer(code: string, lang: string): Promise<string> {
  const useLang = (HIGHLIGHT_LANGS as ReadonlyArray<string>).includes(lang)
    ? (lang as BundledLanguage)
    : 'bash';
  const hl = await getHighlighter();
  return hl.codeToHtml(code, { lang: useLang, theme: 'aurora-x' });
}
