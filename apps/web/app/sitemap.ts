/**
 * sitemap.xml — enumerates every doc URL plus the marketing surface.
 *
 * Generated server-side at request time and cached. Picking up a
 * new doc page is automatic: anything in `STATIC_DOC_PAGES` plus
 * every generated API endpoint shows up.
 *
 * Auth-protected app routes are intentionally excluded — no point
 * listing `/runs` or `/agents` for a crawler that can't reach them.
 *
 * LLM-agnostic: nothing in the sitemap names a provider.
 */

import type { MetadataRoute } from 'next';

import { listAllDocPages } from '@/lib/docs/loader';

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://app.aldo-ai.dev';

export default function sitemap(): MetadataRoute.Sitemap {
  const docs = listAllDocPages().map((page) => ({
    url: `${SITE}/docs${page.slug === '' ? '' : `/${page.slug}`}`,
    lastModified: new Date(),
    changeFrequency: 'weekly' as const,
    priority: page.slug === '' ? 0.9 : 0.7,
  }));
  const marketing = ['/', '/pricing', '/about', '/security', '/design-partner'].map((path) => ({
    url: `${SITE}${path}`,
    lastModified: new Date(),
    changeFrequency: 'weekly' as const,
    priority: path === '/' ? 1 : 0.8,
  }));
  return [...marketing, ...docs];
}
