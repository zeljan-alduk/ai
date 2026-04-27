/**
 * Merge discovered local models into a `ModelRegistry`.
 *
 * Conflict policy: YAML entries always win on duplicate id. The
 * operator's hand-curated catalog takes precedence over auto-discovery
 * — discovery only fills in models the operator hasn't already
 * declared.
 *
 * Privacy default: discovered local models default to
 * `privacyAllowed: ['public', 'internal', 'sensitive']`. Local
 * inference is precisely the answer to the sensitive-tier
 * non-negotiable; the operator can tighten this by hand-listing the
 * model in YAML if desired.
 *
 * Capability default: `local-reasoning`. Operators who run a
 * fast-draft local model can override by adding a YAML row with the
 * same id; YAML wins.
 *
 * The merger does NOT mutate the discovered objects — it only calls
 * `registry.register()` for ids that aren't already present.
 */

import type { ModelRegistry, RegisteredModel } from '@aldo-ai/gateway';
import type { DiscoveredModel } from './types.js';

export interface MergeOptions {
  /** Test seam: capture debug-level diagnostics. */
  readonly onDebug?: (msg: string, meta?: Record<string, unknown>) => void;
}

export interface MergeResult {
  /** Number of newly registered (previously unknown) models. */
  readonly added: number;
  /** Ids that were skipped because YAML already had them. */
  readonly skipped: readonly string[];
}

/**
 * Mutate `registry` in place: register every `discovered` model whose
 * id is not already known. Returns a small summary the caller can
 * surface (CLI / health metrics).
 */
export function mergeIntoRegistry(
  registry: ModelRegistry,
  discovered: readonly DiscoveredModel[],
  opts: MergeOptions = {},
): MergeResult {
  const onDebug = opts.onDebug ?? (() => {});
  let added = 0;
  const skipped: string[] = [];
  for (const m of discovered) {
    if (registry.get(m.id) !== undefined) {
      skipped.push(m.id);
      onDebug(`merge: yaml entry wins for ${m.id}`, { source: m.source });
      continue;
    }
    // Strip discovery metadata before handing to the registry — the
    // gateway's RegisteredModel interface does not carry source /
    // discoveredAt, and TypeScript's structural typing would let
    // them through but they have no consumer downstream.
    const { source: _source, discoveredAt: _discoveredAt, ...row } = m;
    void _source;
    void _discoveredAt;
    registry.register(row as RegisteredModel);
    added += 1;
  }
  return { added, skipped };
}

/**
 * Convenience: merge into a brand-new array (rather than a registry).
 * Used by the API route, which builds a list per request and never
 * mutates the YAML-seeded array. YAML rows still win on duplicate id.
 */
export function mergeIntoList<T extends { readonly id: string }>(
  yamlRows: readonly T[],
  discovered: readonly DiscoveredModel[],
): readonly (T | DiscoveredModel)[] {
  const known = new Set(yamlRows.map((r) => r.id));
  const out: (T | DiscoveredModel)[] = [...yamlRows];
  for (const m of discovered) {
    if (known.has(m.id)) continue;
    known.add(m.id);
    out.push(m);
  }
  return out;
}
