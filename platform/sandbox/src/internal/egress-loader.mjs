// Network-egress allowlist enforcer for SubprocessSandbox.
//
// Pure-JS counterpart of egress-loader.ts so the subprocess adapter
// can use `node --import` without requiring a TS toolchain in the
// child. The two files MUST stay behaviourally identical; this is
// the source of truth at runtime, the .ts version is for package
// consumers that want the documented surface and TypeScript types.

import net from 'node:net';
import tls from 'node:tls';

const NETWORK_ENV = process.env.ALDO_SANDBOX_NETWORK ?? 'none';

function parsePolicy(raw) {
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

function isHostAllowed(policy, host) {
  if (policy.mode === 'none') return false;
  const h = host.toLowerCase();
  for (const a of policy.allowed) {
    if (a === '*') return true;
    if (h === a) return true;
    if (h.endsWith(`.${a}`)) return true;
  }
  return false;
}

const POLICY = parsePolicy(NETWORK_ENV);
export const EGRESS_BLOCK_TAG = '[ALDO_EGRESS_BLOCKED]';

function denial(host) {
  return new Error(`${EGRESS_BLOCK_TAG} egress to '${host}' blocked by sandbox policy`);
}

const realFetch = globalThis.fetch;
if (typeof realFetch === 'function') {
  globalThis.fetch = (input, init) => {
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
      // fall through with 'unknown'
    }
    if (!isHostAllowed(POLICY, host)) return Promise.reject(denial(host));
    return realFetch(input, init);
  };
}

const realNetConnect = net.connect.bind(net);
const guardedNetConnect = (...args) => {
  const host = extractHost(args);
  if (!isHostAllowed(POLICY, host)) throw denial(host);
  return realNetConnect(...args);
};
net.connect = guardedNetConnect;
net.createConnection = guardedNetConnect;

const realTlsConnect = tls.connect.bind(tls);
tls.connect = (...args) => {
  const host = extractHost(args);
  if (!isHostAllowed(POLICY, host)) throw denial(host);
  return realTlsConnect(...args);
};

function extractHost(args) {
  for (const a of args) {
    if (a && typeof a === 'object') {
      if (typeof a.host === 'string') return a.host;
      if (typeof a.hostname === 'string') return a.hostname;
      if (typeof a.path === 'string') return a.path;
    }
    if (typeof a === 'string') return a;
  }
  return 'unknown';
}
