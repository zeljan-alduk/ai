/**
 * Unit tests for the wave-12 model-cards filter logic + the
 * cost-comparison sort. Pure functions live in `./filters.ts` so we
 * never need to drag React/JSDOM into this suite.
 */

import { describe, expect, it } from 'vitest';
import {
  EMPTY_FILTERS,
  type ModelSummary,
  computeLocalityKpis,
  filterModels,
  sortByCostAscending,
} from './filters.js';

function model(partial: Partial<ModelSummary> & { id: string }): ModelSummary {
  return {
    id: partial.id,
    provider: partial.provider ?? 'opaque',
    locality: partial.locality ?? 'cloud',
    capabilityClass: partial.capabilityClass ?? 'reasoning-medium',
    provides: partial.provides ?? [],
    privacyAllowed: partial.privacyAllowed ?? ['public', 'internal'],
    cost: partial.cost ?? { usdPerMtokIn: 1, usdPerMtokOut: 2 },
    effectiveContextTokens: partial.effectiveContextTokens ?? 100_000,
    available: partial.available ?? true,
    ...(partial.latencyP95Ms !== undefined ? { latencyP95Ms: partial.latencyP95Ms } : {}),
    ...(partial.lastProbedAt !== undefined ? { lastProbedAt: partial.lastProbedAt } : {}),
  };
}

const SEED: ReadonlyArray<ModelSummary> = [
  model({ id: 'cloud-large', locality: 'cloud', cost: { usdPerMtokIn: 10, usdPerMtokOut: 30 } }),
  model({
    id: 'cloud-fast',
    locality: 'cloud',
    capabilityClass: 'fast-draft',
    cost: { usdPerMtokIn: 0, usdPerMtokOut: 0 },
  }),
  model({
    id: 'local-coder',
    locality: 'local',
    capabilityClass: 'local-reasoning',
    privacyAllowed: ['public', 'internal', 'sensitive'],
    cost: { usdPerMtokIn: 0, usdPerMtokOut: 0 },
  }),
  model({
    id: 'onprem-llama',
    locality: 'on-prem',
    capabilityClass: 'reasoning-medium',
    privacyAllowed: ['public', 'internal', 'sensitive'],
    cost: { usdPerMtokIn: 0, usdPerMtokOut: 0 },
  }),
  model({
    id: 'cloud-public-only',
    locality: 'cloud',
    privacyAllowed: ['public'],
    cost: { usdPerMtokIn: 1.25, usdPerMtokOut: 10 },
  }),
];

describe('filterModels', () => {
  it('returns every model when no filters are active', () => {
    const out = filterModels(SEED, EMPTY_FILTERS);
    expect(out.map((m) => m.id)).toEqual(SEED.map((m) => m.id));
  });

  it('narrows by locality (single chip)', () => {
    const out = filterModels(SEED, { ...EMPTY_FILTERS, localities: new Set(['local']) });
    expect(out.map((m) => m.id)).toEqual(['local-coder']);
  });

  it('narrows by multiple localities (cloud OR local)', () => {
    const out = filterModels(SEED, {
      ...EMPTY_FILTERS,
      localities: new Set(['local', 'on-prem']),
    });
    expect(out.map((m) => m.id).sort()).toEqual(['local-coder', 'onprem-llama']);
  });

  it('narrows by privacy tier — sensitive shows only sensitive-allowed rows', () => {
    const out = filterModels(SEED, { ...EMPTY_FILTERS, privacy: new Set(['sensitive']) });
    expect(out.map((m) => m.id).sort()).toEqual(['local-coder', 'onprem-llama']);
  });

  it('narrows by capability class (one chip)', () => {
    const out = filterModels(SEED, {
      ...EMPTY_FILTERS,
      capabilityClasses: new Set(['fast-draft']),
    });
    expect(out.map((m) => m.id)).toEqual(['cloud-fast']);
  });

  it('search is a case-insensitive substring on id/provider/class', () => {
    const out = filterModels(SEED, { ...EMPTY_FILTERS, search: 'CODER' });
    expect(out.map((m) => m.id)).toEqual(['local-coder']);
  });

  it('combines all filters AND-style (locality + privacy)', () => {
    const out = filterModels(SEED, {
      ...EMPTY_FILTERS,
      localities: new Set(['cloud']),
      privacy: new Set(['sensitive']),
    });
    expect(out.length).toBe(0);
  });

  it('search "" matches all (empty search is a no-op)', () => {
    const out = filterModels(SEED, { ...EMPTY_FILTERS, search: '   ' });
    expect(out.length).toBe(SEED.length);
  });
});

describe('sortByCostAscending', () => {
  it('returns local rows before cloud (local cost is $0)', () => {
    const out = sortByCostAscending(SEED);
    // The two local/on-prem rows + the free cloud row tie at 0; the
    // tie-break is by `id.localeCompare`, deterministic.
    const head = out
      .slice(0, 3)
      .map((m) => m.id)
      .sort();
    expect(head).toEqual(['cloud-fast', 'local-coder', 'onprem-llama']);
    // The cheapest paid row must come right after the free pack.
    expect(out[3]?.id).toBe('cloud-public-only');
    // The most expensive row must come last.
    expect(out[out.length - 1]?.id).toBe('cloud-large');
  });

  it('is stable on price ties — same id always lands in the same slot', () => {
    const a = sortByCostAscending(SEED);
    const b = sortByCostAscending([...SEED].reverse());
    expect(a.map((m) => m.id)).toEqual(b.map((m) => m.id));
  });

  it('does not mutate the input array', () => {
    const original = [...SEED];
    sortByCostAscending(SEED);
    expect(SEED.map((m) => m.id)).toEqual(original.map((m) => m.id));
  });
});

describe('computeLocalityKpis', () => {
  it('counts each locality bucket and computes cloud-vs-local average cost', () => {
    const kpis = computeLocalityKpis(SEED);
    expect(kpis.total).toBe(5);
    expect(kpis.cloud).toBe(3);
    expect(kpis.local).toBe(1);
    expect(kpis.onPrem).toBe(1);
    // cloud avg = (40 + 0 + 11.25) / 3 = 17.0833...
    expect(kpis.avgCloudCost).toBeCloseTo((40 + 0 + 11.25) / 3, 4);
    // local avg = (0 + 0) / 2 = 0
    expect(kpis.avgLocalCost).toBe(0);
  });

  it('returns zeroed KPIs for an empty catalogue', () => {
    const kpis = computeLocalityKpis([]);
    expect(kpis).toEqual({
      total: 0,
      cloud: 0,
      local: 0,
      onPrem: 0,
      avgCloudCost: 0,
      avgLocalCost: 0,
    });
  });
});
