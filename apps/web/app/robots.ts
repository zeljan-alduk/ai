/**
 * robots.txt — crawler policy.
 *
 * Allow:
 *   - the marketing surface (`/`, `/pricing`, `/security`, …)
 *   - the docs surface (`/docs/...`)
 *
 * Disallow everything authenticated. The middleware redirects
 * unauthenticated requests to `/login`, but explicitly disallowing
 * keeps well-behaved crawlers out of the protected app entirely
 * and avoids surfacing redirects in search results.
 *
 * LLM-agnostic.
 */

import type { MetadataRoute } from 'next';

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://app.aldo-ai.dev';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: ['/', '/docs', '/pricing', '/about', '/security', '/design-partner'],
        disallow: [
          '/api/',
          '/runs',
          '/agents',
          '/eval',
          '/dashboards',
          '/settings',
          '/billing',
          '/secrets',
          '/playground',
          '/notifications',
          '/observability',
          '/admin',
          '/welcome',
          '/invite',
        ],
      },
    ],
    sitemap: `${SITE}/sitemap.xml`,
  };
}
