/**
 * Smoke test for the `/api/docs` page (Scalar-powered OpenAPI viewer).
 *
 * We render the server component to a string (via React's
 * `renderToString`) and assert on the shell markup. The interactive
 * UI is loaded by the Scalar standalone bundle on the client; we
 * only verify the host elements + spec URL + noscript fallback are
 * in the markup.
 */

import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import ApiDocsPage from './page.js';

describe('/api/docs page', () => {
  it('renders the Scalar host element', () => {
    const html = renderToString(<ApiDocsPage />);
    expect(html).toContain('id="api-reference"');
    expect(html).toContain('@scalar/api-reference');
    expect(html).toContain('data-configuration=');
  });

  it('points at /openapi.json on the configured API base', () => {
    const html = renderToString(<ApiDocsPage />);
    expect(html).toContain('/openapi.json');
  });

  it('renders a noscript fallback for the JS-disabled case', () => {
    const html = renderToString(<ApiDocsPage />);
    expect(html).toContain('<noscript>');
    expect(html).toContain('requires JavaScript');
  });

  it('links out to Redoc and the raw spec from the header', () => {
    const html = renderToString(<ApiDocsPage />);
    expect(html).toContain('/api/redoc');
    expect(html).toContain('Raw spec');
  });
});
