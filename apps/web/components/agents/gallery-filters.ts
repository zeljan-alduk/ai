/**
 * Pure filter logic for the /agents gallery.
 *
 * Exported as a standalone module so it's vitest-friendly without
 * pulling in React or Next.js. Filters are AND-composed.
 *
 * LLM-agnostic: filters operate on platform-level fields (team, tier,
 * has_composite, name/description substring). Never branches on a
 * provider name.
 */

import type { AgentSummary, PrivacyTier } from '@aldo-ai/api-contract';

export type TeamFilter = 'direction' | 'delivery' | 'support' | 'meta' | 'all';
export type CompositeFilter = 'any' | 'has' | 'leaf';

export interface GalleryFilterState {
  team?: TeamFilter;
  tier?: PrivacyTier | 'all';
  composite?: CompositeFilter;
  /** Free-text search; case-insensitive, substring on name + description. */
  search?: string;
}

export interface FilterableAgent extends AgentSummary {
  /** Whether the agent's spec declares a composite block. Filter input. */
  readonly hasComposite?: boolean;
}

export function applyGalleryFilters<A extends FilterableAgent>(
  agents: ReadonlyArray<A>,
  state: GalleryFilterState,
): A[] {
  const search = (state.search ?? '').trim().toLowerCase();
  return agents.filter((a) => {
    if (state.team && state.team !== 'all' && a.team !== state.team) return false;
    if (state.tier && state.tier !== 'all' && a.privacyTier !== state.tier) return false;
    if (state.composite === 'has' && !a.hasComposite) return false;
    if (state.composite === 'leaf' && a.hasComposite) return false;
    if (search.length > 0) {
      const hay = `${a.name}\n${a.description}`.toLowerCase();
      if (!hay.includes(search)) return false;
    }
    return true;
  });
}

export const TEAM_FILTERS: ReadonlyArray<TeamFilter> = [
  'all',
  'direction',
  'delivery',
  'support',
  'meta',
];
export const TIER_FILTERS: ReadonlyArray<PrivacyTier | 'all'> = [
  'all',
  'public',
  'internal',
  'sensitive',
];
export const COMPOSITE_FILTERS: ReadonlyArray<CompositeFilter> = ['any', 'has', 'leaf'];
