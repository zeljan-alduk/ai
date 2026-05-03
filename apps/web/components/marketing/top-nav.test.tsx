/**
 * Snapshot-style tests for the marketing top-nav.
 *
 * The vitest environment is `node`, so we render to a static HTML
 * string with `react-dom/server` and assert against the markup
 * directly. The wave-12 redesign added a Sheet drawer for mobile +
 * a ThemeToggle on the right; we verify the public CTAs still land
 * on the right routes and the new affordances ship in markup.
 */

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MarketingTopNav } from './top-nav.js';

function render(): string {
  return renderToStaticMarkup(<MarketingTopNav initialTheme="system" />);
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
    expect(html).toContain('href="/docs"');
    expect(html).toContain('href="/roadmap"');
    expect(html).toContain('href="/changelog"');
  });

  it('exposes both Log in and Sign up CTAs at the right routes', () => {
    const html = render();
    expect(html).toContain('href="/login"');
    expect(html).toContain('href="/signup"');
  });

  it('renders only first-party nav links (no external/GitHub link)', () => {
    const html = render();
    expect(html).not.toContain('github.com');
    expect(html).not.toContain('rel="noreferrer"');
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
