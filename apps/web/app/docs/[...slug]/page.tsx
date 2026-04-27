/**
 * Catch-all dynamic route — `/docs/<anything>`.
 *
 * Matches every doc page registered in `STATIC_DOC_PAGES` plus every
 * generated API page in `content/docs/api/_generated/*.json`. The
 * page route resolves the slug, loads the markdown, renders it, and
 * mounts the per-page chrome (title, body, TOC, edit-on-GitHub,
 * feedback).
 *
 * Generated API pages take a different rendering path (they're JSON,
 * not markdown) — see `ApiEndpointPage`. The branching here is the
 * only place the docs site needs to know about generated content;
 * the rest of the surface treats it uniformly via the registry.
 *
 * `generateStaticParams` enumerates every doc URL so the docs site
 * is fully prerendered at build time. This makes the docs CDN-
 * cacheable and immune to API outages — the platform docs surface
 * remains up even when the control plane is down.
 *
 * LLM-agnostic: the doc content itself is the source of truth; this
 * file just routes.
 */

import { ApiEndpointPage } from '@/components/docs/api-endpoint';
import { DocsFeedback } from '@/components/docs/feedback';
import { DocsToc } from '@/components/docs/toc';
import { listAllDocPages, listGeneratedApiPages, loadDoc } from '@/lib/docs/loader';
import { type DocPage, type GeneratedApiPage, STATIC_DOC_PAGES } from '@/lib/docs/registry';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

interface DocsPageProps {
  readonly params: Promise<{ slug: string[] }>;
}

export function generateStaticParams(): Array<{ slug: string[] }> {
  return listAllDocPages()
    .filter((p) => p.slug !== '')
    .map((p) => ({ slug: p.slug.split('/') }));
}

export async function generateMetadata({ params }: DocsPageProps): Promise<Metadata> {
  const { slug } = await params;
  const slugStr = slug.join('/');
  const page = findPage(slugStr);
  if (!page) return {};
  return {
    title: `${page.title} · ALDO AI Docs`,
    description: page.summary,
    openGraph: {
      title: page.title,
      description: page.summary,
      type: 'article',
      url: `/docs/${slugStr}`,
      images: [
        {
          url: `/docs/og?title=${encodeURIComponent(page.title)}`,
          alt: page.title,
        },
      ],
    },
  };
}

export default async function DocsCatchAll({ params }: DocsPageProps) {
  const { slug } = await params;
  const slugStr = slug.join('/');
  const page = findPage(slugStr);
  if (!page) notFound();

  // Auto-generated API endpoint page — render from the JSON spec.
  if (page.generated && page.section === 'api') {
    return <ApiEndpointPage page={page as GeneratedApiPage} />;
  }

  const loaded = await loadDoc(page);
  if (!loaded) notFound();

  return (
    <div className="mx-auto flex w-full max-w-6xl gap-10">
      <article className="docs-prose min-w-0 flex-1">
        <header className="mb-6 border-b border-border pb-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-accent">
            {sectionLabel(page.section)}
          </p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight text-fg">{loaded.title}</h1>
          {loaded.summary ? <p className="mt-2 text-base text-fg-muted">{loaded.summary}</p> : null}
        </header>
        <div
          className="docs-content"
          // biome-ignore lint/security/noDangerouslySetInnerHtml: server-rendered markdown from a checked-in source file, code blocks pre-highlighted by shiki
          dangerouslySetInnerHTML={{ __html: loaded.html }}
        />
        <footer className="mt-10 flex flex-wrap items-center justify-between gap-4 border-t border-border pt-4">
          {/* "Edit on GitHub" link removed — repository is private. */}
          <span className="text-xs text-fg-muted">Source: {loaded.sourcePath}</span>
          <DocsFeedback path={`/docs/${slugStr}`} />
        </footer>
      </article>
      <aside className="hidden w-56 shrink-0 xl:block">
        <div className="sticky top-20">
          <DocsToc headings={loaded.headings} />
        </div>
      </aside>
    </div>
  );
}

function findPage(slug: string): DocPage | null {
  // Static first.
  const fromStatic = STATIC_DOC_PAGES.find((p) => p.slug === slug);
  if (fromStatic) return fromStatic;
  // Then generated.
  const fromGenerated = listGeneratedApiPages().find((p) => p.slug === slug);
  if (fromGenerated) return fromGenerated;
  // Then API landing (synthesised).
  if (slug === 'api') {
    return {
      slug: 'api',
      section: 'api',
      title: 'API reference',
      summary:
        'Auto-generated reference for every endpoint that has a Zod schema in @aldo-ai/api-contract.',
      source: 'api/index.md',
    };
  }
  return null;
}

function sectionLabel(section: DocPage['section']): string {
  switch (section) {
    case 'overview':
      return 'Overview';
    case 'concepts':
      return 'Concept';
    case 'guides':
      return 'Guide';
    case 'api':
      return 'API reference';
    case 'sdks':
      return 'SDK';
    case 'reference':
      return 'Reference';
    default:
      return 'Docs';
  }
}
