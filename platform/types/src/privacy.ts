/**
 * Privacy tiers. The router is fail-closed: sensitive data cannot reach a
 * model whose provider is not allowed for that tier.
 */

export const PRIVACY_TIERS = ['public', 'internal', 'sensitive'] as const;
export type PrivacyTier = (typeof PRIVACY_TIERS)[number];

/** Higher number = more restrictive. Used to propagate taints. */
export const PRIVACY_LEVEL: Record<PrivacyTier, number> = {
  public: 0,
  internal: 1,
  sensitive: 2,
};

/** Taint propagation: max of current and incoming. */
export function mergeTier(a: PrivacyTier, b: PrivacyTier): PrivacyTier {
  return PRIVACY_LEVEL[a] >= PRIVACY_LEVEL[b] ? a : b;
}

/** Checks whether a provider that allows `allowed` tiers may serve `required`. */
export function providerAllowsTier(
  allowed: readonly PrivacyTier[],
  required: PrivacyTier,
): boolean {
  return allowed.includes(required);
}
