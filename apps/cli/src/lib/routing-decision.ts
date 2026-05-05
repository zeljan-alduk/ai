/**
 * Hybrid CLI — local-vs-hosted routing decision (MISSING_PIECES §14-A).
 *
 * Pure helper. Given an agent spec + the local provider state + the
 * hosted-API state + an optional explicit user override, return one of:
 *
 *   { mode: 'local' }
 *   { mode: 'hosted' }
 *   { mode: 'error', reason }
 *
 * Decision rules (in order):
 *   1. Explicit override wins. `--local` and `--hosted` short-circuit
 *      capability detection. The override still surfaces an error if
 *      the requested side can't service the agent (e.g. `--hosted`
 *      with no token configured).
 *   2. If a local provider can satisfy the agent's primary or any
 *      fallback capability class, run locally. Local-first is the
 *      LLM-agnostic default — the user already paid for the model.
 *   3. If hosted is configured, delegate. The hosted plane has the
 *      full catalog and can pick a frontier model.
 *   4. Otherwise: error with a hint about how to enable either side.
 *
 * The helper never reads env, never opens a connection, and never
 * touches a provider. The CLI passes in everything it needs; tests
 * exercise the rules in milliseconds.
 *
 * "Local can satisfy" is approximate — the helper trusts the
 * `localCapabilityClasses` set the caller derived from
 * `@aldo-ai/local-discovery`. If discovery missed a model, the user
 * can override with `--local` (and accept whatever fallback resolves)
 * or `--hosted`.
 */

import type { AgentSpec, CapabilityClass } from '@aldo-ai/types';

export type RoutingMode = 'local' | 'hosted';
export type RoutingOverride = 'auto' | RoutingMode;

export interface RoutingInputs {
  readonly spec: AgentSpec;
  /**
   * Capability classes any locally-reachable model advertises. Derived
   * by the caller from `@aldo-ai/local-discovery`'s output.
   */
  readonly localCapabilityClasses: ReadonlySet<CapabilityClass>;
  /** Whether ALDO_API_TOKEN is set (and ALDO_API_URL resolves). */
  readonly hostedEnabled: boolean;
  /** User intent: `auto` defers to the rules; `local`/`hosted` force the side. */
  readonly override: RoutingOverride;
}

export type RoutingDecision =
  | { readonly mode: RoutingMode; readonly reason: string }
  | { readonly mode: 'error'; readonly reason: string };

export function decideRouting(inputs: RoutingInputs): RoutingDecision {
  const { spec, localCapabilityClasses, hostedEnabled, override } = inputs;

  if (override === 'hosted') {
    if (!hostedEnabled) {
      return {
        mode: 'error',
        reason:
          '--hosted requested but ALDO_API_TOKEN is not set. Mint a key at https://ai.aldo.tech/settings/api-keys and export it as ALDO_API_TOKEN.',
      };
    }
    return { mode: 'hosted', reason: 'explicit --hosted override' };
  }

  if (override === 'local') {
    return { mode: 'local', reason: 'explicit --local override' };
  }

  // Auto mode — local-first, fall back to hosted, then error.
  const required = collectRequiredCapabilityClasses(spec);
  const localCanServe = required.some((cls) => localCapabilityClasses.has(cls));
  if (localCanServe) {
    return {
      mode: 'local',
      reason: `local provider satisfies one of [${required.join(', ')}]`,
    };
  }

  // Empty `localCapabilityClasses` means the caller couldn't probe
  // (e.g. ALDO_LOCAL_DISCOVERY unset). Fall through to local rather
  // than over-eagerly delegating — the gateway's router will produce
  // a typed error if no local model actually resolves. This preserves
  // pre-§14-A behaviour for any caller that opts out of probing.
  if (localCapabilityClasses.size === 0) {
    return {
      mode: 'local',
      reason: 'local capability probe was empty — defaulting to local (gateway routes downstream)',
    };
  }

  if (hostedEnabled) {
    return {
      mode: 'hosted',
      reason: `no local provider for [${required.join(', ')}]; delegating to hosted`,
    };
  }

  return {
    mode: 'error',
    reason: `agent '${spec.identity.name}' needs one of [${required.join(', ')}] but no local model advertises any of them and ALDO_API_TOKEN is not set. Either pull a matching local model (e.g. via ollama) or export ALDO_API_TOKEN to delegate to https://ai.aldo.tech.`,
  };
}

/**
 * Primary class first, fallbacks after — preserves the spec's stated
 * preference for downstream display.
 */
export function collectRequiredCapabilityClasses(spec: AgentSpec): CapabilityClass[] {
  const out: CapabilityClass[] = [spec.modelPolicy.primary.capabilityClass];
  for (const f of spec.modelPolicy.fallbacks) {
    if (!out.includes(f.capabilityClass)) out.push(f.capabilityClass);
  }
  return out;
}
