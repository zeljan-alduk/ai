import type { AgentSpec, PrivacyTier } from '@aldo-ai/types';
import { PRIVACY_LEVEL } from '@aldo-ai/types';

/**
 * Cascade the parent's privacy tier into a child spec.
 *
 * Rule (from the wave-9 brief): "every child run inherits the parent's
 * privacy_tier UNLESS the child's spec declares its own (and only
 * widening to a stricter tier is allowed; never relaxing)."
 *
 * We treat `sensitive > internal > public` as the strictness ordering.
 * If a child spec declares its own tier, we use that ONLY if it is at
 * least as strict as the parent's; otherwise the parent wins.
 *
 * Returns the resolved tier the orchestrator must use when constructing
 * the child run's CallContext.
 */
export function resolveChildPrivacy(parentTier: PrivacyTier, childSpec: AgentSpec): PrivacyTier {
  const childTier = childSpec.modelPolicy.privacyTier;
  // The child can only WIDEN (= become more strict). max(parent, child).
  if (PRIVACY_LEVEL[childTier] >= PRIVACY_LEVEL[parentTier]) return childTier;
  return parentTier;
}
