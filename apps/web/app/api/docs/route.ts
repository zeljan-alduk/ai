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
 * Theme: Scalar's `default` theme has its own dark-mode toggle and
 * persists the choice to localStorage. We deliberately do NOT override
 * Scalar's CSS variables — earlier attempts to bridge `--scalar-*` into
 * our design tokens broke Scalar's toggle (the variables ended up
 * pointing at our `html.dark`-conditional tokens, which Scalar's toggle
 * does not flip). The header strip uses neutral system colors so it
 * looks fine in either Scalar mode.
 */
function renderHtml(specUrlAbs: string): string {
  // Initial-mode boot. Scalar persists `theme-mode` (or similar) to
  // localStorage; on a cold page we honour `prefers-color-scheme` so
  // a dark-mode user doesn't flash light. The boot script paints the
  // `<html>` `data-scalar-mode` attribute before Scalar mounts so the
  // header below also matches.
  const themeBoot = `
    (function() {
      try {
        var stored = null;
        try { stored = localStorage.getItem('default-color-mode'); } catch (e) {}
        var mode = stored;
        if (mode !== 'dark' && mode !== 'light') {
          mode = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
        }
        document.documentElement.setAttribute('data-scalar-mode', mode);
        // Watch Scalar's own writes so when the user clicks the toggle,
        // our header re-styles to match without a reload.
        var t = setInterval(function() {
          try {
            var s = localStorage.getItem('default-color-mode');
            if (s === 'dark' || s === 'light') {
              document.documentElement.setAttribute('data-scalar-mode', s);
            }
          } catch (e) {}
        }, 500);
        // Also flip on system change while the page is open.
        try {
          window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function(e) {
            var s = null; try { s = localStorage.getItem('default-color-mode'); } catch (err) {}
            if (s !== 'dark' && s !== 'light') {
              document.documentElement.setAttribute('data-scalar-mode', e.matches ? 'dark' : 'light');
            }
          });
        } catch (e) {}
      } catch (e) {}
    })();
  `;

  // Header-only stylesheet. Two palettes: light + dark. We do NOT touch
  // Scalar's variables — Scalar owns its own viewport. The
  // `data-scalar-mode` attribute on `<html>` is stamped by the boot
  // script above (and re-stamped when Scalar's toggle fires).
  const tokenCss = `
    html { color-scheme: light; }
    html[data-scalar-mode="dark"] { color-scheme: dark; }
    html, body { margin: 0; padding: 0; min-height: 100%; font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; background: #f8fafc; color: #0f172a; }
    html[data-scalar-mode="dark"], html[data-scalar-mode="dark"] body { background: #020617; color: #f8fafc; }
    .topstrip { display: flex; align-items: baseline; justify-content: space-between; gap: 1rem; padding: 0.75rem 1.5rem; border-bottom: 1px solid #e2e8f0; }
    html[data-scalar-mode="dark"] .topstrip { border-bottom-color: #1e293b; }
    .topstrip h1 { margin: 0; font-size: 1rem; font-weight: 600; }
    .topstrip p { margin: 0.15rem 0 0 0; font-size: 0.7rem; color: #475569; }
    html[data-scalar-mode="dark"] .topstrip p { color: #94a3b8; }
    .topstrip code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 0.7rem; }
    .topstrip nav { display: flex; gap: 0.75rem; font-size: 0.7rem; }
    .topstrip a { color: #475569; text-decoration: none; }
    html[data-scalar-mode="dark"] .topstrip a { color: #94a3b8; }
    .topstrip a:hover { color: #0f172a; }
    html[data-scalar-mode="dark"] .topstrip a:hover { color: #f8fafc; }
    .topstrip .sep { color: #94a3b8; }
    html[data-scalar-mode="dark"] .topstrip .sep { color: #475569; }
  `;

  // Scalar configuration. Minimal — let Scalar own its theme.
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
