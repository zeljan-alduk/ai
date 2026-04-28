/**
 * `/api/docs` — modern OpenAPI viewer powered by Scalar.
 *
 * Strategy
 * --------
 * Replaces the previous Swagger UI rendering with Scalar
 * (https://github.com/scalar/scalar — MIT). What we get for free:
 *   - three-column layout (sidebar + content + try-it-out) instead of
 *     Swagger UI's flat scroll,
 *   - dark mode out of the box; we wire our `--bg` / `--fg` /
 *     `--accent` tokens through Scalar's CSS variable hooks so the
 *     viewer flips with `html.dark` like the rest of the site,
 *   - searchable endpoint list,
 *   - built-in API client that emits curl + JS + Python snippets.
 *
 * The standalone bundle reads `data-url` on a tag with id
 * `api-reference` and renders into the same DOM. Configuration is
 * passed inline as a JSON string on `data-configuration`.
 *
 * Privacy / auth
 * --------------
 * The OpenAPI spec is public (`/openapi.json` bypasses auth in
 * apps/api). The page is in the chromeless allow-list (no app
 * sidebar) and outside the auth-required surface — see
 * `lib/middleware-shared.ts`.
 *
 * LLM-agnostic
 * ------------
 * The spec carries `x-aldo-llm-agnostic: true`; this page just
 * renders whatever the spec contains. No provider names live here.
 */

import type { Metadata } from 'next';

// Pin to a specific Scalar version so a CDN regression cannot break
// the docs page silently. Bump in a separate commit once a new
// release looks stable.
const SCALAR_VERSION = '1.25.30';
const SCALAR_BUNDLE = `https://cdn.jsdelivr.net/npm/@scalar/api-reference@${SCALAR_VERSION}/dist/browser/standalone.min.js`;

export const metadata: Metadata = {
  title: 'ALDO AI API — Reference',
  description:
    'Interactive OpenAPI reference for the ALDO AI Control Plane API. Searchable endpoints, try-it-out, and code samples in curl, JavaScript, and Python.',
};

/** API base URL the OpenAPI spec is fetched from. */
function specUrl(): string {
  const base = process.env.NEXT_PUBLIC_API_BASE ?? 'http://localhost:3001';
  return `${base.replace(/\/$/, '')}/openapi.json`;
}

/**
 * Scalar configuration. Passed as a JSON-encoded string on the
 * `<script>` tag's `data-configuration` attribute. Theme tokens are
 * piped through `customCss` so Scalar inherits our html.dark flip
 * without a separate override sheet.
 */
function scalarConfig(): string {
  return JSON.stringify({
    theme: 'default',
    layout: 'modern',
    showSidebar: true,
    hideDownloadButton: false,
    metaData: {
      title: 'ALDO AI API Reference',
      description:
        'Control plane for agent teams — capability-class routing, replayable runs, eval-gated promotion.',
    },
    // Map Scalar's CSS variables onto our design-token system so the
    // viewer flips with html.dark like the rest of the marketing site.
    customCss: `
      :root {
        --scalar-color-1: rgb(var(--fg));
        --scalar-color-2: rgb(var(--fg-muted));
        --scalar-color-3: rgb(var(--fg-faint));
        --scalar-color-accent: rgb(var(--accent));
        --scalar-background-1: rgb(var(--bg));
        --scalar-background-2: rgb(var(--bg-elevated));
        --scalar-background-3: rgb(var(--bg-subtle));
        --scalar-background-accent: rgb(var(--accent));
        --scalar-border-color: rgb(var(--border));
      }
    `,
  });
}

export default function ApiDocsPage() {
  const url = specUrl();
  const config = scalarConfig();
  return (
    <div className="min-h-screen bg-bg text-fg">
      <header className="border-b border-border px-6 py-3">
        <div className="mx-auto flex max-w-7xl items-baseline justify-between gap-4">
          <div>
            <h1 className="text-lg font-semibold">ALDO AI API</h1>
            <p className="text-xs text-fg-muted">
              Interactive reference. Spec:{' '}
              <a className="underline hover:text-fg" href={url}>
                <code className="font-mono text-[11px]">{url}</code>
              </a>
            </p>
          </div>
          <nav className="flex items-center gap-3 text-xs">
            <a className="text-fg-muted hover:text-fg" href="/api/redoc">
              Redoc
            </a>
            <span className="text-fg-faint">·</span>
            <a className="text-fg-muted hover:text-fg" href={url}>
              Raw spec
            </a>
            <span className="text-fg-faint">·</span>
            <a className="text-fg-muted hover:text-fg" href="/docs">
              Guides
            </a>
          </nav>
        </div>
      </header>

      {/*
        Scalar API Reference standalone bundle. The script tag with
        id="api-reference" is the host element; the bundle reads
        `data-url` and `data-configuration`, then renders into the
        page. dangerouslySetInnerHTML with an empty body forces React
        to emit a self-closing-equivalent <script> with no children
        (Scalar requires the tag to exist before the bundle loads).
      */}
      <script
        id="api-reference"
        data-url={url}
        data-configuration={config}
        // biome-ignore lint/security/noDangerouslySetInnerHtml: standalone bundle requires this tag in DOM with no body
        dangerouslySetInnerHTML={{ __html: '' }}
      />
      <script src={SCALAR_BUNDLE} defer />

      <noscript>
        <div className="p-8 text-center">
          <p className="text-fg">
            The interactive reference requires JavaScript. Browse the raw spec at{' '}
            <a className="underline" href={url}>
              {url}
            </a>
            , or read the static reference at{' '}
            <a className="underline" href="/api/redoc">
              /api/redoc
            </a>
            .
          </p>
        </div>
      </noscript>
    </div>
  );
}
