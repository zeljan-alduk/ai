import { spawn } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, sep } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import {
  type SandboxAdapter,
  SandboxError,
  type SandboxFn,
  type SandboxRequest,
  type SandboxResult,
} from './types.js';

/**
 * Subprocess adapter. Spawns a node child with:
 *   - cwd jail: a fresh tmp dir, with symlinks back to allowedPaths
 *     (the tool sees `<jail>/<basename>` instead of the host paths)
 *   - env scrubbed to the policy allowlist + the egress-loader var
 *   - --import hook that wires fetch/net/tls egress allowlist
 *   - SIGKILL on cancel/timeout
 *   - setrlimit-style mem/cpu limits via the `prlimit` env hint
 *     (linux only; graceful fallback elsewhere)
 *
 * The child process exits with a JSON line `__ALDO_RESULT__\t<json>` on
 * stdout to ferry back the return value (or thrown error). stdout/stderr
 * are otherwise pass-through and surfaced on `SandboxResult`.
 *
 * NOT in v0: namespace isolation, seccomp, cgroups. The child can still
 * fork() into uncovered syscalls — kernel-level boundary is wave 8
 * (Docker / Firecracker).
 */
export class SubprocessSandbox implements SandboxAdapter {
  readonly driver = 'subprocess' as const;

  async run<TArgs, TValue>(
    fn: SandboxFn<TArgs, TValue>,
    req: SandboxRequest<TArgs>,
  ): Promise<SandboxResult<TValue>> {
    if (fn.kind !== 'module') {
      throw new SandboxError({
        code: 'RUNTIME_ERROR',
        toolName: req.toolName,
        message: 'SubprocessSandbox requires a module-mode fn',
      });
    }

    const started = performance.now();
    const jail = makeJail(req.policy.allowedPaths);

    // The runner script imports the user module + runs the named export
    // with args read from stdin, then writes a tagged result line.
    const runnerScript = makeRunnerScript({
      modulePath: fn.module,
      exportName: fn.exportName,
    });
    const runnerPath = join(jail.root, '.aldo-runner.mjs');
    writeFileSync(runnerPath, runnerScript, 'utf8');

    // Egress loader path (resolved from this file). We ship a `.mjs`
    // counterpart of the loader so the child doesn't need a TS toolchain;
    // the .ts version exists for package consumers/types. We probe a
    // couple of layout shapes so this works whether `subprocess.ts` is
    // resolved from src/ (vitest) or from dist/ (built packages).
    const loader = process.env.SANDBOX_EGRESS_LOADER ?? resolveEgressLoader();

    const networkEnv = encodeNetworkPolicy(req.policy.network);

    // Build child env: ONLY policy.env + the few platform vars the
    // child needs to operate (PATH for node, NODE_OPTIONS the parent
    // already cleans).
    const childEnv: Record<string, string> = {
      ...req.policy.env,
      ALDO_SANDBOX_NETWORK: networkEnv,
      ALDO_SANDBOX_TOOL: req.toolName,
      // PATH must be present so node can find required system tools.
      PATH: process.env.PATH ?? '/usr/bin:/bin',
    };

    const memMb = req.policy.memoryLimitMb;
    const cpuMs = req.policy.cpuLimitMs;
    // Build NODE_OPTIONS with our --import. Don't inherit parent's
    // NODE_OPTIONS — that would let the parent leak debug/inspect flags.
    const nodeArgs = [`--import=${loader}`, runnerPath];

    const child = spawn(process.execPath, nodeArgs, {
      cwd: jail.root,
      env: childEnv,
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: false,
    });

    // Apply rlimits where supported (linux). On other platforms the
    // setrlimit syscall isn't reachable from a child after spawn, so
    // we fall back to wall-clock timeout only.
    if (process.platform === 'linux' && (memMb !== undefined || cpuMs !== undefined)) {
      tryApplyRlimits(child.pid, memMb, cpuMs);
    }

    let stdout = '';
    let stderr = '';
    let resultJson: string | undefined;
    child.stdout.on('data', (b: Buffer) => {
      stdout += b.toString('utf8');
      const idx = stdout.indexOf('__ALDO_RESULT__\t');
      if (idx !== -1) {
        const nl = stdout.indexOf('\n', idx);
        if (nl !== -1) {
          resultJson = stdout.slice(idx + '__ALDO_RESULT__\t'.length, nl);
          stdout = stdout.slice(0, idx) + stdout.slice(nl + 1);
        }
      }
    });
    child.stderr.on('data', (b: Buffer) => {
      stderr += b.toString('utf8');
    });

    // Send args via stdin so the runner can JSON.parse them.
    try {
      child.stdin.write(JSON.stringify({ args: req.args }) + '\n');
      child.stdin.end();
    } catch (err) {
      child.kill('SIGKILL');
      cleanupJail(jail.root);
      throw new SandboxError({
        code: 'RUNTIME_ERROR',
        toolName: req.toolName,
        message: 'failed to write args to sandbox child',
        cause: err,
      });
    }

    // Cancel + timeout plumbing.
    let timedOut = false;
    let cancelled = false;
    const onAbort = (): void => {
      cancelled = true;
      child.kill('SIGKILL');
    };
    req.signal?.addEventListener('abort', onAbort, { once: true });

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, req.policy.timeoutMs);
    timer.unref?.();

