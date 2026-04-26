/**
 * Pure filter logic for the /agents gallery.
 */

import type { AgentSummary } from '@aldo-ai/api-contract';
import { describe, expect, it } from 'vitest';
import { type FilterableAgent, applyGalleryFilters } from './gallery-filters';

function agent(partial: Partial<FilterableAgent>): FilterableAgent {
  const base: AgentSummary = {
    name: partial.name ?? 'noop',
    owner: partial.owner ?? 'team@example',
    latestVersion: partial.latestVersion ?? '0.1.0',
    promoted: partial.promoted ?? false,
    description: partial.description ?? 'a noop agent',
    privacyTier: partial.privacyTier ?? 'public',
    team: partial.team ?? 'delivery',
    tags: partial.tags ?? [],
  };
  return { ...base, hasComposite: partial.hasComposite ?? false };
}

const FIXTURE: FilterableAgent[] = [
  agent({ name: 'principal', team: 'direction', privacyTier: 'sensitive', hasComposite: true }),
  agent({ name: 'architect', team: 'direction', privacyTier: 'internal', hasComposite: true }),
  agent({ name: 'tech-lead', team: 'delivery', privacyTier: 'sensitive', hasComposite: true }),
  agent({ name: 'code-reviewer', team: 'support', privacyTier: 'internal', hasComposite: false }),
  agent({ name: 'eval-runner', team: 'meta', privacyTier: 'public', hasComposite: false }),
  agent({
    name: 'frontend-engineer',
    team: 'delivery',
    privacyTier: 'internal',
    hasComposite: false,
    description: 'Ships React + Tailwind UI work for the control plane.',
  }),
];

describe('applyGalleryFilters', () => {
  it('returns all agents when no filter is set', () => {
    expect(applyGalleryFilters(FIXTURE, {})).toHaveLength(FIXTURE.length);
  });

  it('filters by team', () => {
    const out = applyGalleryFilters(FIXTURE, { team: 'direction' });
    expect(out.map((a) => a.name)).toEqual(['principal', 'architect']);
  });

  it('treats team=all as no team filter', () => {
    expect(applyGalleryFilters(FIXTURE, { team: 'all' })).toHaveLength(FIXTURE.length);
  });

  it('filters by privacy tier', () => {
    const out = applyGalleryFilters(FIXTURE, { tier: 'sensitive' });
    expect(out.map((a) => a.name).sort()).toEqual(['principal', 'tech-lead']);
  });

  it('filters by composite=has', () => {
    const out = applyGalleryFilters(FIXTURE, { composite: 'has' });
    expect(out.every((a) => a.hasComposite)).toBe(true);
    expect(out.length).toBe(3);
  });

  it('filters by composite=leaf', () => {
    const out = applyGalleryFilters(FIXTURE, { composite: 'leaf' });
    expect(out.every((a) => !a.hasComposite)).toBe(true);
    expect(out.length).toBe(3);
  });

  it('AND-composes filters', () => {
    const out = applyGalleryFilters(FIXTURE, { team: 'delivery', composite: 'has' });
    expect(out.map((a) => a.name)).toEqual(['tech-lead']);
  });

  it('search matches both name and description (case-insensitive)', () => {
    const out = applyGalleryFilters(FIXTURE, { search: 'react' });
    expect(out.map((a) => a.name)).toEqual(['frontend-engineer']);
    const out2 = applyGalleryFilters(FIXTURE, { search: 'PRINC' });
    expect(out2.map((a) => a.name)).toEqual(['principal']);
  });

  it('returns empty array when nothing matches', () => {
    const out = applyGalleryFilters(FIXTURE, { search: 'no-such-token-anywhere' });
    expect(out).toEqual([]);
  });
});
