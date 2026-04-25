/**
 * @aldo-ai/sandbox — isolation boundary for tool calls.
 *
 * The engine's ToolHost wraps every native + MCP tool invocation in a
 * SandboxRunner. The runner picks an adapter — in-process (no real
 * isolation; tests + dev) or subprocess (cwd jail, env scrub, network
 * allowlist, rlimit cpu/mem) — and enforces the AgentSpec-derived
 * SandboxPolicy.
 *
 * v0 explicitly defers container-grade isolation (namespaces, seccomp)
 * to wave 8 (Docker / Firecracker).
 */

export { InProcessSandbox } from './in-process.js';
export { SubprocessSandbox } from './subprocess.js';
export { buildPolicy, isHostAllowed } from './policy.js';
export type { BuildPolicyArgs } from './policy.js';
export { SandboxRunner, assertPathAllowed } from './runner.js';
export type { SandboxRunnerOptions } from './runner.js';
export {
  SandboxError,
  type SandboxAdapter,
  type SandboxDriver,
  type SandboxErrorCode,
  type SandboxFn,
  type SandboxNetworkPolicy,
  type SandboxPolicy,
  type SandboxRequest,
  type SandboxResult,
  type SandboxScope,
} from './types.js';
