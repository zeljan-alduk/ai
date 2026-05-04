/**
 * shell.exec — run a single allowlisted command, capture stdout/stderr,
 * enforce a hard timeout, and return a structured result.
 *
 * Privacy: this tool spawns a real OS process. The MCP host that wires
 * it (apps/api/src/mcp/tool-host.ts) is responsible for keeping it
 * disabled by default and gating it behind ALDO_SHELL_ENABLED.
 *
 * Output capture: we keep the full output in memory and return a tail
 * of `policy.outputTailBytes` bytes per stream so a chatty build (10s
 * of MB of npm output) doesn't blow up the model's context window.
 * The full byte counts come back so the model can decide whether the
 * tail is enough.
 *
 * MISSING_PIECES.md #3.
 */

import { spawn } from 'node:child_process';
import { z } from 'zod';
import { type ExecPolicy, ShellError, checkExec } from '../policy.js';

export const execInputSchema = z
  .object({
    command: z
      .string()
      .min(1)
      .describe('Command basename. Must appear in the policy allowlist.'),
    args: z
      .array(z.string())
      .default([])
      .describe('Argv tail. Each entry is passed as one arg, no shell expansion.'),
    cwd: z
      .string()
      .optional()
      .describe('Absolute working directory. Must be inside an allowedRoots entry.'),
    timeoutMs: z
      .number()
      .int()
      .positive()
      .optional()
      .describe('Hard timeout. Capped at policy.maxTimeoutMs; defaults to defaultTimeoutMs.'),
    stdin: z
      .string()
      .optional()
      .describe('Optional bytes to write to the child stdin (then close).'),
    env: z
      .record(z.string())
      .optional()
      .describe('Optional environment variables. Merged onto the host env.'),
  })
  .strict();

export type ExecInput = z.infer<typeof execInputSchema>;

export const execOutputSchema = z
  .object({
    command: z.string(),
    args: z.array(z.string()),
    cwd: z.string(),
    exitCode: z.number().int().nullable(),
    signal: z.string().nullable(),
    timedOut: z.boolean(),
    durationMs: z.number().int().nonnegative(),
    stdout: z.string(),
    stderr: z.string(),
    stdoutBytes: z.number().int().nonnegative(),
    stderrBytes: z.number().int().nonnegative(),
    stdoutTruncated: z.boolean(),
    stderrTruncated: z.boolean(),
  })
  .strict();

export type ExecOutput = z.infer<typeof execOutputSchema>;

export async function shellExec(policy: ExecPolicy, input: ExecInput): Promise<ExecOutput> {
  const resolved = checkExec(policy, {
    command: input.command,
    args: input.args,
    ...(input.cwd !== undefined ? { cwd: input.cwd } : {}),
    ...(input.timeoutMs !== undefined ? { timeoutMs: input.timeoutMs } : {}),
  });

  const start = Date.now();
  return new Promise<ExecOutput>((resolve, reject) => {
    let child;
    try {
      child = spawn(resolved.command, [...resolved.args], {
        cwd: resolved.cwd,
        env: { ...process.env, ...(input.env ?? {}) },
        stdio: ['pipe', 'pipe', 'pipe'],
        // shell: false guarantees no /bin/sh interpretation — args go
        // straight to execvp. Combined with the allowlist + denylist
        // it makes injection through `args[]` impossible.
        shell: false,
      });
    } catch (err) {
      reject(new ShellError('INTERNAL', `spawn failed: ${(err as Error).message}`, err));
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
      // SIGTERM first, then a SIGKILL backstop after a grace window so
      // the child can flush stderr / clean up before being torn down.
      child.kill('SIGTERM');
      setTimeout(() => {
        if (!child.killed) child.kill('SIGKILL');
      }, 2_000);
    }, resolved.timeoutMs);

    child.on('error', (err) => {
      clearTimeout(timer);
      reject(new ShellError('INTERNAL', `child error: ${err.message}`, err));
    });

    child.on('close', (exitCode, signal) => {
      clearTimeout(timer);
      const durationMs = Date.now() - start;
      const stdoutOut = stdoutBuf.length > tail ? stdoutBuf.slice(-tail) : stdoutBuf;
      const stderrOut = stderrBuf.length > tail ? stderrBuf.slice(-tail) : stderrBuf;
      resolve({
        command: resolved.command,
        args: [...resolved.args],
        cwd: resolved.cwd,
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

    if (input.stdin !== undefined) {
      child.stdin?.write(input.stdin);
      child.stdin?.end();
    } else {
      child.stdin?.end();
    }
  });
}
