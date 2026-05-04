import { mkdtemp, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { ShellError, createPolicy } from '../src/policy.js';
import { shellExec } from '../src/tools/exec.js';

let root = '';

beforeAll(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'aldo-shell-exec-')));
  await writeFile(join(root, 'hello.js'), "process.stdout.write('hi from node\\n');\n");
});

describe('shellExec — happy path', () => {
  it('captures stdout from a short node script', async () => {
    const p = createPolicy({
      allowedRoots: [root],
      allowedCommands: ['node'],
      defaultTimeoutMs: 10_000,
      maxTimeoutMs: 30_000,
    });
    const out = await shellExec(p, {
      command: 'node',
      args: ['hello.js'],
      cwd: root,
    });
    expect(out.exitCode).toBe(0);
    expect(out.timedOut).toBe(false);
    expect(out.stdout).toBe('hi from node\n');
    expect(out.stdoutBytes).toBe('hi from node\n'.length);
    expect(out.stderr).toBe('');
  });

  it('reports non-zero exit codes without throwing', async () => {
    const p = createPolicy({
      allowedRoots: [root],
      allowedCommands: ['node'],
      defaultTimeoutMs: 10_000,
      maxTimeoutMs: 30_000,
    });
    const out = await shellExec(p, {
      command: 'node',
      args: ['-e', 'process.exit(7)'],
      cwd: root,
    });
    expect(out.exitCode).toBe(7);
    expect(out.timedOut).toBe(false);
  });

  it('forwards stdin', async () => {
    const p = createPolicy({
      allowedRoots: [root],
      allowedCommands: ['node'],
      defaultTimeoutMs: 10_000,
      maxTimeoutMs: 30_000,
    });
    const out = await shellExec(p, {
      command: 'node',
      args: [
        '-e',
        "let d=''; process.stdin.on('data', c => d += c); process.stdin.on('end', () => process.stdout.write(d.toUpperCase()));",
      ],
      cwd: root,
      stdin: 'hello stdin',
    });
    expect(out.exitCode).toBe(0);
    expect(out.stdout).toBe('HELLO STDIN');
  });
});

describe('shellExec — policy enforcement', () => {
  it('rejects a command outside the allowlist with PERMISSION_DENIED', async () => {
    const p = createPolicy({ allowedRoots: [root], allowedCommands: ['node'] });
    await expect(
      shellExec(p, { command: 'rm', args: ['-rf', root], cwd: root }),
    ).rejects.toBeInstanceOf(ShellError);
    await expect(
      shellExec(p, { command: 'rm', args: ['-rf', root], cwd: root }),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
  });

  it('rejects deny-substring even when allowlisted', async () => {
    const p = createPolicy({
      allowedRoots: [root],
      allowedCommands: ['node'],
      deniedSubstrings: ['publish-secret'],
    });
    await expect(
      shellExec(p, {
        command: 'node',
        args: ['-e', 'console.log("publish-secret 42")'],
        cwd: root,
      }),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
  });

  it('rejects cwd outside allowedRoots', async () => {
    const p = createPolicy({ allowedRoots: [root], allowedCommands: ['node'] });
    await expect(
      shellExec(p, { command: 'node', args: ['-v'], cwd: '/tmp' }),
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
  });
});

describe('shellExec — timeout', () => {
  it('kills a long-running child when timeoutMs elapses', async () => {
    const p = createPolicy({
      allowedRoots: [root],
      allowedCommands: ['node'],
      defaultTimeoutMs: 200,
      maxTimeoutMs: 1_000,
    });
    const out = await shellExec(p, {
      command: 'node',
      args: ['-e', 'setInterval(() => {}, 1000);'],
      cwd: root,
      timeoutMs: 200,
    });
    expect(out.timedOut).toBe(true);
    expect(out.exitCode).toBeNull();
    expect(out.durationMs).toBeGreaterThanOrEqual(150);
  });
});

describe('shellExec — output truncation', () => {
  it('truncates stdout to outputTailBytes and reports the full byte count', async () => {
    const p = createPolicy({
      allowedRoots: [root],
      allowedCommands: ['node'],
      defaultTimeoutMs: 10_000,
      maxTimeoutMs: 30_000,
      outputTailBytes: 64,
    });
    const out = await shellExec(p, {
      command: 'node',
      args: ['-e', "process.stdout.write('A'.repeat(2000));"],
      cwd: root,
    });
    expect(out.exitCode).toBe(0);
    expect(out.stdoutBytes).toBe(2000);
    expect(out.stdoutTruncated).toBe(true);
    expect(out.stdout.length).toBeLessThanOrEqual(64);
  });
});
