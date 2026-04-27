/**
 * Docs loader — reads markdown sources from `apps/web/content/docs`,
 * parses frontmatter, renders markdown to HTML server-side, and
 * extracts an in-page table of contents from the heading structure.
 *
 * Server-only: imports `node:fs` and `node:path`. Calling it from a
 * client component would explode at build time — Next.js will mark
 * the module as a server boundary because of the `fs` import.
 *
 * Why server-side: docs are static and SEO-relevant. Rendering at
 * request time (cached by Next's data layer) means crawlers see the
 * same HTML the user does, and we ship zero markdown parser to the
 * browser. The bundle is shiki + marked + gray-matter — all server.
 *
 * Code highlighting: shiki with `aurora-x` theme; lazy-loaded once per
 * process to keep cold-start cheap.
 *
 * LLM-agnostic: nothing in the loader names a provider.
 */

import fs from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';
import DOMPurify from 'isomorphic-dompurify';
import { Marked } from 'marked';
import { type BundledLanguage, type Highlighter, createHighlighter } from 'shiki';

import {
  type DocPage,
  type GeneratedApiPage,
  STATIC_DOC_PAGES,
  pageSourcePath,
} from './registry.js';

const CONTENT_ROOT = path.resolve(process.cwd(), 'content/docs');

/** Languages we ship in the highlight bundle — keep this small. */
const HIGHLIGHT_LANGS: ReadonlyArray<BundledLanguage> = [
  'typescript',
  'javascript',
  'tsx',
  'python',
  'bash',
  'json',
  'yaml',
  'markdown',
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

export interface DocHeading {
  readonly id: string;
  readonly text: string;
  /** Level: 2 for h2, 3 for h3 (we don't index h1 — that's the title). */
  readonly level: 2 | 3;
}

export interface LoadedDoc {
  readonly page: DocPage;
  readonly title: string;
  readonly summary: string;
  readonly html: string;
  /** Plain-text body used to build the search index. */
  readonly bodyText: string;
  readonly headings: ReadonlyArray<DocHeading>;
  /** Source-relative path used for "Edit on GitHub" links. */
  readonly sourcePath: string;
}

/** Slugify a heading the same way GitHub does (lowercase, dashes). */
export function slugifyHeading(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

/**
 * Load + render one doc page. Returns `null` if the source file is
 * missing — the page route should 404 in that case.
 */
export async function loadDoc(page: DocPage): Promise<LoadedDoc | null> {
  const rel = pageSourcePath(page);
  const abs = path.join(CONTENT_ROOT, rel);
  if (!fs.existsSync(abs)) return null;
  const raw = fs.readFileSync(abs, 'utf8');
  const { data, content } = matter(raw);

  const headings: DocHeading[] = [];
  const bodyTextChunks: string[] = [];

  const marked = new Marked({ gfm: true, breaks: false });

  // Heading extraction + anchor injection. Using a renderer override
  // lets us emit a stable `id=` AND record the heading for the right-
  // rail TOC in a single pass.
  marked.use({
    renderer: {
      heading({ tokens, depth }) {
        const text = tokens.map((t) => ('text' in t ? (t as { text: string }).text : '')).join('');
        const id = slugifyHeading(text);
        if (depth === 2 || depth === 3) {
          headings.push({ id, text, level: depth });
        }
        return `<h${depth} id="${id}" class="docs-heading docs-heading--h${depth}"><a href="#${id}" class="docs-heading-anchor" aria-hidden="true">#</a>${escapeHtml(text)}</h${depth}>\n`;
      },
      paragraph({ tokens }) {
        const inner = tokens.map((t) => ('text' in t ? (t as { text: string }).text : '')).join('');
        bodyTextChunks.push(inner);
        // Fall through to default rendering by re-parsing inline.
        const html = (this as { parser: { parseInline: (toks: unknown[]) => string } }).parser
          ? (this as { parser: { parseInline: (toks: unknown[]) => string } }).parser.parseInline(
              tokens,
            )
          : escapeHtml(inner);
        return `<p>${html}</p>\n`;
      },
    },
    async: true,
    async walkTokens(token) {
      if (token.type === 'code') {
        const codeToken = token as { lang?: string; text: string; rendered?: string };
        const lang = (codeToken.lang ?? '').trim().split(' ')[0] ?? '';
        const useLang = (HIGHLIGHT_LANGS as ReadonlyArray<string>).includes(lang)
          ? (lang as BundledLanguage)
          : 'bash';
        const hl = await getHighlighter();
        codeToken.rendered = hl.codeToHtml(codeToken.text, {
          lang: useLang,
          theme: 'aurora-x',
        });
      }
    },
  });
  marked.use({
    renderer: {
      code(args) {
        const rendered = (args as { rendered?: string }).rendered;
        if (typeof rendered === 'string') return rendered;
        const codeToken = args as { text: string };
        return `<pre><code>${escapeHtml(codeToken.text)}</code></pre>\n`;
      },
    },
  });

  const rawHtml = await marked.parse(content);
  const resolvedHtml = typeof rawHtml === 'string' ? rawHtml : await rawHtml;
  // Belt-and-braces: docs sources are checked-in markdown so the
  // payload is trusted, but DOMPurify costs <1ms and silences
  // CodeQL's stored-XSS warning on dangerouslySetInnerHTML.
  const html = DOMPurify.sanitize(resolvedHtml, { USE_PROFILES: { html: true } });

  const titleFromFrontmatter = typeof data.title === 'string' ? data.title : page.title;
  const summaryFromFrontmatter = typeof data.summary === 'string' ? data.summary : page.summary;

  const bodyText = bodyTextChunks.join(' ').replace(/\s+/g, ' ').trim();

  return {
    page,
    title: titleFromFrontmatter,
    summary: summaryFromFrontmatter,
    html,
    bodyText,
    headings,
    sourcePath: `apps/web/content/docs/${rel}`,
  };
}

/**
 * Discover generated API-reference pages on disk. The generator
 * writes one JSON file per endpoint into `api/_generated/`; this
 * function lists them and synthesizes a `DocPage` per endpoint.
 */
export function listGeneratedApiPages(): ReadonlyArray<GeneratedApiPage> {
  const dir = path.join(CONTENT_ROOT, 'api', '_generated');
  if (!fs.existsSync(dir)) return [];
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
  const pages: GeneratedApiPage[] = [];
  for (const file of files) {
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')) as {
        slug?: string;
        title?: string;
        summary?: string;
      };
      if (!raw.slug || !raw.title) continue;
      pages.push({
        slug: `api/${raw.slug}`,
        section: 'api',
        title: raw.title,
        summary: raw.summary ?? '',
        generated: true,
        source: `api/_generated/${file}`,
      });
    } catch {
      // Skip malformed JSON; the generator owns format guarantees.
    }
  }
  // Stable order: by HTTP-verb + path (already encoded in the slug).
  pages.sort((a, b) => a.slug.localeCompare(b.slug));
  return pages;
}

/**
 * The full nav. Static pages first, then auto-generated API pages
 * appended to the `api` section.
 */
export function listAllDocPages(): ReadonlyArray<DocPage> {
  const generated = listGeneratedApiPages();
  // Insert an `/api` landing page if it isn't already in the static set.
  const hasApiLanding = STATIC_DOC_PAGES.some((p) => p.slug === 'api');
  const apiLanding: DocPage[] = hasApiLanding
    ? []
    : [
        {
          slug: 'api',
          section: 'api',
          title: 'API reference',
          summary:
            'Auto-generated reference for every endpoint that has a Zod schema in @aldo-ai/api-contract.',
          source: 'api/index.md',
        },
      ];
  return [...STATIC_DOC_PAGES, ...apiLanding, ...generated];
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
