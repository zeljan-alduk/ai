/**
 * aldo-memory — execution policy.
 *
 * Validates every memory call before it touches the filesystem. Layers,
 * applied in order:
 *
 *   1. **Tenant allowlist** — caller-supplied `tenant` must be in
 *      `policy.allowedTenants` (default: only the configured `tenant`).
 *      Operators wiring this server through tool-host should set the
 *      tenant explicitly so a misbehaving agent can't fabricate one.
 *
 *   2. **Scope arity** — `private` requires `agentName`; `session`
 *      requires `runId`; `project` and `org` require neither but may
 *      carry an `agentName` for audit (ignored for key composition).
 *
 *   3. **Key shape** — non-empty, no path separators, no `..`, ≤ 256
 *      chars. Composed key passes through `encodeURIComponent` before
 *      hitting the filesystem so the path layout is predictable.
 *
 *   4. **Retention parse** — when present, must match the ISO 8601
 *      duration grammar (`P[nY][nM][nD][T[nH][nM][nS]]`). Not actively
 *      swept in v0 (the doc's TODO); recorded on the entry.
 *
 * Codes returned via `MemoryError`:
 *   - PERMISSION_DENIED — tenant not allowed, scope/agent mismatch
 *   - INVALID_INPUT     — bad key, retention, scope arity miss
 *   - NOT_FOUND         — read on a missing key (read returns null;
 *                         delete returns ok with deleted: false instead)
 *   - INTERNAL          — anything else
 *
 * No I/O happens here.
 *
 * MISSING_PIECES.md §12.2 / #6.
 */

import { isAbsolute, resolve } from 'node:path';

export type MemoryScope = 'private' | 'project' | 'org' | 'session';

export interface MemoryPolicy {
  /** Absolute, normalised root the JSON store lives under. */
  readonly root: string;
  readonly allowedTenants: readonly string[];
  /** When set, every call's `agentName` must equal this; protects `private` scope. */
  readonly fixedAgentName: string | null;
  /** When set, every call's `runId` must equal this; protects `session` scope. */
  readonly fixedRunId: string | null;
  readonly maxKeyBytes: number;
  readonly maxValueBytes: number;
}

export type MemoryErrorCode =
  | 'PERMISSION_DENIED'
  | 'INVALID_INPUT'
  | 'NOT_FOUND'
  | 'INTERNAL';

export class MemoryError extends Error {
  readonly code: MemoryErrorCode;
  override readonly cause?: unknown;
  constructor(code: MemoryErrorCode, message: string, cause?: unknown) {
    super(message);
    this.name = 'MemoryError';
    this.code = code;
    if (cause !== undefined) this.cause = cause;
  }
  toJSON(): { code: MemoryErrorCode; message: string } {
    return { code: this.code, message: this.message };
  }
}

export interface CreatePolicyOptions {
  readonly root: string;
  readonly allowedTenants: readonly string[];
  readonly fixedAgentName?: string | null;
  readonly fixedRunId?: string | null;
  readonly maxKeyBytes?: number;
  readonly maxValueBytes?: number;
}

export const DEFAULT_MAX_KEY_BYTES = 256;
export const DEFAULT_MAX_VALUE_BYTES = 256 * 1024; // 256 KB

export function createPolicy(opts: CreatePolicyOptions): MemoryPolicy {
  if (!isAbsolute(opts.root)) {
    throw new MemoryError('INVALID_INPUT', `root must be absolute: ${opts.root}`);
  }
  if (opts.allowedTenants.length === 0) {
    throw new MemoryError('INVALID_INPUT', 'allowedTenants must not be empty');
  }
  return {
    root: resolve(opts.root),
    allowedTenants: [...opts.allowedTenants],
    fixedAgentName: opts.fixedAgentName ?? null,
    fixedRunId: opts.fixedRunId ?? null,
    maxKeyBytes: opts.maxKeyBytes ?? DEFAULT_MAX_KEY_BYTES,
    maxValueBytes: opts.maxValueBytes ?? DEFAULT_MAX_VALUE_BYTES,
  };
}

const ISO8601_DURATION = /^P(?!$)(?:\d+Y)?(?:\d+M)?(?:\d+W)?(?:\d+D)?(?:T(?!$)(?:\d+H)?(?:\d+M)?(?:\d+S)?)?$/;

export function assertRetention(retention: string): void {
  if (typeof retention !== 'string' || retention.length === 0) {
    throw new MemoryError('INVALID_INPUT', 'retention must be a non-empty ISO 8601 duration string');
  }
  if (!ISO8601_DURATION.test(retention)) {
    throw new MemoryError(
      'INVALID_INPUT',
      `retention "${retention}" is not a valid ISO 8601 duration (e.g. "P30D", "PT1H")`,
    );
  }
}

export function assertTenant(policy: MemoryPolicy, tenant: string): void {
  if (typeof tenant !== 'string' || tenant.length === 0) {
    throw new MemoryError('INVALID_INPUT', 'tenant must be a non-empty string');
  }
  if (!policy.allowedTenants.includes(tenant)) {
    throw new MemoryError(
      'PERMISSION_DENIED',
      `tenant "${tenant}" is not in the allowlist (${policy.allowedTenants.join(', ')})`,
    );
  }
}

export function assertKey(policy: MemoryPolicy, key: string): void {
  if (typeof key !== 'string' || key.length === 0) {
    throw new MemoryError('INVALID_INPUT', 'key must be a non-empty string');
  }
  if (Buffer.byteLength(key, 'utf8') > policy.maxKeyBytes) {
    throw new MemoryError(
      'INVALID_INPUT',
      `key exceeds ${policy.maxKeyBytes} bytes (got ${Buffer.byteLength(key, 'utf8')})`,
    );
  }
  if (key.includes('..') || key.includes('/') || key.includes('\\') || key.includes('\0')) {
    throw new MemoryError(
      'INVALID_INPUT',
      `key "${key}" contains forbidden characters (.., /, \\, NUL)`,
    );
  }
}

export interface ResolvedScope {
  readonly scope: MemoryScope;
  readonly agentName: string | null;
  readonly runId: string | null;
}

export function resolveScope(
  policy: MemoryPolicy,
  scope: MemoryScope,
  agentName: string | undefined,
  runId: string | undefined,
): ResolvedScope {
  switch (scope) {
    case 'private': {
      if (!agentName || agentName.length === 0) {
        throw new MemoryError(
          'INVALID_INPUT',
          'scope `private` requires `agentName` to disambiguate per-agent state',
        );
      }
      if (policy.fixedAgentName !== null && policy.fixedAgentName !== agentName) {
        throw new MemoryError(
          'PERMISSION_DENIED',
          `agentName "${agentName}" does not match the configured fixedAgentName "${policy.fixedAgentName}"`,
        );
      }
      return { scope, agentName, runId: null };
    }
    case 'session': {
      if (!runId || runId.length === 0) {
        throw new MemoryError(
          'INVALID_INPUT',
          'scope `session` requires `runId` to disambiguate per-run state',
        );
      }
      if (policy.fixedRunId !== null && policy.fixedRunId !== runId) {
        throw new MemoryError(
          'PERMISSION_DENIED',
          `runId "${runId}" does not match the configured fixedRunId "${policy.fixedRunId}"`,
        );
      }
      return { scope, agentName: null, runId };
    }
    case 'project':
    case 'org':
      return { scope, agentName: null, runId: null };
    default:
      throw new MemoryError('INVALID_INPUT', `unknown scope "${scope as string}"`);
  }
}
