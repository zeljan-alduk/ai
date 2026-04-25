/**
 * Snapshot-style tests for the marketing top-nav.
 *
 * The vitest environment is `node`, so we render to a static HTML
 * string with `react-dom/server` and assert against the markup
 * directly. This is sufficient for the wave-11 quality bar
 * (≥4 cases): we are checking that the public CTAs land on the
 * right routes, not exercising the scroll-state client effect.
 */

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MarketingTopNav } from './top-nav.js';

function render(): string {
  return renderToStaticMarkup(<MarketingTopNav />);
}

describe('MarketingTopNav', () => {
  it('renders the ALDO AI logo + brand label', () => {
    const html = render();
    expect(html).toContain('ALDO AI');
    expect(html).toContain('control plane');
  });

  it('links to every public marketing route', () => {
    const html = render();
    expect(html).toContain('href="/pricing"');
    expect(html).toContain('href="/security"');
    expect(html).toContain('href="/about"');
  });

  it('exposes both Log in and Sign up CTAs at the right routes', () => {
    const html = render();
    expect(html).toMatch(/href="\/login"[^>]*>[\s\S]*?Log in/);
    expect(html).toMatch(/href="\/signup"[^>]*>[\s\S]*?Sign up/);
  });

  it('opens the GitHub link in a new tab with rel=noreferrer', () => {
    const html = render();
    expect(html).toContain('href="https://github.com/zeljan-alduk/ai"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noreferrer"');
  });

  it('renders as a <header> with the sticky-top class hooks', () => {
    const html = render();
    // The wrapper must be a <header> so the nav's role is implicit
    // and the sticky-positioning class is present at first paint
    // (i.e. before any JS runs to flip the scrolled-state class).
    expect(html.startsWith('<header')).toBe(true);
    expect(html).toContain('sticky');
    expect(html).toContain('top-0');
  });
});
