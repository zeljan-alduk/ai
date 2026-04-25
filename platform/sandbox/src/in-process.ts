import { performance } from 'node:perf_hooks';
import {
  type SandboxAdapter,
  SandboxError,
  type SandboxFn,
  type SandboxRequest,
  type SandboxResult,
} from './types.js';

/**
 * In-process adapter. Runs the function in the current process, so it
 * provides NO real isolation — the function can still reach the host
 * filesystem and network if it wants to. It's the fallback used in
 * tests and dev when the subprocess driver isn't available.
 *
 * Even so, the adapter enforces:
 *   - wall-clock timeout (Promise.race + AbortController)
 *   - env scrub (the inline fn receives `scope.env`, not `process.env`)
 *   - cancellation (req.signal aborts the internal scope.signal)
 *
 * It does NOT enforce:
 *   - filesystem jail (an inline function can `fs.readFile(...)` outside cwd)
 *   - network egress allowlist
 *   - cpu/memory limits
 *
 * Only use this driver for trusted in-tree tools, tests, and when the
 * platform explicitly accepts the weaker boundary.
 */
export class InProcessSandbox implements SandboxAdapter {
  readonly driver = 'in-process' as const;

  async run<TArgs, TValue>(
    fn: SandboxFn<TArgs, TValue>,
    req: SandboxRequest<TArgs>,
  ): Promise<SandboxResult<TValue>> {
    if (fn.kind !== 'inline') {
      throw new SandboxError({
        code: 'RUNTIME_ERROR',
        toolName: req.toolName,
        message: `InProcessSandbox cannot run module-mode fn (use SubprocessSandbox)`,
      });
    }

    const started = performance.now();

    // Internal controller: aborts when the caller's signal fires OR
    // when the timeout elapses. Inline tools listen on this.
    const internal = new AbortController();
    const onAbort = (): void => internal.abort(req.signal?.reason ?? new Error('cancelled'));
    req.signal?.addEventListener('abort', onAbort, { once: true });

    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        internal.abort(new Error('sandbox timeout'));
        reject(
          new SandboxError({
            code: 'TIMEOUT',
            toolName: req.toolName,
            message: `tool '${req.toolName}' exceeded timeout of ${req.policy.timeoutMs}ms`,
          }),
        );
      }, req.policy.timeoutMs);
      // Don't keep the event loop alive on this timer.
      timer.unref?.();
    });

    const work = (async (): Promise<SandboxResult<TValue>> => {
      try {
        const value = await fn.inline(req.args, {
          env: { ...req.policy.env },
          cwd: req.policy.cwd,
          signal: internal.signal,
        });
        return {
          value,
          stdout: '',
          stderr: '',
          durationMs: performance.now() - started,
        };
      } catch (err) {
        if (req.signal?.aborted || internal.signal.aborted) {
          // Distinguish caller-cancel from timeout: the timeout race
          // settles first if it fired, so reaching here means caller-cancel.
          if (req.signal?.aborted) {
            throw new SandboxError({
              code: 'CANCELLED',
              toolName: req.toolName,
              message: `tool '${req.toolName}' was cancelled`,
              cause: err,
            });
          }
        }
        throw new SandboxError({
          code: 'RUNTIME_ERROR',
          toolName: req.toolName,
          message: err instanceof Error ? err.message : String(err),
          cause: err,
        });
      }
    })();

    try {
      return await Promise.race([work, timeoutPromise]);
    } finally {
      if (timer) clearTimeout(timer);
      req.signal?.removeEventListener('abort', onAbort);
    }
  }
}
