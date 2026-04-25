/**
 * Network-egress allowlist enforcer for SubprocessSandbox.
 *
 * Loaded into the child via `node --import <this>`. Wraps `globalThis.fetch`
 * (which Node implements on top of undici) and patches `node:net` /
 * `node:tls` so raw socket connects can't bypass it. Together these
 * cover every common egress route a tool might use: fetch, http(s)
 * (which goes via net), websocket libs (also via net), and bare
 * tls.connect handshakes.
 *
 * Allowed hosts come from `ALDO_SANDBOX_NETWORK` in the scrubbed env:
 *   - `none`           — block everything
 *   - `host:a.com,b.com` — exact-match or subdomain
 *
 * Localhost (127.0.0.1, ::1, localhost) is denied unless explicitly
 * listed; the parent talks to the child over stdio, never sockets.
 *
 * On denial we throw an Error tagged with [ALDO_EGRESS_BLOCKED]; the
 * parent inspects child stderr / exit code for that tag and surfaces
 * a `SandboxError(EGRESS_BLOCKED)`.
 */

import net from 'node:net';
import tls from 'node:tls';

const NETWORK_ENV = process.env.ALDO_SANDBOX_NETWORK ?? 'none';

interface EgressPolicy {
  readonly mode: 'none' | 'allowlist';
  readonly allowed: readonly string[];
}

function parsePolicy(raw: string): EgressPolicy {
  if (raw === 'none' || raw === '') return { mode: 'none', allowed: [] };
  if (raw.startsWith('host:')) {
    const allowed = raw
      .slice('host:'.length)
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter((s) => s.length > 0);
    return { mode: 'allowlist', allowed };
  }
  return { mode: 'none', allowed: [] };
}

function isHostAllowed(policy: EgressPolicy, host: string): boolean {
  if (policy.mode === 'none') return false;
  const h = host.toLowerCase();
  for (const a of policy.allowed) {
    if (h === a) return true;
    if (h.endsWith(`.${a}`)) return true;
  }
  return false;
}

const POLICY = parsePolicy(NETWORK_ENV);

export const EGRESS_BLOCK_TAG = '[ALDO_EGRESS_BLOCKED]';

function denial(host: string): Error {
  return new Error(`${EGRESS_BLOCK_TAG} egress to '${host}' blocked by sandbox policy`);
}

// ─────────────────────────────────────────────────── fetch wrapper
// Node's global fetch is undici under the hood. Wrapping at this layer
// covers the modern code path; the net/tls patches below catch
// everything below it.

type FetchInput = string | URL | { url: string };
const realFetch = globalThis.fetch;
if (typeof realFetch === 'function') {
  const wrapper = (input: FetchInput, init?: RequestInit): Promise<Response> => {
    let host = 'unknown';
    try {
      const u =
        typeof input === 'string'
          ? new URL(input)
          : input instanceof URL
            ? input
            : new URL(input.url);
      host = u.hostname;
    } catch {
      // fall through with 'unknown' — denied unless allowed.
    }
    if (!isHostAllowed(POLICY, host)) {
      return Promise.reject(denial(host));
    }
    return (realFetch as (i: FetchInput, init?: RequestInit) => Promise<Response>)(input, init);
  };
  (globalThis as unknown as { fetch: unknown }).fetch = wrapper;
}

// ─────────────────────────────────────────────── net / tls patching
// Catches `http(s)` (built on net), websocket libs (built on net),
// and any bare `net.connect` / `tls.connect` callers.

const realNetConnect = net.connect.bind(net);
const guardedNetConnect = (...args: unknown[]): unknown => {
  const host = extractHost(args);
  if (!isHostAllowed(POLICY, host)) throw denial(host);
  return (realNetConnect as (...a: unknown[]) => unknown)(...args);
};
(net as unknown as { connect: unknown }).connect = guardedNetConnect;
(net as unknown as { createConnection: unknown }).createConnection = guardedNetConnect;

const realTlsConnect = tls.connect.bind(tls);
const guardedTlsConnect = (...args: unknown[]): unknown => {
  const host = extractHost(args);
  if (!isHostAllowed(POLICY, host)) throw denial(host);
  return (realTlsConnect as (...a: unknown[]) => unknown)(...args);
};
(tls as unknown as { connect: unknown }).connect = guardedTlsConnect;

function extractHost(args: readonly unknown[]): string {
  for (const a of args) {
    if (a && typeof a === 'object') {
      const o = a as Record<string, unknown>;
      if (typeof o.host === 'string') return o.host;
      if (typeof o.hostname === 'string') return o.hostname;
      if (typeof o.path === 'string') return o.path;
    }
    if (typeof a === 'string') return a;
  }
  return 'unknown';
}
