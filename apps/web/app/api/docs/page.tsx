/**
 * `/api/docs` — Swagger UI rendering the canonical OpenAPI 3.1 spec.
 *
 * Strategy
 * --------
 * Swagger UI is loaded from its hosted MIT-licensed distribution at
 * runtime instead of `swagger-ui-react`. Rationale: `swagger-ui-react`
 * is ~1.5 MB and pulls react-redux + classnames + lodash. For a docs
 * surface we serve the same UI from the upstream UMD bundle and apply
 * a small CSS override to align with the design-system tokens. The
 * Swagger UI CSS class hierarchy is the upper limit on theming
 * (documented behaviour from the upstream project).
 *
 * Privacy / auth
 * --------------
 * The spec is public (`/openapi.json` bypasses auth in apps/api). The
 * page is in the chromeless allow-list (no app sidebar) and is itself
 * outside the auth-required surface — see `lib/middleware-shared.ts`.
 *
 * LLM-agnostic
 * ------------
 * The spec carries `x-aldo-llm-agnostic: true`; the docs page just
 * renders whatever the spec contains. No provider names live here.
 */

import type { Metadata } from 'next';

const SWAGGER_UI_VERSION = '5.17.14';
// jsDelivr (proper CORS) instead of unpkg (CORS-blocked when crossorigin=anonymous).
const SWAGGER_UI_CSS = `https://cdn.jsdelivr.net/npm/swagger-ui-dist@${SWAGGER_UI_VERSION}/swagger-ui.css`;
const SWAGGER_UI_JS = `https://cdn.jsdelivr.net/npm/swagger-ui-dist@${SWAGGER_UI_VERSION}/swagger-ui-bundle.js`;
const SWAGGER_UI_PRESET_JS = `https://cdn.jsdelivr.net/npm/swagger-ui-dist@${SWAGGER_UI_VERSION}/swagger-ui-standalone-preset.js`;

export const metadata: Metadata = {
  title: 'ALDO AI API — Swagger UI',
  description: 'Interactive Swagger UI for the ALDO AI Control Plane API.',
};

/** API base URL Swagger UI fetches the spec from. */
function specUrl(): string {
  const base = process.env.NEXT_PUBLIC_API_BASE ?? 'http://localhost:3001';
  return `${base.replace(/\/$/, '')}/openapi.json`;
}

/**
 * Tailwind-token override for Swagger UI. Variables `--bg`, `--fg`,
 * `--border`, `--accent`, `--bg-subtle` are wired in
 * apps/web/app/globals.css.
 */
const themeOverrideCss = `
  body, .swagger-ui { background: var(--bg) !important; color: var(--fg) !important; }
  .swagger-ui .topbar { display: none !important; }
  .swagger-ui .info, .swagger-ui .info .title, .swagger-ui .opblock-tag,
  .swagger-ui .opblock-summary-description, .swagger-ui label,
  .swagger-ui .response-col_status, .swagger-ui .scheme-container,
  .swagger-ui table thead tr th { color: var(--fg) !important; }
  .swagger-ui .opblock { border-color: var(--border) !important; background: var(--bg-subtle) !important; }
  .swagger-ui .btn { border-color: var(--border) !important; }
  .swagger-ui .btn.execute { background: var(--accent) !important; border-color: var(--accent) !important; }
  .swagger-ui section.models, .swagger-ui section.models.is-open,
  .swagger-ui .scheme-container { background: var(--bg) !important; border-color: var(--border) !important; }
  .swagger-ui .highlight-code, .swagger-ui pre { background: var(--bg-subtle) !important; color: var(--fg) !important; }
  #aldo-swagger-fallback { display: none; padding: 2rem; font-family: system-ui, sans-serif; color: var(--fg); }
`;

function bootScript(url: string): string {
  return `
    window.addEventListener('load', function() {
      try {
        if (typeof SwaggerUIBundle === 'undefined') {
          var f = document.getElementById('aldo-swagger-fallback');
          if (f) f.style.display = 'block';
          return;
        }
        window.ui = SwaggerUIBundle({
          url: ${JSON.stringify(url)},
          dom_id: '#swagger-ui',
          deepLinking: true,
          defaultModelsExpandDepth: 0,
          presets: [SwaggerUIBundle.presets.apis, SwaggerUIStandalonePreset],
          layout: 'BaseLayout'
        });
      } catch (err) {
        var n = document.getElementById('aldo-swagger-fallback');
        if (n) n.style.display = 'block';
        console.error('swagger-ui boot failed', err);
      }
    });
  `;
}

export default function ApiDocsPage() {
  const url = specUrl();
  return (
    <div className="min-h-screen bg-bg text-fg">
      <link rel="stylesheet" href={SWAGGER_UI_CSS} />
      {/* biome-ignore lint/security/noDangerouslySetInnerHtml: static literal CSS, no user input */}
      <style dangerouslySetInnerHTML={{ __html: themeOverrideCss }} />
      <header className="border-b border-border px-6 py-3">
        <h1 className="text-lg font-semibold">ALDO AI API — Swagger UI</h1>
        <p className="text-sm text-fg-muted">
          Spec source:{' '}
          <a className="underline" href={url}>
            {url}
          </a>
          . Read-only browsing at{' '}
          <a className="underline" href="/api/redoc">
            /api/redoc
          </a>
          .
        </p>
      </header>
      <div id="swagger-ui" />
      <noscript>
        <p style={{ padding: '2rem' }}>
          Swagger UI requires JavaScript. Browse the raw spec at <a href={url}>{url}</a>.
        </p>
      </noscript>
      <div id="aldo-swagger-fallback">
        <h2>Spec unavailable</h2>
        <p>
          The Swagger UI bundle could not be loaded, or the API spec at <code>{url}</code> is not
          reachable. Fetch directly with{' '}
          <code>curl {url}</code>.
        </p>
      </div>
      <script src={SWAGGER_UI_JS} async />
      <script src={SWAGGER_UI_PRESET_JS} async />
      {/* biome-ignore lint/security/noDangerouslySetInnerHtml: static boot script with JSON-encoded URL only */}
      <script dangerouslySetInnerHTML={{ __html: bootScript(url) }} />
    </div>
  );
}
