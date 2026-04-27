/**
 * `/api/redoc` — Redoc rendering the canonical OpenAPI 3.1 spec.
 *
 * Strategy
 * --------
 * Redoc is loaded from its hosted MIT-licensed distribution at runtime
 * via `<redoc>` web component (`redoc-standalone.js`). We deliberately
 * do NOT npm-install the `redoc` React component for the same reason
 * we don't install swagger-ui-react: the distributed bundle is large
 * and pulls in styled-components + many transitive deps. The hosted
 * standalone bundle is the upstream-recommended embedding pattern and
 * gives us SSR-friendly markup with a single async script tag.
 *
 * Theming
 * -------
 * Redoc accepts a JSON theme object via the `theme` attribute. We pipe
 * the design-system tokens through as best-effort overrides; deeper
 * theming is left to upstream.
 *
 * Privacy / auth
 * --------------
 * Public route — the spec is public; the docs surface is public.
 */

import type { Metadata } from 'next';

const REDOC_VERSION = '2.5.0';
const REDOC_JS = `https://cdn.jsdelivr.net/npm/redoc@${REDOC_VERSION}/bundles/redoc.standalone.js`;
const GITHUB_URL = 'https://github.com/zeljan-alduk/ai';

export const metadata: Metadata = {
  title: 'ALDO AI API — Redoc',
  description: 'Read-only Redoc rendering of the ALDO AI Control Plane API spec.',
};

function specUrl(): string {
  const base = process.env.NEXT_PUBLIC_API_BASE ?? 'http://localhost:3001';
  return `${base.replace(/\/$/, '')}/openapi.json`;
}

/** Minimal theme override pulling from the design-system tokens. */
const redocTheme = JSON.stringify({
  colors: {
    primary: { main: '#3b82f6' },
    text: { primary: 'var(--fg)' },
    background: 'var(--bg)',
  },
  typography: {
    fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
    headings: { fontFamily: 'inherit' },
  },
  sidebar: {
    backgroundColor: 'var(--bg-subtle)',
    textColor: 'var(--fg)',
  },
});

const fallbackCss = `
  #aldo-redoc-fallback { display: none; padding: 2rem; font-family: system-ui, sans-serif; color: var(--fg); }
  redoc { display: block; min-height: calc(100vh - 4rem); }
`;

const bootScript = `
  window.addEventListener('load', function() {
    setTimeout(function() {
      var rd = document.querySelector('redoc');
      if (!rd || typeof Redoc === 'undefined') {
        var n = document.getElementById('aldo-redoc-fallback');
        if (n) n.style.display = 'block';
      }
    }, 4000);
  });
`;

export default function RedocPage() {
  const url = specUrl();
  return (
    <div className="min-h-screen bg-bg text-fg">
      {/* biome-ignore lint/security/noDangerouslySetInnerHtml: static literal CSS, no user input */}
      <style dangerouslySetInnerHTML={{ __html: fallbackCss }} />
      <header className="border-b border-border px-6 py-3">
        <h1 className="text-lg font-semibold">ALDO AI API — Redoc</h1>
        <p className="text-sm text-fg-muted">
          Spec source:{' '}
          <a className="underline" href={url}>
            {url}
          </a>
          . Interactive console at{' '}
          <a className="underline" href="/api/docs">
            /api/docs
          </a>
          .
        </p>
      </header>
      {/* The Redoc web component fetches the spec, renders SSR-style. */}
      {/* @ts-expect-error — `redoc` is a custom element provided by the script bundle. */}
      <redoc spec-url={url} theme={redocTheme} />
      <noscript>
        <p style={{ padding: '2rem' }}>
          Redoc requires JavaScript. Browse the raw spec at <a href={url}>{url}</a>.
        </p>
      </noscript>
      <div id="aldo-redoc-fallback">
        <h2>Spec unavailable</h2>
        <p>
          The Redoc bundle could not be loaded, or the API spec at <code>{url}</code> is not
          reachable. Source on <a href={GITHUB_URL}>GitHub</a>, or fetch directly with{' '}
          <code>curl {url}</code>.
        </p>
      </div>
      <script src={REDOC_JS} async />
      {/* biome-ignore lint/security/noDangerouslySetInnerHtml: static literal boot script */}
      <script dangerouslySetInnerHTML={{ __html: bootScript }} />
    </div>
  );
}