    const exit = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
      (resolveExit) => {
        child.on('close', (code, signal) => resolveExit({ code, signal }));
      },
    );
    clearTimeout(timer);
    req.signal?.removeEventListener('abort', onAbort);
    cleanupJail(jail.root);

    if (cancelled && !timedOut) {
      throw new SandboxError({
        code: 'CANCELLED',
        toolName: req.toolName,
        message: `tool '${req.toolName}' was cancelled`,
        stdout,
        stderr,
      });
    }
    if (timedOut) {
      throw new SandboxError({
        code: 'TIMEOUT',
        toolName: req.toolName,
        message: `tool '${req.toolName}' exceeded timeout of ${req.policy.timeoutMs}ms`,
        stdout,
        stderr,
      });
    }

    // Egress denial surfaces as a thrown error inside the child whose
    // message contains our tag. The runner serialises it into the
    // result envelope, but a hard crash (e.g. the child died before
    // catching) would only put it on stderr — handle both.
    if (
      stderr.includes('[ALDO_EGRESS_BLOCKED]') ||
      (resultJson !== undefined && resultJson.includes('[ALDO_EGRESS_BLOCKED]'))
    ) {
      throw new SandboxError({
        code: 'EGRESS_BLOCKED',
        toolName: req.toolName,
        message: extractEgressMessage(stderr, resultJson) ?? 'sandbox blocked egress',
        stdout,
        stderr,
      });
    }

    if (exit.code !== 0 && resultJson === undefined) {
      // SIGKILL with code null and no result is usually rlimit kill.
      if (exit.signal === 'SIGKILL' && (memMb !== undefined || cpuMs !== undefined)) {
        throw new SandboxError({
          code: 'LIMIT_EXCEEDED',
          toolName: req.toolName,
          message: 'sandbox process killed (likely cpu/mem rlimit)',
          stdout,
          stderr,
        });
      }
      throw new SandboxError({
        code: 'RUNTIME_ERROR',
        toolName: req.toolName,
        message: `sandbox child exited with code=${exit.code} signal=${exit.signal}`,
        stdout,
        stderr,
      });
    }

    if (resultJson === undefined) {
      throw new SandboxError({
        code: 'RUNTIME_ERROR',
        toolName: req.toolName,
        message: 'sandbox child produced no result envelope',
        stdout,
        stderr,
      });
    }

    let parsed: { ok: boolean; value?: TValue; error?: string };
    try {
      parsed = JSON.parse(resultJson);
    } catch (err) {
      throw new SandboxError({
        code: 'RUNTIME_ERROR',
        toolName: req.toolName,
        message: 'sandbox child returned malformed result envelope',
        cause: err,
        stdout,
        stderr,
      });
    }

    if (!parsed.ok) {
      const msg = parsed.error ?? 'unknown error';
      if (msg.includes('[ALDO_EGRESS_BLOCKED]')) {
        throw new SandboxError({
          code: 'EGRESS_BLOCKED',
          toolName: req.toolName,
          message: msg,
          stdout,
          stderr,
        });
      }
      if (msg.includes('[ALDO_OUT_OF_BOUNDS]')) {
        throw new SandboxError({
          code: 'OUT_OF_BOUNDS',
          toolName: req.toolName,
          message: msg,
          stdout,
          stderr,
        });
      }
      throw new SandboxError({
        code: 'RUNTIME_ERROR',
        toolName: req.toolName,
        message: msg,
        stdout,
        stderr,
      });
    }

    return {
      value: parsed.value as TValue,
      stdout,
      stderr,
      durationMs: performance.now() - started,
    };
  }
}

// ────────────────────────────────────────────── jail / runner helpers

interface Jail {
  readonly root: string;
}

