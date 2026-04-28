/**
 * `/api/docs` — Scalar OpenAPI viewer served as a route handler that
 * returns raw HTML. This is intentionally NOT a Next.js React page.
 *
 * Why a route handler, not `page.tsx`:
 *   - Scalar's standalone bundle (`@scalar/api-reference`) reads
 *     `data-url` + `data-configuration` from a `<script id="api-reference">`
 *     tag and runs after `DOMContentLoaded`. With Next.js React hydration,
 *     the host script tag is materialised mid-hydration and Scalar's bundle
 *     either fires before the tag is in the DOM or sees attributes that
 *     React then re-renders, leaving the page blank.
 *   - Returning a static HTML document sidesteps the entire React tree.
 *     The bundle runs against a normal document, exactly as it does in
 *     Scalar's own examples.
 *
 * Privacy / auth: the OpenAPI spec at /openapi.json is public; this page
 * is in `lib/middleware-shared.ts` PUBLIC_BOUNDED so unauthenticated
 * visitors can browse it.
 *
 * LLM-agnostic: spec content is opaque; this handler renders it verbatim.
 */

import { type NextRequest, NextResponse } from 'next/server';

// Pin Scalar so a CDN regression cannot break docs silently. Bump in a
// separate commit once a new release looks stable.
const SCALAR_VERSION = '1.25.30';
const SCALAR_BUNDLE = `https://cdn.jsdelivr.net/npm/@scalar/api-reference@${SCALAR_VERSION}/dist/browser/standalone.min.js`;

/** Resolve the public OpenAPI spec URL from the request origin. */
function specUrl(req: NextRequest): string {
  const env = process.env.NEXT_PUBLIC_API_BASE;
  if (typeof env === 'string' && env.length > 0) {
    return `${env.replace(/\/$/, '')}/openapi.json`;
  }
  // Fall back to the same origin the request came in on. Works for
  // both prod (https://ai.aldo.tech) and local dev.
  return new URL('/openapi.json', req.nextUrl.origin).toString();
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const url = specUrl(req);
  const html = renderHtml(url);
  return new NextResponse(html, {
    status: 200,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      // Same hardening posture as the rest of the marketing surface.
      'x-frame-options': 'SAMEORIGIN',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'strict-origin-when-cross-origin',
    },
  });
}

/**
 * Build the raw HTML document. The Scalar bundle runs after the parser
 * sees both the host `<script id="api-reference">` and the bundle tag,
 * which is the contract Scalar's own examples use.
 *
 * Theme: Scalar exposes CSS variables (`--scalar-color-1`, etc.) and a
 * built-in `default` theme that already has dark-mode support. We add
 * a tiny stylesheet that hooks Scalar's variables to our design tokens
 * so the viewer flips with `html.dark` like the rest of the site.
 */
function renderHtml(specUrlAbs: string): string {
  // Theme tokens are read from the host page's `<html>` class. Because
  // this is a separate top-level document (route handler, not embedded
  // in the app shell), we must apply the dark class ourselves based on
  // a stored preference. We default to `system` and let the inline
  // boot script flip the class before paint to avoid a flash.
  const themeBoot = `
    (function() {
      try {
        var m = document.cookie.match(/(?:^|;\\s*)aldo_theme=([^;]+)/);
        var pref = m ? decodeURIComponent(m[1]) : 'system';
        var dark = pref === 'dark' || (pref === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
        if (dark) document.documentElement.classList.add('dark');
      } catch (e) {}
    })();
  `;

  // Token bridge: design tokens live in --bg / --fg / --accent etc. on
  // the marketing CSS. We mirror them here for this standalone document
  // and wire Scalar's CSS variables into the same values. Light theme
  // uses slate-50 base, dark theme uses slate-950 base — same palette
  // as the rest of the site.
  const tokenCss = `
    :root {
      --bg: 248 250 252;
      --bg-elevated: 255 255 255;
      --bg-subtle: 241 245 249;
      --fg: 15 23 42;
      --fg-muted: 71 85 105;
      --fg-faint: 148 163 184;
      --border: 226 232 240;
      --accent: 37 99 235;
      --accent-fg: 255 255 255;
      color-scheme: light;
    }
    html.dark {
      --bg: 2 6 23;
      --bg-elevated: 15 23 42;
      --bg-subtle: 30 41 59;
      --fg: 248 250 252;
      --fg-muted: 148 163 184;
      --fg-faint: 100 116 139;
      --border: 30 41 59;
      --accent: 59 130 246;
      color-scheme: dark;
    }
    html, body { margin: 0; padding: 0; min-height: 100%; background: rgb(var(--bg)); color: rgb(var(--fg)); font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; }
    .topstrip { display: flex; align-items: baseline; justify-content: space-between; gap: 1rem; padding: 0.75rem 1.5rem; border-bottom: 1px solid rgb(var(--border)); }
    .topstrip h1 { margin: 0; font-size: 1rem; font-weight: 600; }
    .topstrip p { margin: 0.15rem 0 0 0; font-size: 0.7rem; color: rgb(var(--fg-muted)); }
    .topstrip code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 0.7rem; }
    .topstrip nav { display: flex; gap: 0.75rem; font-size: 0.7rem; }
    .topstrip a { color: rgb(var(--fg-muted)); text-decoration: none; }
    .topstrip a:hover { color: rgb(var(--fg)); }
    .topstrip .sep { color: rgb(var(--fg-faint)); }
    /* Scalar variable bridge — these names come from Scalar's
       documented theming surface. */
    .scalar-app, scalar-api-reference {
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
  `;

  // Scalar configuration. Kept minimal: theme + layout + sidebar. We
  // do NOT pass `customCss` here — the token bridge above is enough
  // and customCss with newlines tends to mis-encode through HTML attr
  // round-trips.
  const config = JSON.stringify({
    theme: 'default',
    layout: 'modern',
    showSidebar: true,
    metaData: {
      title: 'ALDO AI API Reference',
    },
  });

  // Escape attribute values minimally. We control the inputs (config is
  // a known JSON literal; specUrlAbs comes from URL().toString) so we
  // only need to neutralise the double-quote and ampersand.
  const escAttr = (s: string): string => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>ALDO AI API — Reference</title>
    <meta name="description" content="Interactive OpenAPI reference for the ALDO AI Control Plane API. Searchable endpoints, try-it-out, and code samples in curl, JavaScript, and Python." />
    <script>${themeBoot}</script>
    <style>${tokenCss}</style>
  </head>
  <body>
    <header class="topstrip">
      <div>
        <h1>ALDO AI API</h1>
        <p>
          Interactive reference. Spec:
          <a href="${escAttr(specUrlAbs)}"><code>${escAttr(specUrlAbs)}</code></a>
        </p>
      </div>
      <nav>
        <a href="/api/redoc">Redoc</a>
        <span class="sep">·</span>
        <a href="${escAttr(specUrlAbs)}">Raw spec</a>
        <span class="sep">·</span>
        <a href="/docs">Guides</a>
      </nav>
    </header>

    <script id="api-reference"
            data-url="${escAttr(specUrlAbs)}"
            data-configuration="${escAttr(config)}"></script>
    <script src="${SCALAR_BUNDLE}"></script>

    <noscript>
      <p style="padding:2rem;text-align:center;">
        The interactive reference requires JavaScript. Browse the raw spec at
        <a href="${escAttr(specUrlAbs)}">${escAttr(specUrlAbs)}</a>,
        or read the static reference at <a href="/api/redoc">/api/redoc</a>.
      </p>
    </noscript>
  </body>
</html>`;
}
