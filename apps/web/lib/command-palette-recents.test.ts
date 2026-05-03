/**
 * Tests for the localStorage-backed recents store.
 *
 * Pure helpers (`pushRecent`, `applyCap`, `recentTypeForResult`,
 * `recentToResult`) are testable without jsdom. We avoid testing the
 * `readRecents` / `recordRecentUsage` browser-side variants here; the
 * Playwright e2e spec covers the full localStorage round-trip.
 */

import { describe, expect, it } from 'vitest';

import type { CommandResult } from './command-palette-filter.js';
import {
  RECENT_CAP_PER_TYPE,
  applyCap,
  pushRecent,
  recentToResult,
  recentTypeForResult,
} from './command-palette-recents.js';

describe('applyCap', () => {
  it('keeps at most RECENT_CAP_PER_TYPE per type', () => {
    const items = Array.from({ length: 30 }, (_, i) => ({
      id: `agent-${i}`,
      type: 'agents' as const,
      label: `agent-${i}`,
      href: `/agents/agent-${i}`,
      touchedAt: 1000 + i,
    }));
    const out = applyCap(items);
    expect(out.length).toBe(RECENT_CAP_PER_TYPE);
    // Newest first.
    expect(out[0]?.id).toBe('agent-29');
    expect(out[RECENT_CAP_PER_TYPE - 1]?.id).toBe(`agent-${30 - RECENT_CAP_PER_TYPE}`);
  });

  it('isolates the cap per type', () => {
    const items = [
      ...Array.from({ length: RECENT_CAP_PER_TYPE + 5 }, (_, i) => ({
        id: `a-${i}`,
        type: 'agents' as const,
        label: `a-${i}`,
        href: `/a/${i}`,
        touchedAt: 1_000 + i,
      })),
      ...Array.from({ length: 3 }, (_, i) => ({
        id: `r-${i}`,
        type: 'runs' as const,
        label: `r-${i}`,
        href: `/r/${i}`,
        touchedAt: 2_000 + i,
      })),
    ];
    const out = applyCap(items);
    expect(out.filter((x) => x.type === 'agents').length).toBe(RECENT_CAP_PER_TYPE);
    expect(out.filter((x) => x.type === 'runs').length).toBe(3);
  });
});

describe('pushRecent', () => {
  it('places the new item first and dedupes by id', () => {
    const bag = {
      version: 1 as const,
      items: [
        { id: 'a', type: 'agents' as const, label: 'a', href: '/a', touchedAt: 100 },
        { id: 'b', type: 'agents' as const, label: 'b', href: '/b', touchedAt: 200 },
      ],
    };
    const next = pushRecent(bag, {
      id: 'a',
      type: 'agents',
      label: 'a renamed',
      href: '/a',
      touchedAt: 300,
    });
    expect(next.items.length).toBe(2);
    expect(next.items[0]?.id).toBe('a');
    expect(next.items[0]?.label).toBe('a renamed');
  });
});

describe('recentTypeForResult', () => {
  it('maps each tracked group to its recent-type', () => {
    const cases: Array<[CommandResult['group'], ReturnType<typeof recentTypeForResult>]> = [
      ['agents', 'agents'],
      ['runs', 'runs'],
      ['datasets', 'datasets'],
      ['evaluators', 'evaluators'],
      ['prompts', 'prompts'],
      ['models', 'models'],
      ['nav', 'nav'],
      ['actions', null],
      ['recent', null],
      ['settings', null],
      ['docs', null],
    ];
    for (const [group, expected] of cases) {
      const r: CommandResult = { id: 'x', label: 'x', group, href: '/x' };
      expect(recentTypeForResult(r)).toBe(expected);
    }
  });
});

describe('recentToResult', () => {
  it('builds a recent-group CommandResult that round-trips back to the original href', () => {
    const out = recentToResult({
      id: 'agent:foo',
      type: 'agents',
      label: 'foo',
      href: '/agents/foo',
      description: 'hello',
      touchedAt: 1,
    });
    expect(out.group).toBe('recent');
    expect(out.href).toBe('/agents/foo');
    expect(out.id).toBe('recent:agent:foo');
    expect(out.description).toBe('hello');
  });
});
