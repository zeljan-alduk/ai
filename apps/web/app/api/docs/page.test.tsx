/**
 * Smoke test for the `/api/docs` Swagger UI page.
 *
 * We render the server component to a string (via React's
 * `renderToString`) and assert on the markup. We avoid `@testing-
 * library/react` here so this test doesn't pull jsdom — the page is
 * a pure server component and a string is enough to verify the shell.
 */

import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import ApiDocsPage from './page.js';

describe('/api/docs page', () => {
  it('renders the Swagger UI shell', () => {
    const html = renderToString(<ApiDocsPage />);
    expect(html).toContain('id="swagger-ui"');
    expect(html).toContain('swagger-ui.css');
    expect(html).toContain('swagger-ui-bundle.js');
    expect(html).toContain('SwaggerUIBundle');
  });

  it('points at /openapi.json on the configured API base', () => {
    const html = renderToString(<ApiDocsPage />);
    expect(html).toContain('/openapi.json');
  });

  it('renders a fallback for the spec-unavailable case', () => {
    const html = renderToString(<ApiDocsPage />);
    expect(html).toContain('aldo-swagger-fallback');
  });
});
