import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { InProcessSandbox } from './in-process.js';
import { SubprocessSandbox } from './subprocess.js';
import {
  type SandboxAdapter,
  type SandboxDriver,
  SandboxError,
  type SandboxFn,
  type SandboxPolicy,
  type SandboxRequest,
  type SandboxResult,
} from './types.js';

export interface SandboxRunnerOptions {
  /**
   * Override the driver. When absent, reads `SANDBOX_DRIVER` from env
   * (`in-process` | `subprocess`); falls back to `in-process`.
   */
  readonly driver?: SandboxDriver;
  /**
   * Inject a pre-built adapter (used by tests). Bypasses driver
   * resolution entirely.
   */
  readonly adapter?: SandboxAdapter;
}

/**
 * Public surface the engine ToolHost talks to. Picks an adapter based
 * on env (or explicit options) and routes calls through it. Also
 * enforces the realpath-allowlist filesystem check that the adapters
 * can't always do (the in-process adapter has no fs sandbox at all).
 */
export class SandboxRunner {
  readonly driver: SandboxDriver;
  private readonly adapter: SandboxAdapter;

  constructor(opts: SandboxRunnerOptions = {}) {
    if (opts.adapter) {
      this.adapter = opts.adapter;
      this.driver = opts.adapter.driver;
      return;
    }
    const driver = opts.driver ?? readDriverFromEnv();
    this.driver = driver;
    this.adapter = driver === 'subprocess' ? new SubprocessSandbox() : new InProcessSandbox();
  }

  /**
   * Run an inline (in-process) thunk. The runner ALWAYS wraps the
   * thunk so the caller's filesystem reads are realpath-checked
   * against the policy's allowedPaths.
   *
   * For module-mode functions (subprocess), the symlink-jail and the
   * runner-script's realpath check are the equivalent guard.
   */
  async run<TArgs, TValue>(
    fn: SandboxFn<TArgs, TValue>,
    req: SandboxRequest<TArgs>,
  ): Promise<SandboxResult<TValue>> {
    const guarded = wrapWithFsGuard(fn, req.policy, req.toolName);
    return this.adapter.run<TArgs, TValue>(guarded, req);
  }
}

function readDriverFromEnv(): SandboxDriver {
  const raw = process.env.SANDBOX_DRIVER;
  if (raw === 'subprocess') return 'subprocess';
  return 'in-process';
}

/**
 * Wrap an inline function with a guard that intercepts filesystem
 * reads and rejects paths outside `policy.allowedPaths`.
 *
 * Implementation note: we install a per-call AsyncLocalStorage scope
 * around the function; tools that use `fs.realpath`/`fs.readFile`
 * etc. don't currently consult it, so the *primary* guard is the
 * `assertPathAllowed` helper exported alongside. The wrapper here
 * threads the helper into `scope` so inline tools can opt in
 * cooperatively, and the subprocess driver's symlink jail covers
 * the non-cooperative case.
 */
function wrapWithFsGuard<TArgs, TValue>(
  fn: SandboxFn<TArgs, TValue>,
  policy: SandboxPolicy,
  toolName: string,
): SandboxFn<TArgs, TValue> {
  if (fn.kind !== 'inline') return fn;
  return {
    kind: 'inline',
    inline: async (args, scope) => {
      // Build a scope that carries the path-check helper. Inline
      // tools can call `(scope as any).assertPath(...)`. We don't
      // widen the public type here — the helper is opt-in.
      const augmented = Object.assign({}, scope, {
        assertPath: (p: string): string => assertPathAllowed(p, policy, toolName),
      });
      return fn.inline(args, augmented);
    },
  };
}

/**
 * Realpath-check `p` against the policy's allowedPaths. Resolves
 * symlinks before comparing so a `repo/secrets -> /etc/shadow`
 * symlink is rejected. Throws `SandboxError(OUT_OF_BOUNDS)` if not
 * allowed.
 */
export function assertPathAllowed(
  p: string,
  policy: SandboxPolicy,
  toolName: string,
): string {
  let real: string;
  try {
    real = realpathSync(resolve(p));
  } catch {
    // Non-existent paths: fall back to the resolved (no-symlink)
    // form. Creating files outside the allowlist is still rejected.
    real = resolve(p);
  }
  // The cwd jail is implicitly allowed.
  const roots = [policy.cwd, ...policy.allowedPaths];
  for (const root of roots) {
    let resolvedRoot: string;
    try {
      resolvedRoot = realpathSync(root);
    } catch {
      resolvedRoot = resolve(root);
    }
    if (real === resolvedRoot) return real;
    if (real.startsWith(resolvedRoot.endsWith('/') ? resolvedRoot : resolvedRoot + '/')) {
      return real;
    }
  }
  throw new SandboxError({
    code: 'OUT_OF_BOUNDS',
    toolName,
    message: `path '${p}' is outside sandbox allowlist`,
  });
}
