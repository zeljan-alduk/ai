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

import { type PortScanPreset, scanLocalhostPorts } from './port-scan.js';
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

/**
 * Named-probe registry. `'openai-compat'` is intentionally absent —
 * it's a port-scan output tag, not a runtime with a known default port.
 * `parseDiscoverySources` filters it out at parse time.
 */
const PROBES: Readonly<Record<Exclude<DiscoverySource, 'openai-compat'>, ProbeFn>> = Object.freeze({
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
  /**
   * Localhost port scan, run AFTER the named probes return. `'common'`
   * walks a curated ~60-port list (every default any OpenAI-compatible
   * local engine documents); `'exhaustive'` walks `1024..65535` and
   * takes 10-30 s on a typical laptop. Custom port lists are also
   * accepted. Off by default — port-scanning the loopback interface
   * is cheap but not free.
   *
   * Discovered hosts are tagged `source: 'openai-compat'`. Models
   * already returned by a named probe (matched by base URL) are not
   * re-probed.
   */
  readonly scan?: PortScanPreset | readonly number[];
  /** Per-port timeout for the scan. Default 250 ms. */
  readonly scanTimeoutMs?: number;
  /** Concurrency for the scan. Default 128. */
  readonly scanConcurrency?: number;
  /** Override the scan host. Default `127.0.0.1`. */
  readonly scanHost?: string;
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
  const known = new Set<string>(ALL_SOURCES);
  const out: DiscoverySource[] = [];
  for (const n of names) {
    if (known.has(n) && !out.includes(n as DiscoverySource)) {
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

  const namedSources = sources.filter(
    (s): s is Exclude<DiscoverySource, 'openai-compat'> => s !== 'openai-compat',
  );
  const runs = namedSources.map((source) => {
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
  const named = results.flat();

  // Optional port scan AFTER the named probes return. Skip ports the
  // named probes have already covered (deduped by stripped baseUrl).
  if (opts.scan !== undefined) {
    const skip = new Set(named.map((m) => normaliseBaseUrl(m.providerConfig?.baseUrl)));
    const scanned = await scanLocalhostPorts(opts.scan, {
      ...(opts.scanTimeoutMs !== undefined ? { timeoutMs: opts.scanTimeoutMs } : {}),
      ...(opts.scanConcurrency !== undefined ? { concurrency: opts.scanConcurrency } : {}),
      ...(opts.scanHost !== undefined ? { host: opts.scanHost } : {}),
      ...(opts.fetch !== undefined ? { fetch: opts.fetch } : {}),
      ...(opts.onDebug !== undefined ? { onDebug: opts.onDebug } : {}),
      skipBaseUrls: skip,
    });
    return [...named, ...scanned];
  }
  return named;
}

/**
 * Strip the optional `/v1` suffix and any trailing slash so a named
 * probe's `http://localhost:1234/v1` and a port-scan's
 * `http://127.0.0.1:1234` collide on the same key during dedup.
 *
 * `127.0.0.1` and `localhost` are treated as the same host because the
 * named probes use one and the scan uses the other.
 */
function normaliseBaseUrl(raw: string | undefined): string {
  if (raw === undefined) return '';
  let v = raw.trim();
  if (v.endsWith('/')) v = v.slice(0, -1);
  if (v.endsWith('/v1')) v = v.slice(0, -3);
  v = v.replace('://localhost', '://127.0.0.1');
  return v;
}
