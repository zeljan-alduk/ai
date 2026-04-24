import type {
  Budget,
  CallContext,
  Capability,
  CapabilityClass,
  PrivacyTier,
} from '@meridian/types';
import { providerAllowsTier } from '@meridian/types';
import { NoEligibleModelError } from './errors.js';
import type { ModelRegistry, RegisteredModel } from './model-registry.js';
import { estimateCallCeilingUsd } from './pricing.js';

/**
 * Capability-class aware router. The router is the heart of the provider-
 * agnostic guarantee: it chooses a concrete `RegisteredModel` given only
 * the capability-class, capability set, privacy tier, and budget.
 *
 * Selection pipeline:
 *
 *   1. Collect candidate models from `primaryClass` then each `fallbackClass`
 *      in order. Stop at the first class that yields a match.
 *   2. Filter by `provides ⊇ required`.
 *   3. Filter by `privacyAllowed ⊇ {privacy}`.
 *   4. Filter by `estimateCallCeilingUsd(m, tokensIn, maxOutput) ≤ budget.usdMax + budget.usdGrace`.
 *   5. Prefer models meeting `budget.latencyP95Ms` when set.
 *   6. Pick the cheapest remaining model (by in+out token rate).
 *
 * If every class is exhausted, throw `NoEligibleModelError` (fail closed —
 * never silently downgrade across privacy or capability).
 */

export interface RoutingRequest {
  readonly ctx: CallContext;
  readonly primaryClass: CapabilityClass;
  readonly fallbackClasses?: readonly CapabilityClass[];
  /** Estimated input tokens for this call; used for cost filtering. */
  readonly tokensIn: number;
  /** Upper bound on output tokens for cost ceiling. */
  readonly maxTokensOut: number;
}

export interface RoutingDecision {
  readonly model: RegisteredModel;
  readonly classUsed: CapabilityClass;
  readonly estimatedUsd: number;
}

export interface Router {
  route(req: RoutingRequest): RoutingDecision;
}

export function createRouter(registry: ModelRegistry): Router {
  return {
    route(req) {
      const classes = [req.primaryClass, ...(req.fallbackClasses ?? [])];
      const ctx = req.ctx;

      let lastReason = 'no models registered';
      for (const klass of classes) {
        const candidates = registry.list().filter((m) => m.capabilityClass === klass);
        if (candidates.length === 0) {
          lastReason = `no model registered for class="${klass}"`;
          continue;
        }

        const withCaps = candidates.filter((m) => hasAllCapabilities(m.provides, ctx.required));
        if (withCaps.length === 0) {
          lastReason = `class="${klass}": no model provides required caps [${ctx.required.join(',')}]`;
          continue;
        }

        const withPrivacy = withCaps.filter((m) =>
          providerAllowsTier(m.privacyAllowed, ctx.privacy),
        );
        if (withPrivacy.length === 0) {
          lastReason = `class="${klass}": no model allows privacy="${ctx.privacy}"`;
          continue;
        }

        const withBudget = filterByBudget(withPrivacy, ctx.budget, req);
        if (withBudget.length === 0) {
          lastReason = `class="${klass}": no model within budget usdMax=${ctx.budget.usdMax}`;
          continue;
        }

        const preferred = preferLatency(withBudget, ctx.budget.latencyP95Ms);
        const chosen = pickCheapest(preferred);
        const estimatedUsd = estimateCallCeilingUsd(chosen, req.tokensIn, req.maxTokensOut);
        return { model: chosen, classUsed: klass, estimatedUsd };
      }

      throw new NoEligibleModelError(lastReason, {
        required: ctx.required,
        privacy: ctx.privacy,
      });
    },
  };
}

// ---------------------------------------------------------------------------
// Helpers.

function hasAllCapabilities(
  provided: readonly Capability[],
  required: readonly Capability[],
): boolean {
  if (required.length === 0) return true;
  const set = new Set(provided);
  for (const c of required) if (!set.has(c)) return false;
  return true;
}

function filterByBudget(
  models: readonly RegisteredModel[],
  budget: Budget,
  req: RoutingRequest,
): readonly RegisteredModel[] {
  const ceiling = budget.usdMax + budget.usdGrace;
  const withinBudget = models.filter((m) => {
    const est = estimateCallCeilingUsd(m, req.tokensIn, req.maxTokensOut);
    return est <= ceiling;
  });
  // If usdMax is 0 we're in "local only" mode — enforce locality even if
  // some cloud model happens to round to 0 cost (shouldn't, but be explicit).
  if (budget.usdMax === 0 && budget.usdGrace === 0) {
    return withinBudget.filter((m) => m.locality !== 'cloud');
  }
  return withinBudget;
}

function preferLatency(
  models: readonly RegisteredModel[],
  slo: number | undefined,
): readonly RegisteredModel[] {
  if (!slo) return models;
  const meeting = models.filter((m) => m.latencyP95Ms !== undefined && m.latencyP95Ms <= slo);
  return meeting.length > 0 ? meeting : models; // fall back to full set
}

function pickCheapest(models: readonly RegisteredModel[]): RegisteredModel {
  // Deterministic total order: cost rate ASC, then id ASC to break ties.
  const sorted = [...models].sort((a, b) => {
    const ra = a.cost.usdPerMtokIn + a.cost.usdPerMtokOut;
    const rb = b.cost.usdPerMtokIn + b.cost.usdPerMtokOut;
    if (ra !== rb) return ra - rb;
    return a.id.localeCompare(b.id);
  });
  // Safe: caller guarantees non-empty.
  const first = sorted[0];
  if (!first) {
    throw new Error('internal: pickCheapest received empty list');
  }
  return first;
}

/** Convenience: check feasibility without committing a selection. */
export function isEligible(
  model: RegisteredModel,
  required: readonly Capability[],
  privacy: PrivacyTier,
): boolean {
  return (
    hasAllCapabilities(model.provides, required) &&
    providerAllowsTier(model.privacyAllowed, privacy)
  );
}
