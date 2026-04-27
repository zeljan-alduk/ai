import type { AgentSpec } from '@aldo-ai/types';
import type { SandboxNetworkPolicy, SandboxPolicy } from './types.js';

/**
 * Translate an AgentSpec's `tools.permissions` block into a typed
 * SandboxPolicy. Defaults are deliberately restrictive: if the spec
 * doesn't specify, the tool gets nothing.
 *
 * This is the only place that interprets `permissions.network` and
 * `permissions.filesystem` for sandboxing. Anywhere else in the engine
 * that needs to enforce these MUST go through the SandboxPolicy
 * shape — the spec strings ('repo-readonly' etc.) are not contracts.
 */

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MEM_MB = 512;
const DEFAULT_CPU_MS = 30_000;

export interface BuildPolicyArgs {
  readonly spec: AgentSpec;
  /**
   * The repo root for `repo-readonly`/`repo-readwrite` permissions.
   * If absent, those permissions resolve to no allowed paths.
   */
  readonly repoRoot?: string;
  /**
   * Cwd jail directory. Adapters MAY ignore this (the subprocess
   * adapter mints its own ephemeral jail) but it's surfaced for
   * tooling that wants a stable working dir.
   */
  readonly cwd?: string;
  /**
   * Hosts the agent is allowed to reach when `permissions.network` is
   * `'allowlist'`. Read from runtime config in production; tests pass
   * in directly.
   */
  readonly allowedHosts?: readonly string[];
  /**
   * Env vars the agent may see. Defaults to an empty object — callers
   * MUST opt into the variables a tool needs (PATH is added by the
   * subprocess adapter automatically).
   */
  readonly env?: Readonly<Record<string, string>>;
  readonly timeoutMs?: number;
  readonly memoryLimitMb?: number;
  readonly cpuLimitMs?: number;
}

export function buildPolicy(args: BuildPolicyArgs): SandboxPolicy {
  const perms = args.spec.tools.permissions;
  const allowedPaths = resolveAllowedPaths(perms.filesystem, args.repoRoot);
  const network = resolveNetwork(perms.network, args.allowedHosts ?? []);
  const cwd = args.cwd ?? args.repoRoot ?? process.cwd();
  return {
    cwd,
    allowedPaths,
    env: args.env ?? {},
    network,
    timeoutMs: args.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    ...(args.memoryLimitMb !== undefined
      ? { memoryLimitMb: args.memoryLimitMb }
      : { memoryLimitMb: DEFAULT_MEM_MB }),
    ...(args.cpuLimitMs !== undefined
      ? { cpuLimitMs: args.cpuLimitMs }
      : { cpuLimitMs: DEFAULT_CPU_MS }),
  };
}

function resolveAllowedPaths(
  fs: AgentSpec['tools']['permissions']['filesystem'],
  repoRoot: string | undefined,
): readonly string[] {
  switch (fs) {
    case 'none':
      return [];
    case 'repo-readonly':
    case 'repo-readwrite':
      return repoRoot ? [repoRoot] : [];
    case 'full':
      // 'full' still goes through the sandbox, but allowedPaths is
      // the host root. Production should NEVER allow this; the
      // gateway/registry's promotion gate is the safety net.
      return ['/'];
    default:
      return [];
  }
}

function resolveNetwork(
  net: AgentSpec['tools']['permissions']['network'],
  allowedHosts: readonly string[],
): SandboxNetworkPolicy {
  switch (net) {
    case 'none':
      return 'none';
    case 'allowlist':
      return { allowedHosts };
    case 'full':
      // 'full' is implemented as a wildcard subdomain match on the
      // empty TLD — i.e. every host. Same caveat as 'full' fs.
      return { allowedHosts: allowedHosts.length > 0 ? allowedHosts : ['*'] };
    default:
      return 'none';
  }
}

/** Helper: is a hostname permitted by this policy? */
export function isHostAllowed(policy: SandboxNetworkPolicy, host: string): boolean {
  if (policy === 'none') return false;
  const h = host.toLowerCase();
  for (const a of policy.allowedHosts) {
    if (a === '*') return true;
    if (h === a) return true;
    if (h.endsWith(`.${a}`)) return true;
  }
  return false;
}
