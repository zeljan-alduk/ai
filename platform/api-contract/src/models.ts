import { z } from 'zod';
import { PrivacyTier } from './common.js';

export const ModelSummary = z.object({
  id: z.string(),
  provider: z.string(),
  /** cloud | on-prem | local — opaque string to keep the contract
   *  provider-agnostic. */
  locality: z.string(),
  capabilityClass: z.string(),
  provides: z.array(z.string()),
  privacyAllowed: z.array(PrivacyTier),
  cost: z.object({
    usdPerMtokIn: z.number().nonnegative(),
    usdPerMtokOut: z.number().nonnegative(),
  }),
  latencyP95Ms: z.number().int().nonnegative().optional(),
  effectiveContextTokens: z.number().int().nonnegative(),
  /** True if a provider key for this model is configured server-side. */
  available: z.boolean(),
  /**
   * Wave 12 — last time the platform probed this model's health surface.
   * For cloud rows this just reflects the env-var check timestamp; for
   * local rows we ping `${baseUrl}/v1/models` (or `${baseUrl}/health`
   * for `mlx`) on a 60-second cache. Optional/additive so older
   * servers can omit it without breaking the wire.
   */
  lastProbedAt: z.string().optional(),
});
export type ModelSummary = z.infer<typeof ModelSummary>;

export const ListModelsResponse = z.object({
  models: z.array(ModelSummary),
});
export type ListModelsResponse = z.infer<typeof ListModelsResponse>;

/**
 * Wave 12 — `GET /v1/models/savings`.
 *
 * Aggregates the caller's tenant's `usage_records` over `period` and,
 * for each row that ran on a local-locality model, computes the cost
 * the run would have incurred on the cheapest cloud model in the same
 * `capability_class` (the router's *equivalent* surface). Rows where no
 * equivalent cloud model exists in the catalog DO NOT contribute to
 * `totalSavedUsd` — the math has to be honest or the number is worse
 * than useless. `dailySavings` is a 30-bucket sparkline (newest last).
 *
 * Cross-tenant safe: every read is scoped to `c.var.auth.tenantId`.
 */
export const SavingsPeriod = z.enum(['7d', '30d', '90d']);
export type SavingsPeriod = z.infer<typeof SavingsPeriod>;

export const SavingsQuery = z.object({
  period: SavingsPeriod.default('30d'),
});
export type SavingsQuery = z.infer<typeof SavingsQuery>;

export const SavingsResponse = z.object({
  /** Window the response covers. */
  period: SavingsPeriod,
  /**
   * Total dollars-saved over `period`. Only counts rows whose local
   * model had a genuinely-equivalent cloud model in the live catalog.
   */
  totalSavedUsd: z.number().nonnegative(),
  /** How many local-model usage rows contributed to the figure. */
  localRunCount: z.number().int().nonnegative(),
  /** How many usage rows were skipped because no equivalent existed. */
  unmatchedLocalRunCount: z.number().int().nonnegative(),
  /**
   * Daily sparkline (oldest -> newest). Length matches the period in
   * days; empty days are emitted as `0` so the UI doesn't have to
   * forward-fill.
   */
  dailySavings: z.array(
    z.object({
      date: z.string(), // YYYY-MM-DD
      savedUsd: z.number().nonnegative(),
    }),
  ),
});
export type SavingsResponse = z.infer<typeof SavingsResponse>;

// ---------------------------------------------------------------------------
// Wave 12 — `GET /v1/observability/summary`.
//
// One round-trip for the /observability page header. KPIs are computed
// over `period` against `usage_records` + `run_events` + `runs`, all
// tenant-scoped. Counts that should structurally always be zero (privacy
// tier mismatches) are surfaced explicitly so the page can render the
// "0 — that's the point" copy.
// ---------------------------------------------------------------------------

export const ObservabilityPeriod = z.enum(['24h', '7d', '30d']);
export type ObservabilityPeriod = z.infer<typeof ObservabilityPeriod>;

export const ObservabilityQuery = z.object({
  period: ObservabilityPeriod.default('24h'),
});
export type ObservabilityQuery = z.infer<typeof ObservabilityQuery>;

export const PrivacyRouterEvent = z.object({
  at: z.string(),
  runId: z.string(),
  agentName: z.string(),
  model: z.string(),
  provider: z.string(),
  classUsed: z.string(),
  /** Always true today — the audit row is only emitted on enforced approvals. */
  enforced: z.boolean(),
});
export type PrivacyRouterEvent = z.infer<typeof PrivacyRouterEvent>;

export const SafetyEvent = z.object({
  at: z.string(),
  runId: z.string(),
  agentName: z.string().nullable(),
  /** `sandbox_block` | `guards_block` | `tier_mismatch`. */
  kind: z.string(),
  /** Stable code (e.g. `OUT_OF_BOUNDS`, `output_scanner`, `quarantine`). */
  reason: z.string(),
  severity: z.enum(['info', 'warn', 'error']),
});
export type SafetyEvent = z.infer<typeof SafetyEvent>;

export const LocalityBreakdown = z.object({
  locality: z.string(),
  usd: z.number().nonnegative(),
  runCount: z.number().int().nonnegative(),
});
export type LocalityBreakdown = z.infer<typeof LocalityBreakdown>;

export const ModelBreakdown = z.object({
  model: z.string(),
  provider: z.string(),
  locality: z.string(),
  agentName: z.string(),
  runCount: z.number().int().nonnegative(),
  usd: z.number().nonnegative(),
});
export type ModelBreakdown = z.infer<typeof ModelBreakdown>;

export const ObservabilitySummary = z.object({
  period: ObservabilityPeriod,
  generatedAt: z.string(),
  kpis: z.object({
    eventsPerSec: z.number().nonnegative(),
    runsInFlight: z.number().int().nonnegative(),
    cloudSpendUsd: z.number().nonnegative(),
    localSpendUsd: z.number().nonnegative(),
    sandboxBlocks24h: z.number().int().nonnegative(),
    guardsBlocks24h: z.number().int().nonnegative(),
    /** Should be 0 — we surface it so the page can trumpet the safety story. */
    privacyTierMismatches24h: z.number().int().nonnegative(),
  }),
  privacyRouterEvents: z.array(PrivacyRouterEvent),
  safetyEvents: z.array(SafetyEvent),
  localityBreakdown: z.array(LocalityBreakdown),
  modelBreakdown: z.array(ModelBreakdown),
});
export type ObservabilitySummary = z.infer<typeof ObservabilitySummary>;
