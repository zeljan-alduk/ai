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
});
export type ModelSummary = z.infer<typeof ModelSummary>;

export const ListModelsResponse = z.object({
  models: z.array(ModelSummary),
});
export type ListModelsResponse = z.infer<typeof ListModelsResponse>;
