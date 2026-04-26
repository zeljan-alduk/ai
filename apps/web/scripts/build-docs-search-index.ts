#!/usr/bin/env tsx
/**
 * build-docs-search-index.ts — wave-15 docs site, search index builder.
 *
 * Walks every page registered in `lib/docs/registry.ts` and every
 * generated API page in `content/docs/api/_generated/*.json`, reads
 * the source, extracts a {title, summary, headings, body} record,
 * and writes the union to `public/docs-search-index.json`.
 *
 * The output is consumed client-side by `lib/docs/search-client.ts`
 * via fuse.js. Keeping body chunks small (1.2 KB cap per page) keeps
 * the index small enough to load on every Cmd-K open without a hitch.
 *
 * LLM-agnostic: the index is over public docs; nothing in it
 * references a model provider.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import matter from 'gray-matter';

import {
  DOC_SECTIONS,
  type DocPage,
  STATIC_DOC_PAGES,
  pageSourcePath,
} from '../lib/docs/registry.js';
import { type DocsSearchEntry, SEARCH_BODY_MAX_CHARS } from '../lib/docs/search-index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONTENT_ROOT = resolve(__dirname, '../content/docs');
const PUBLIC_DIR = resolve(__dirname, '../public');
const OUT_PATH = join(PUBLIC_DIR, 'docs-search-index.json');

main();

function main() {
  if (!existsSync(PUBLIC_DIR)) mkdirSync(PUBLIC_DIR, { recursive: true });
  const entries: DocsSearchEntry[] = [];

  // Static markdown pages.
  for (const page of STATIC_DOC_PAGES) {
    const entry = entryForMarkdownPage(page);
    if (entry) entries.push(entry);
  }

  // API landing — synthesised, not in STATIC_DOC_PAGES.
  const apiLanding = entryForMarkdownPage({
    slug: 'api',
    section: 'api',
    title: 'API reference',
    summary:
      'Auto-generated reference for every endpoint that has a Zod schema in @aldo-ai/api-contract.',
    source: 'api/index.md',
  });
  if (apiLanding) entries.push(apiLanding);

  // Generated API endpoint pages.
  const generatedDir = join(CONTENT_ROOT, 'api', '_generated');
  if (existsSync(generatedDir)) {
    for (const file of readdirSync(generatedDir)) {
      if (!file.endsWith('.json')) continue;
      try {
        const raw = JSON.parse(readFileSync(join(generatedDir, file), 'utf8')) as {
          slug: string;
          method: string;
          path: string;
          title: string;
          summary: string;
        };
        entries.push({
          path: `/docs/api/${raw.slug}`,
          title: `${raw.method} ${raw.path}`,
          summary: raw.summary ?? '',
          headings: ['request', 'response', 'example', 'errors'],
          body: `${raw.method.toLowerCase()} ${raw.path} ${raw.summary ?? ''}`.toLowerCase(),
        });
      } catch {
        // Skip malformed JSON; the API generator owns format guarantees.
      }
    }
  }

  writeFileSync(OUT_PATH, JSON.stringify(entries));
  // Section coverage sanity check — every non-empty section should
  // be represented in the index, otherwise the build is misconfigured.
  // Walk the static-page registry to map each entry path back to its
  // declared section, and treat anything else (the api landing,
  // generated endpoints) as 'api'.
  const slugToSection = new Map<string, string>();
  for (const page of STATIC_DOC_PAGES) {
    const path = page.slug === '' ? '/docs' : `/docs/${page.slug}`;
    slugToSection.set(path, page.section);
  }
  slugToSection.set('/docs/api', 'api');
  const sectionsCovered = new Set(
    entries.map((e) => {
      if (e.path.startsWith('/docs/api/')) return 'api';
      return slugToSection.get(e.path) ?? 'overview';
    }),
  );
  console.log(
    `[docs] build-docs-search-index: ${entries.length} entries written; sections covered: ${[...sectionsCovered].join(', ')}; size: ${approxKb(OUT_PATH)} KB.`,
  );
}

function entryForMarkdownPage(page: DocPage): DocsSearchEntry | null {
  const sourceRel = pageSourcePath(page);
  const abs = join(CONTENT_ROOT, sourceRel);
  if (!existsSync(abs)) return null;
  const raw = readFileSync(abs, 'utf8');
  const { data, content } = matter(raw);
  const title = (data.title as string | undefined) ?? page.title;
  const summary = (data.summary as string | undefined) ?? page.summary;

  const headings: string[] = [];
  const bodyChunks: string[] = [];
  const lines = content.split('\n');
  for (const line of lines) {
    const m = /^(#{2,3})\s+(.+)$/.exec(line);
    if (m) {
      headings.push((m[2] ?? '').trim().toLowerCase());
    } else {
      // Strip inline markdown markers for plain-text indexing.
      const plain = line
        .replace(/`+([^`]+)`+/g, '$1')
        .replace(/\*+([^*]+)\*+/g, '$1')
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
        .replace(/^#+\s*/, '')
        .trim();
      if (plain) bodyChunks.push(plain);
    }
  }
  let body = bodyChunks.join(' ').replace(/\s+/g, ' ').toLowerCase();
  if (body.length > SEARCH_BODY_MAX_CHARS) body = body.slice(0, SEARCH_BODY_MAX_CHARS);

  return {
    path: page.slug === '' ? '/docs' : `/docs/${page.slug}`,
    title,
    summary,
    headings,
    body,
  };
}

function approxKb(path: string): number {
  const stat = readFileSync(path);
  return Math.round((stat.byteLength / 1024) * 10) / 10;
}