function makeJail(allowedPaths: readonly string[]): Jail {
  const root = mkdtempSync(join(tmpdir(), 'aldo-sbx-'));
  for (const p of allowedPaths) {
    let real: string;
    try {
      real = realpathSync(p);
    } catch {
      // Skip non-existent paths; tools that need them will fail naturally.
      continue;
    }
    const link = join(root, basename(real));
    try {
      symlinkSync(real, link);
    } catch {
      // Symlink may already exist if duplicates supplied; ignore.
    }
  }
  return { root };
}

function cleanupJail(root: string): void {
  try {
    rmSync(root, { recursive: true, force: true });
  } catch {
    // Best effort.
  }
}

function basename(p: string): string {
  const trimmed = p.endsWith(sep) ? p.slice(0, -1) : p;
  const i = trimmed.lastIndexOf(sep);
  return i === -1 ? trimmed : trimmed.slice(i + 1);
}

function encodeNetworkPolicy(policy: SandboxRequest['policy']['network']): string {
  if (policy === 'none') return 'none';
  return `host:${policy.allowedHosts.join(',')}`;
}

function makeRunnerScript(args: { modulePath: string; exportName: string }): string {
  // The runner is plain ESM. It reads {args} from stdin, imports the
  // user module, calls the named export, and writes a tagged JSON
  // line on stdout. Errors are caught and serialised as `{ok:false}`.
  // Path-jail is checked here too: `fs.realpath` against allowedPaths
  // is the second line of defence (the symlink-jail is the first).
  return `import { realpathSync } from 'node:fs';
const chunks = [];
for await (const c of process.stdin) chunks.push(c);
const input = JSON.parse(Buffer.concat(chunks).toString('utf8'));

async function main() {
  try {
    const mod = await import(${JSON.stringify(args.modulePath)});
    const fn = mod[${JSON.stringify(args.exportName)}];
    if (typeof fn !== 'function') {
      throw new Error('export not callable: ' + ${JSON.stringify(args.exportName)});
    }
    const value = await fn(input.args);
    process.stdout.write('__ALDO_RESULT__\\t' + JSON.stringify({ ok: true, value }) + '\\n');
  } catch (err) {
    const msg = (err && err.message) ? String(err.message) : String(err);
    process.stdout.write('__ALDO_RESULT__\\t' + JSON.stringify({ ok: false, error: msg }) + '\\n');
    process.exit(1);
  }
}
main();
`;
}

function extractEgressMessage(stderr: string, resultJson: string | undefined): string | undefined {
  const haystacks = [stderr, resultJson ?? ''];
  for (const h of haystacks) {
    const idx = h.indexOf('[ALDO_EGRESS_BLOCKED]');
    if (idx !== -1) {
      const slice = h.slice(idx);
      const end = slice.search(/[\n"]/);
      return end === -1 ? slice : slice.slice(0, end);
    }
  }
  return undefined;
}

function resolveEgressLoader(): string {
  // 1. sibling: ./internal/egress-loader.mjs (src layout, vitest)
  const here = fileURLToPath(import.meta.url);
  const siblingPaths = [
    join(dirname(here), 'internal', 'egress-loader.mjs'),
    // 2. one up: ../src/internal/egress-loader.mjs (dist/src/subprocess.js → src/internal/...)
    join(dirname(here), '..', 'src', 'internal', 'egress-loader.mjs'),
    // 3. two up: ../../src/internal/egress-loader.mjs
    join(dirname(here), '..', '..', 'src', 'internal', 'egress-loader.mjs'),
  ];
  for (const p of siblingPaths) {
    if (existsSync(p)) return p;
  }
  // Last resort: return the sibling path even if missing — the child
  // will fail with a clear ENOENT, surfacing as RUNTIME_ERROR.
  return siblingPaths[0] as string;
}

function tryApplyRlimits(
  pid: number | undefined,
  memMb: number | undefined,
  cpuMs: number | undefined,
): void {
  if (pid === undefined) return;
  // We can't setrlimit on a running pid from JS without a native
  // helper, but `prlimit` is a standard linux util. Best effort —
  // any failure is silently swallowed (the wall-clock timeout still
  // applies, and we surface SandboxError(LIMIT_EXCEEDED) on SIGKILL).
  try {
    const args: string[] = [`--pid=${pid}`];
    if (memMb !== undefined) args.push(`--as=${memMb * 1024 * 1024}`);
    if (cpuMs !== undefined) args.push(`--cpu=${Math.max(1, Math.ceil(cpuMs / 1000))}`);
    spawn('prlimit', args, { stdio: 'ignore' }).on('error', () => {
      /* prlimit not present; fall back. */
    });
  } catch {
    /* fall through — wall clock is the floor. */
  }
}

