/**
 * Pure-function tests for the command-palette ranker. Wave-15 added
 * the docs group; Wave-4 (this file) adds:
 *
 *   - the Actions group (Compare runs…, New prompt…, …)
 *   - highlightMatch() for the matched-substring renderer
 *   - snapshot of the grouped, ranked output for the empty query and a
 *     concrete "agents" filter
 */

import { describe, expect, it } from 'vitest';

import {
  COMMAND_ACTIONS,
  type CommandResult,
  STATIC_NAV_RESULTS,
  filterResults,
  highlightMatch,
  scoreResult,
} from './command-palette-filter.js';

describe('command-palette filter', () => {
  it('STATIC_NAV_RESULTS includes a Docs nav entry', () => {
    const docsNav = STATIC_NAV_RESULTS.find((r) => r.id === 'nav:docs');
    expect(docsNav).toBeDefined();
    expect(docsNav?.href).toBe('/docs');
  });

  it('STATIC_NAV_RESULTS includes every top-level route the brief asks for', () => {
    // Wave-4 — the brief asks for Pages to cover the full nav surface.
    const expected = [
      '/agents',
      '/runs',
      '/datasets',
      '/eval',
      '/eval/playground',
      '/evaluators',
      '/gallery',
      '/projects',
      '/prompts',
      '/integrations/git',
      '/threads',
      '/observability',
      '/observability/spend',
      '/playground',
      '/models',
      '/status',
      '/docs',
    ];
    const present = new Set(STATIC_NAV_RESULTS.map((r) => r.href));
    for (const href of expected) {
      expect(present, `missing ${href}`).toContain(href);
    }
  });

  it('COMMAND_ACTIONS exposes the wave-4 verbs', () => {
    const ids = COMMAND_ACTIONS.map((a) => a.id);
    expect(ids).toContain('action:compare-runs');
    expect(ids).toContain('action:fork-template');
    expect(ids).toContain('action:connect-repo');
    expect(ids).toContain('action:new-prompt');
    expect(ids).toContain('action:new-dataset');
    expect(ids).toContain('action:toggle-theme');
    expect(ids).toContain('action:signout');
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

  it('recents outrank nav and actions at equal text match', () => {
    const recent: CommandResult = {
      id: 'recent:agent:foo',
      label: 'foo',
      group: 'recent',
      href: '/agents/foo',
    };
    const nav: CommandResult = {
      id: 'nav:foo',
      label: 'foo',
      group: 'nav',
      href: '/foo',
    };
    expect(scoreResult(recent, 'foo')).toBeGreaterThan(scoreResult(nav, 'foo'));
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

  it('filtering by "agents" surfaces Agents nav first, with related nav near the top', () => {
    // The empty-query render fans every group out by weight; "agents"
    // must put the literal Agents page above the Eval page even though
    // both contain the substring (Eval has agents in its keywords).
    const out = filterResults([...STATIC_NAV_RESULTS, ...COMMAND_ACTIONS], 'agents');
    expect(out[0]?.id).toBe('nav:agents');
  });
});

describe('highlightMatch', () => {
  it('returns one non-match segment when query is empty', () => {
    const segments = highlightMatch('hello world', '');
    expect(segments).toEqual([{ text: 'hello world', match: false }]);
  });

  it('marks the matched substring case-insensitively', () => {
    const segments = highlightMatch('Capability routing', 'CAP');
    expect(segments).toEqual([
      { text: 'Cap', match: true },
      { text: 'ability routing', match: false },
    ]);
  });

  it('handles multiple non-overlapping occurrences', () => {
    const segments = highlightMatch('aldo aldo aldo', 'aldo');
    // Three matches separated by single-space non-matches.
    const matches = segments.filter((s) => s.match);
    expect(matches.length).toBe(3);
  });

  it('returns the original text when no match exists', () => {
    const segments = highlightMatch('foo', 'bar');
    expect(segments).toEqual([{ text: 'foo', match: false }]);
  });
});

describe('palette grouped-output snapshots', () => {
  // The palette renders by GROUP_ORDER. We snapshot a stable shape
  // that the renderer consumes (label + group + href) so the snapshot
  // stays readable AND a regression in the static set is loud.

  it('empty query — recents + actions + nav surface in the right order', () => {
    // Simulate a logged-in user with two recents.
    const recents: CommandResult[] = [
      {
        id: 'recent:agent:tech-lead',
        label: 'tech-lead',
        group: 'recent',
        href: '/agents/tech-lead',
      },
      {
        id: 'recent:run:abcd1234',
        label: 'tech-lead · abcd1234',
        group: 'recent',
        href: '/runs/abcd1234',
      },
    ];
    const all = [...recents, ...COMMAND_ACTIONS, ...STATIC_NAV_RESULTS];
    const ranked = filterResults(all, '');
    // Top-of-list shape: first two are recents (order preserved), then
    // the Actions group, then nav.
    expect(ranked.slice(0, 2).map((r) => r.id)).toEqual([
      'recent:agent:tech-lead',
      'recent:run:abcd1234',
    ]);
    const firstAction = ranked.find((r) => r.group === 'actions');
    const firstNav = ranked.find((r) => r.group === 'nav');
    expect(firstAction).toBeDefined();
    expect(firstNav).toBeDefined();
    // Actions outrank nav at equal text-match score (empty query).
    const actionIdx = ranked.findIndex((r) => r.group === 'actions');
    const navIdx = ranked.findIndex((r) => r.group === 'nav');
    expect(actionIdx).toBeLessThan(navIdx);

    // Snapshot the {group,href,label} shape for the first 12 rows so
    // future ranker tweaks light up loudly.
    expect(
      ranked.slice(0, 12).map((r) => ({ id: r.id, group: r.group, label: r.label, href: r.href })),
    ).toMatchSnapshot();
  });

  it('"agents" query — Agents nav top, then anything else with agent in the text', () => {
    const all = [...COMMAND_ACTIONS, ...STATIC_NAV_RESULTS];
    const ranked = filterResults(all, 'agents');
    expect(ranked[0]?.id).toBe('nav:agents');
    expect(
      ranked.slice(0, 6).map((r) => ({ id: r.id, group: r.group, label: r.label, href: r.href })),
    ).toMatchSnapshot();
  });
});
