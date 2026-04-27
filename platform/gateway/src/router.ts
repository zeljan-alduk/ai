import type { Budget, CallContext, Capability, CapabilityClass, PrivacyTier } from '@aldo-ai/types';
import { providerAllowsTier } from '@aldo-ai/types';
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
  /**
   * Read-only routing simulation. Mirrors `route()`'s pipeline but
   * returns a structured trace of every class tried — how many candidates
   * pre/post each filter step, and which model would have been picked.
   *
   * The CLI's `aldo agents check` and the control-plane API's
   * `POST /v1/agents/:name/check` endpoint both render this. It is
   * deliberately the same shape on both surfaces so an operator can
   * diff dry-run output between dev and prod without reformatting.
   *
   * Never mutates state; never calls a provider.
   */
  simulate(req: RoutingRequest): RoutingSimulation;
}

/** A single class' worth of filter outcomes during a simulation. */
export interface ClassTrace {
  readonly capabilityClass: CapabilityClass;
  readonly preFilter: number;
  readonly passCapability: number;
  readonly passPrivacy: number;
  readonly passBudget: number;
  /** The chosen model id, or null when no candidate survived this class. */
  readonly chosen: string | null;
  /** Human-readable reason this class was rejected (set when `chosen === null`). */
  readonly reason: string | null;
}

export interface RoutingSimulation {
  readonly ok: boolean;
  /** When ok=true, the decision; otherwise null. */
  readonly decision: RoutingDecision | null;
  /** Ordered trace; first entry is the primary class. */
  readonly trace: readonly ClassTrace[];
  /**
   * When ok=false, an aggregated failure reason matching the last class'
   * outcome (mirrors `NoEligibleModelError.reason` for parity).
   */
  readonly reason: string | null;
}

export function createRouter(registry: ModelRegistry): Router {
  function simulate(req: RoutingRequest): RoutingSimulation {
    const classes = [req.primaryClass, ...(req.fallbackClasses ?? [])];
    const ctx = req.ctx;
    const trace: ClassTrace[] = [];
    let lastReason = 'no models registered';

    for (const klass of classes) {
      const candidates = registry.list().filter((m) => m.capabilityClass === klass);
      if (candidates.length === 0) {
        lastReason = `no model registered for class="${klass}"`;
        trace.push({
          capabilityClass: klass,
          preFilter: 0,
          passCapability: 0,
          passPrivacy: 0,
          passBudget: 0,
          chosen: null,
          reason: lastReason,
        });
        continue;
      }
      const withCaps = candidates.filter((m) => hasAllCapabilities(m.provides, ctx.required));
      if (withCaps.length === 0) {
        lastReason = `class="${klass}": no model provides required caps [${ctx.required.join(',')}]`;
        trace.push({
          capabilityClass: klass,
          preFilter: candidates.length,
          passCapability: 0,
          passPrivacy: 0,
          passBudget: 0,
          chosen: null,
          reason: lastReason,
        });
        continue;
      }
      const withPrivacy = withCaps.filter((m) => providerAllowsTier(m.privacyAllowed, ctx.privacy));
      if (withPrivacy.length === 0) {
        lastReason = `class="${klass}": no model allows privacy="${ctx.privacy}"`;
        trace.push({
          capabilityClass: klass,
          preFilter: candidates.length,
          passCapability: withCaps.length,
          passPrivacy: 0,
          passBudget: 0,
          chosen: null,
          reason: lastReason,
        });
        continue;
      }
      const withBudget = filterByBudget(withPrivacy, ctx.budget, req);
      if (withBudget.length === 0) {
        lastReason = `class="${klass}": no model within budget usdMax=${ctx.budget.usdMax}`;
        trace.push({
          capabilityClass: klass,
          preFilter: candidates.length,
          passCapability: withCaps.length,
          passPrivacy: withPrivacy.length,
          passBudget: 0,
          chosen: null,
          reason: lastReason,
        });
        continue;
      }
      const preferred = preferLatency(withBudget, ctx.budget.latencyP95Ms);
      const chosen = pickCheapest(preferred);
      const estimatedUsd = estimateCallCeilingUsd(chosen, req.tokensIn, req.maxTokensOut);
      trace.push({
        capabilityClass: klass,
        preFilter: candidates.length,
        passCapability: withCaps.length,
        passPrivacy: withPrivacy.length,
        passBudget: withBudget.length,
        chosen: chosen.id,
        reason: null,
      });
      return {
        ok: true,
        decision: { model: chosen, classUsed: klass, estimatedUsd },
        trace,
        reason: null,
      };
    }

    return { ok: false, decision: null, trace, reason: lastReason };
  }

  return {
    route(req) {
      const sim = simulate(req);
      if (sim.ok && sim.decision !== null) return sim.decision;
      throw new NoEligibleModelError(sim.reason ?? 'no models registered', {
        required: req.ctx.required,
        privacy: req.ctx.privacy,
      });
    },
    simulate,
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
