/**
 * Pure filter logic for /models — extracted so the cards page and the
 * vitest unit tests can both reach it without dragging React into the
 * test environment. LLM-agnostic: every filter operates on opaque
 * strings that come back from `/v1/models`, never on hardcoded
 * provider names.
 */

import type { ListModelsResponse, PrivacyTier } from '@aldo-ai/api-contract';

export type ModelSummary = ListModelsResponse['models'][number];

export interface ModelFilters {
  readonly localities: ReadonlySet<string>;
  readonly privacy: ReadonlySet<PrivacyTier>;
  readonly capabilityClasses: ReadonlySet<string>;
  readonly search: string;
}

export const EMPTY_FILTERS: ModelFilters = Object.freeze({
  localities: new Set<string>(),
  privacy: new Set<PrivacyTier>(),
  capabilityClasses: new Set<string>(),
  search: '',
});

/**
 * Apply the active filter set to a list of models. Empty filter sets
 * match every model — i.e. no filters means "show all". Search is a
 * case-insensitive substring match against `id`, `provider`, and
 * `capabilityClass` (the three fields a user thinks in).
 */
export function filterModels(
  models: ReadonlyArray<ModelSummary>,
  filters: ModelFilters,
): ReadonlyArray<ModelSummary> {
  const q = filters.search.trim().toLowerCase();
  return models.filter((m) => {
    if (filters.localities.size > 0 && !filters.localities.has(m.locality)) return false;
    if (filters.capabilityClasses.size > 0 && !filters.capabilityClasses.has(m.capabilityClass)) {
      return false;
    }
    if (filters.privacy.size > 0) {
      // A model passes if ANY of its `privacyAllowed` tiers is selected
      // (additive — selecting `sensitive` widens the result, doesn't
      // narrow it). This matches what the chip UI implies.
      let any = false;
      for (const t of m.privacyAllowed) {
        if (filters.privacy.has(t)) {
          any = true;
          break;
        }
      }
      if (!any) return false;
    }
    if (q.length > 0) {
      const haystack = `${m.id} ${m.provider} ${m.capabilityClass}`.toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });
}

/**
 * Sort models ascending by `usdPerMtokIn + usdPerMtokOut`. Stable on
 * id so the ordering is deterministic when two models share a price
 * (the Recharts BarChart needs deterministic order between renders or
 * the bars flicker). LOCAL models stack at the bottom because their
 * combined cost is $0; cloud models float to the top.
 */
export function sortByCostAscending(
  models: ReadonlyArray<ModelSummary>,
): ReadonlyArray<ModelSummary> {
  return [...models].sort((a, b) => {
    const ca = a.cost.usdPerMtokIn + a.cost.usdPerMtokOut;
    const cb = b.cost.usdPerMtokIn + b.cost.usdPerMtokOut;
    if (ca !== cb) return ca - cb;
    return a.id.localeCompare(b.id);
  });
}

export interface LocalityKpis {
  readonly total: number;
  readonly cloud: number;
  readonly local: number;
  readonly onPrem: number;
  readonly avgCloudCost: number;
  readonly avgLocalCost: number;
}

/** Top-of-page KPIs over the full catalogue (no filters applied). */
export function computeLocalityKpis(models: ReadonlyArray<ModelSummary>): LocalityKpis {
  let cloud = 0;
  let local = 0;
  let onPrem = 0;
  let cloudCostSum = 0;
  let localCostSum = 0;
  let cloudCount = 0;
  let localCount = 0;
  for (const m of models) {
    const cost = m.cost.usdPerMtokIn + m.cost.usdPerMtokOut;
    if (m.locality === 'cloud') {
      cloud += 1;
      cloudCostSum += cost;
      cloudCount += 1;
    } else if (m.locality === 'on-prem') {
      onPrem += 1;
      localCostSum += cost;
      localCount += 1;
    } else if (m.locality === 'local') {
      local += 1;
      localCostSum += cost;
      localCount += 1;
    }
  }
  return {
    total: models.length,
    cloud,
    local,
    onPrem,
    avgCloudCost: cloudCount === 0 ? 0 : cloudCostSum / cloudCount,
    avgLocalCost: localCount === 0 ? 0 : localCostSum / localCount,
  };
}
