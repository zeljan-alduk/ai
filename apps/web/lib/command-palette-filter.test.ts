/**
 * Pure-function tests for the command-palette ranker. The wave-15
 * docs surface adds a `docs` group; these cases lock in the ordering
 * rule that nav results outrank doc results at equal text-match
 * scores so the user's daily workflow isn't drowned by encyclopedic
 * results.
 */

import { describe, expect, it } from 'vitest';

import {
  type CommandResult,
  STATIC_NAV_RESULTS,
  filterResults,
  scoreResult,
} from './command-palette-filter.js';

describe('command-palette filter', () => {
  it('STATIC_NAV_RESULTS includes a Docs nav entry', () => {
    const docsNav = STATIC_NAV_RESULTS.find((r) => r.id === 'nav:docs');
    expect(docsNav).toBeDefined();
    expect(docsNav?.href).toBe('/docs');
  });

  it('docs results outrank no result, but underrank nav at equal text match', () => {
    const docs: CommandResult = {
      id: 'docs:/docs/concepts/privacy-tier',
      label: 'Privacy tier',
      group: 'docs',
      href: '/docs/concepts/privacy-tier',
    };
    const nav: CommandResult = {
      id: 'nav:privacy',
      label: 'Privacy',
      group: 'nav',
      href: '/security',
    };
    // Both prefix-match "privacy".
    const docsScore = scoreResult(docs, 'privacy');
    const navScore = scoreResult(nav, 'privacy');
    expect(navScore).toBeGreaterThan(docsScore);
    expect(docsScore).toBeGreaterThan(0);
  });

  it('filterResults keeps only matching rows', () => {
    const rows: CommandResult[] = [
      {
        id: 'docs:capability',
        label: 'Capability-class routing',
        group: 'docs',
        href: '/docs/concepts/capability-class-routing',
      },
      { id: 'nav:agents', label: 'Agents', group: 'nav', href: '/agents' },
    ];
    const out = filterResults(rows, 'capability');
    expect(out.length).toBe(1);
    expect(out[0]?.id).toBe('docs:capability');
  });
});
