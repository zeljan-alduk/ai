/**
 * Shared fetch helper — applies a per-call timeout via AbortController.
 *
 * The dispatcher already wraps every runner in `Promise.allSettled`
 * with its own timeout, but the runner-level abort lets us return a
 * structured `{ timedOut: true }` envelope instead of a generic
 * `Promise.allSettled` reject. That gives the test-fire endpoint a
 * cleaner UX ("Slack timed out" vs an opaque 500).
 */

import { DEFAULT_DISPATCH_TIMEOUT_MS } from '../types.js';

export async function fetchWithTimeout(
  url: string,
  init: RequestInit & { readonly timeoutMs?: number } = {},
): Promise<Response> {
  const timeoutMs = init.timeoutMs ?? DEFAULT_DISPATCH_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    // Strip our extra `timeoutMs` field before forwarding to fetch —
    // it isn't part of the standard RequestInit and Node would
    // ignore it harmlessly, but keeping the shape clean avoids a
    // TS warning under `exactOptionalPropertyTypes`.
    const { timeoutMs: _ignore, ...rest } = init;
    void _ignore;
    const fetchInit: RequestInit = { ...rest, signal: controller.signal };
    return await fetch(url, fetchInit);
  } finally {
    clearTimeout(timer);
  }
}
