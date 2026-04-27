/**
 * Top-level discovery orchestrator.
 *
 * `discover()` runs every enabled probe in parallel with a per-probe
 * timeout (default 1 s, total budget ≤ 1.5 s) and returns the union of
 * all discovered models. Probes never throw; failures degrade silently
 * to an empty result.
 *
 * Configuration via environment:
 *   ALDO_LOCAL_DISCOVERY=ollama,vllm,llamacpp,lmstudio   (default: all four)
 *   ALDO_LOCAL_DISCOVERY=none                            (disables discovery)
 *
 * The orchestrator is the only place strings like `"ollama"` are mapped
 * to a probe function. Code in platform/gateway and apps/api MUST NOT
 * key off these strings — routing remains capability/privacy/cost
 * driven.
 */

import { probe as llamacppProbe } from './probes/llamacpp.js';
import { probe as lmstudioProbe } from './probes/lmstudio.js';
import { probe as ollamaProbe } from './probes/ollama.js';
import { probe as vllmProbe } from './probes/vllm.js';
import type { DiscoveredModel, DiscoverySource, ProbeOptions } from './types.js';

const ALL_SOURCES = [
  'ollama',
  'vllm',
  'llamacpp',
  'lmstudio',
] as const satisfies readonly DiscoverySource[];

type ProbeFn = (opts?: ProbeOptions) => Promise<readonly DiscoveredModel[]>;

const PROBES: Readonly<Record<DiscoverySource, ProbeFn>> = Object.freeze({
  ollama: ollamaProbe,
  vllm: vllmProbe,
  llamacpp: llamacppProbe,
  lmstudio: lmstudioProbe,
});

export interface DiscoverOptions {
  /** Subset of sources to run. Default: all enabled per env. */
  readonly sources?: readonly DiscoverySource[];
  /** Per-probe timeout in ms. Default 1000. */
  readonly timeoutMs?: number;
  /** Per-source base-URL overrides. */
  readonly baseUrls?: Partial<Readonly<Record<DiscoverySource, string>>>;
  /** Test seam: replace `globalThis.fetch`. */
  readonly fetch?: typeof fetch;
  /** Test seam: capture debug-level diagnostics. */
  readonly onDebug?: (msg: string, meta?: Record<string, unknown>) => void;
  /** Test seam: env source. Defaults to `process.env`. */
  readonly env?: Readonly<Record<string, string | undefined>>;
}

/**
 * Parse the ALDO_LOCAL_DISCOVERY env var into a set of probe sources.
 *
 * - unset / empty -> all four sources
 * - "none" (case-insensitive) -> no sources
 * - comma-separated list of known source names -> exact subset
 *
 * Unknown tokens are silently dropped (forward-compatible if an
 * operator adds e.g. "mlx" before this package learns about it).
 */
export function parseDiscoverySources(raw: string | undefined): readonly DiscoverySource[] {
  if (raw === undefined) return ALL_SOURCES;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return ALL_SOURCES;
  if (trimmed.toLowerCase() === 'none') return [];
  const names = trimmed
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0);
  const known = new Set<DiscoverySource>(ALL_SOURCES);
  const out: DiscoverySource[] = [];
  for (const n of names) {
    if (known.has(n as DiscoverySource) && !out.includes(n as DiscoverySource)) {
      out.push(n as DiscoverySource);
    }
  }
  return out;
}

/**
 * Run every enabled probe in parallel and return the union of results.
 *
 * Latency budget: each probe has a 1 s default timeout. Because they
 * run concurrently the total wall-clock is bounded by
 * `max(timeoutMs)` rather than the sum, so the 1.5 s overall budget
 * the spec asks for is comfortably met.
 */
export async function discover(opts: DiscoverOptions = {}): Promise<readonly DiscoveredModel[]> {
  const env = opts.env ?? process.env;
  const sources = opts.sources ?? parseDiscoverySources(env.ALDO_LOCAL_DISCOVERY);
  if (sources.length === 0) return [];

  const probeOptsBase: Omit<ProbeOptions, 'baseUrl'> = {
    ...(opts.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}),
    ...(opts.fetch !== undefined ? { fetch: opts.fetch } : {}),
    ...(opts.onDebug !== undefined ? { onDebug: opts.onDebug } : {}),
  };

  const runs = sources.map((source) => {
    const baseUrl = opts.baseUrls?.[source];
    const probeOpts: ProbeOptions = {
      ...probeOptsBase,
      ...(baseUrl !== undefined ? { baseUrl } : {}),
    };
    // Defensive: a probe should never throw, but if a future probe
    // mishandles an exception we still want to return [] for that
    // source rather than fail the whole discover() call.
    return PROBES[source](probeOpts).catch((err: unknown) => {
      const onDebug = opts.onDebug ?? (() => {});
      onDebug(`probe ${source} threw — treating as empty`, {
        error: err instanceof Error ? err.message : String(err),
      });
      return [] as readonly DiscoveredModel[];
    });
  });

  const results = await Promise.all(runs);
  return results.flat();
}
