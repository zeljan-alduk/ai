/**
 * Pins the marketing landing's local-models demo section. The
 * heading + CTA hrefs are part of the test contract — bumping
 * them means bumping the e2e specs that look for them.
 *
 * Vitest env is `node`, so we render to a static HTML string and
 * grep — same pattern as `top-nav.test.tsx`.
 */

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { LocalModelRating } from './local-model-rating.js';

function render(): string {
  return renderToStaticMarkup(<LocalModelRating />);
}

describe('LocalModelRating', () => {
  it('renders the headline + section id', () => {
    const html = render();
    expect(html).toContain('id="local-models"');
    expect(html).toMatch(/Discover every local LLM/i);
    expect(html).toContain('Discovered models');
    expect(html).toContain('Quality × speed rating');
  });

  it('the primary CTA links to /local-models, the secondary to the guide', () => {
    const html = render();
    expect(html).toMatch(/href="\/local-models"[^>]*>\s*Try it on your laptop/);
    expect(html).toMatch(/href="\/docs\/guides\/local-models"[^>]*>\s*Read the guide/);
  });

  it('mentions every named probe + a port-scan card', () => {
    const html = render();
    for (const src of ['lmstudio', 'ollama', 'llamacpp', 'vllm', 'openai-compat']) {
      expect(html).toContain(src);
    }
  });

  it('uses 127.0.0.1 in the discovered model URLs (not localhost)', () => {
    const html = render();
    expect(html).toContain('127.0.0.1');
    expect(html).not.toMatch(/localhost:\d+/);
  });
});
