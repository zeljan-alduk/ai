import type { CallContext, Decision, PolicyEngine, PolicyResult } from '@meridian/types';

export type PolicyRule = (
  decision: Decision,
  ctx: CallContext,
) => Promise<PolicyResult | null> | PolicyResult | null;

/**
 * A permissive-by-default PolicyEngine with a pluggable rule chain.
 * The first rule to return a non-null result wins; otherwise the
 * decision is allowed.
 *
 * TODO(v1): Rego/OPA or cedar-go integration lives in a sibling package.
 */
export class RuleChainPolicyEngine implements PolicyEngine {
  constructor(private readonly rules: readonly PolicyRule[] = []) {}

  async check(decision: Decision, ctx: CallContext): Promise<PolicyResult> {
    for (const rule of this.rules) {
      const r = await rule(decision, ctx);
      if (r !== null && r !== undefined) return r;
    }
    return { outcome: 'allow' };
  }

  withRule(rule: PolicyRule): RuleChainPolicyEngine {
    return new RuleChainPolicyEngine([...this.rules, rule]);
  }
}

export function permissivePolicyEngine(): PolicyEngine {
  return new RuleChainPolicyEngine();
}
