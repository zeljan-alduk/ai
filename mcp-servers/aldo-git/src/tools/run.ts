/**
 * Shared spawn helper for git/gh subprocesses.
 *
 * Every tool funnels through `runProcess` so the SIGTERM→SIGKILL grace
 * window, tail-cap, and timeout handling are identical across the
 * surface (mirrors `aldo-shell/exec.ts`). Each caller is responsible
 * for parsing stdout into the typed result it returns.
 *
 * `shell: false` is non-negotiable — args go straight to execvp, no
 * /bin/sh interpretation, so `;`, `|`, `>`, `$()` etc. in args are
 * inert.
 */

import { spawn } from 'node:child_process';
import { type GitPolicy, GitError } from '../policy.js';

export interface RunOpts {
  readonly bin: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly timeoutMs: number;
  readonly stdin?: string;
  readonly env?: Record<string, string>;
}

export interface RunResult {
  readonly bin: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly exitCode: number | null;
  readonly signal: string | null;
  readonly timedOut: boolean;
  readonly durationMs: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly stdoutBytes: number;
  readonly stderrBytes: number;
  readonly stdoutTruncated: boolean;
  readonly stderrTruncated: boolean;
}

export async function runProcess(policy: GitPolicy, opts: RunOpts): Promise<RunResult> {
  const start = Date.now();
  return new Promise<RunResult>((resolve, reject) => {
    let child;
    try {
      child = spawn(opts.bin, [...opts.args], {
        cwd: opts.cwd,
        env: { ...process.env, ...(opts.env ?? {}) },
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: false,
      });
    } catch (err) {
      reject(new GitError('INTERNAL', `spawn failed: ${(err as Error).message}`, err));
      return;
    }

    const tail = policy.outputTailBytes;
    let stdoutBuf = '';
    let stderrBuf = '';
    let stdoutBytes = 0;
    let stderrBytes = 0;

    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => {
      stdoutBytes += Buffer.byteLength(chunk, 'utf8');
      stdoutBuf += chunk;
      if (stdoutBuf.length > tail * 2) stdoutBuf = stdoutBuf.slice(-tail * 2);
    });
    child.stderr?.on('data', (chunk: string) => {
      stderrBytes += Buffer.byteLength(chunk, 'utf8');
      stderrBuf += chunk;
      if (stderrBuf.length > tail * 2) stderrBuf = stderrBuf.slice(-tail * 2);
    });

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      setTimeout(() => {
        if (!child.killed) child.kill('SIGKILL');
      }, 2_000);
    }, opts.timeoutMs);

    child.on('error', (err) => {
      clearTimeout(timer);
      reject(new GitError('INTERNAL', `child error: ${err.message}`, err));
    });

    child.on('close', (exitCode, signal) => {
      clearTimeout(timer);
      const durationMs = Date.now() - start;
      const stdoutOut = stdoutBuf.length > tail ? stdoutBuf.slice(-tail) : stdoutBuf;
      const stderrOut = stderrBuf.length > tail ? stderrBuf.slice(-tail) : stderrBuf;
      resolve({
        bin: opts.bin,
        args: [...opts.args],
        cwd: opts.cwd,
        exitCode: timedOut ? null : exitCode,
        signal: signal ?? null,
        timedOut,
        durationMs,
        stdout: stdoutOut,
        stderr: stderrOut,
        stdoutBytes,
        stderrBytes,
        stdoutTruncated: stdoutBytes > Buffer.byteLength(stdoutOut, 'utf8'),
        stderrTruncated: stderrBytes > Buffer.byteLength(stderrOut, 'utf8'),
      });
    });

    if (opts.stdin !== undefined) {
      child.stdin?.write(opts.stdin);
      child.stdin?.end();
    } else {
      child.stdin?.end();
    }
  });
}

/**
 * Convenience: run a git subcommand and reject on non-zero exit unless
 * the caller declares the exit code as benign. Keeps the per-tool code
 * focused on parsing rather than error plumbing.
 */
export async function runGit(
  policy: GitPolicy,
  cwd: string,
  args: readonly string[],
  options: { timeoutMs?: number; allowExit?: readonly number[] } = {},
): Promise<RunResult> {
  const result = await runProcess(policy, {
    bin: policy.gitBin,
    args,
    cwd,
    timeoutMs: options.timeoutMs ?? policy.defaultTimeoutMs,
  });
  if (result.timedOut) {
    throw new GitError('TIMEOUT', `git ${args[0] ?? '?'} timed out after ${result.durationMs}ms`);
  }
  const allow = new Set(options.allowExit ?? [0]);
  if (result.exitCode === null || !allow.has(result.exitCode)) {
    throw new GitError(
      'INTERNAL',
      `git ${args.join(' ')} exited ${result.exitCode}: ${result.stderr.trim().slice(-512) || result.stdout.trim().slice(-512)}`,
    );
  }
  return result;
}
