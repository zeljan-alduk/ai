import type { Capability, CapabilityClass } from './capabilities.js';
import type { PrivacyTier } from './privacy.js';

export type ProviderLocality = 'cloud' | 'on-prem' | 'local';

export interface ProviderPricing {
  /** USD per million input tokens. 0 means free (local). */
  readonly usdPerMtokIn: number;
  /** USD per million output tokens. 0 means free (local). */
  readonly usdPerMtokOut: number;
  /** USD per million cache read tokens (when supported). */
  readonly usdPerMtokCacheRead?: number;
  /** USD per million cache write tokens (when supported). */
  readonly usdPerMtokCacheWrite?: number;
}

export interface ModelDescriptor {
  readonly id: string;
  readonly provider: string;
  readonly locality: ProviderLocality;
  readonly provides: readonly Capability[];
  readonly cost: ProviderPricing;
  readonly latencyP95Ms?: number;
  readonly privacyAllowed: readonly PrivacyTier[];
  readonly capabilityClass: CapabilityClass;
  /** Effective usable context window (not advertised — measured). */
  readonly effectiveContextTokens: number;
}
