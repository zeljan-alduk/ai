/**
 * Smoke test for the `/api/redoc` Redoc page.
 *
 * Render the server component to a string and assert on the upstream
 * Redoc bundle inclusion + the `<redoc>` web-component tag.
 */

import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import RedocPage from './page.js';

describe('/api/redoc page', () => {
  it('renders the Redoc shell', () => {
    const html = renderToString(<RedocPage />);
    expect(html).toContain('<redoc');
    expect(html).toContain('redoc.standalone.js');
    expect(html).toContain('spec-url');
  });

  it('points at /openapi.json on the configured API base', () => {
    const html = renderToString(<RedocPage />);
    expect(html).toContain('/openapi.json');
  });

  it('renders a fallback for the spec-unavailable case', () => {
    const html = renderToString(<RedocPage />);
    expect(html).toContain('aldo-redoc-fallback');
  });
});
