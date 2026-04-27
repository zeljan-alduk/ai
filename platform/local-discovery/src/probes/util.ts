/**
 * Shared probe helpers.
 *
 * Probes MUST tolerate every possible failure (connection refused,
 * timeout, 404, non-JSON, wrong shape). On any failure they return an
 * empty list and log at debug. We never throw to the caller — discovery
 * is best-effort.
 */

import type { DiscoverySource, ProbeOptions } from '../types.js';

export const DEFAULT_TIMEOUT_MS = 1_000;

export interface FetchJsonResult {
  readonly ok: boolean;
  readonly body?: unknown;
  readonly errorMessage?: string;
}

/**
 * Fetch a JSON document with a hard timeout via AbortSignal.
 *
 * Returns `{ ok: false }` on:
 *   - connection refused / DNS failures / network errors
 *   - non-2xx HTTP status
 *   - timeout (AbortError)
 *   - non-JSON body
 *
 * Never throws.
 */
export async function fetchJsonSafe(
  url: string,
  source: DiscoverySource,
  opts: ProbeOptions,
): Promise<FetchJsonResult> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const fetchImpl = opts.fetch ?? globalThis.fetch;
  const onDebug = opts.onDebug ?? (() => {});

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, {
      method: 'GET',
      headers: { accept: 'application/json' },
      signal: controller.signal,
    });
    if (!res.ok) {
      onDebug(`probe ${source} HTTP ${res.status} from ${url}`);
      return { ok: false, errorMessage: `HTTP ${res.status}` };
    }
    let body: unknown;
    try {
      body = await res.json();
    } catch (err) {
      onDebug(`probe ${source} non-JSON body from ${url}`, {
        error: (err as Error).message,
      });
      return { ok: false, errorMessage: 'non-JSON body' };
    }
    return { ok: true, body };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    onDebug(`probe ${source} fetch failed for ${url}`, { error: message });
    return { ok: false, errorMessage: message };
  } finally {
    clearTimeout(timer);
  }
}

/** Trim a trailing slash from a URL string so we can join cleanly. */
export function trimSlash(s: string): string {
  return s.endsWith('/') ? s.slice(0, -1) : s;
}
