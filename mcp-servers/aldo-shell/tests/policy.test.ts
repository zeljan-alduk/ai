import { mkdtemp, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { ShellError, checkExec, createPolicy } from '../src/policy.js';

let root = '';

beforeAll(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'aldo-shell-policy-')));
});

describe('createPolicy', () => {
  it('rejects empty allowedRoots', () => {
    expect(() => createPolicy({ allowedRoots: [] })).toThrow(ShellError);
  });

  it('rejects relative root paths', () => {
    expect(() => createPolicy({ allowedRoots: ['relative/path'] })).toThrow(ShellError);
  });

  it('rejects defaultCwd outside allowedRoots', () => {
    expect(() =>
      createPolicy({ allowedRoots: [root], defaultCwd: '/etc' }),
    ).toThrow(ShellError);
  });

  it('rejects defaultTimeoutMs > maxTimeoutMs', () => {
    expect(() =>
      createPolicy({
        allowedRoots: [root],
        defaultTimeoutMs: 60_000,
        maxTimeoutMs: 1_000,
      }),
    ).toThrow(ShellError);
  });
});

describe('checkExec', () => {
  it('accepts a basename in the allowlist', () => {
    const p = createPolicy({ allowedRoots: [root], allowedCommands: ['node'] });
    const r = checkExec(p, { command: 'node', args: ['-v'] });
    expect(r.command).toBe('node');
    expect(r.args).toEqual(['-v']);
    expect(r.cwd).toBe(root);
  });

  it('rejects path-with-slash commands', () => {
    const p = createPolicy({ allowedRoots: [root], allowedCommands: ['node'] });
    expect(() => checkExec(p, { command: '/usr/bin/node' })).toThrow(ShellError);
  });

  it('rejects command not in allowlist', () => {
    const p = createPolicy({ allowedRoots: [root], allowedCommands: ['node'] });
    expect(() => checkExec(p, { command: 'rm', args: ['-rf', '/'] })).toThrow(ShellError);
  });

  it('rejects deny-substring matches', () => {
    const p = createPolicy({
      allowedRoots: [root],
      allowedCommands: ['git'],
      deniedSubstrings: ['git push --force'],
    });
    expect(() =>
      checkExec(p, { command: 'git', args: ['push', '--force', 'origin', 'main'] }),
    ).toThrow(ShellError);
  });

  it('lets a clean git push through when deny list does not match', () => {
    const p = createPolicy({
      allowedRoots: [root],
      allowedCommands: ['git'],
      deniedSubstrings: ['git push --force'],
    });
    const r = checkExec(p, { command: 'git', args: ['push', 'origin', 'main'] });
    expect(r.commandLine).toBe('git push origin main');
  });

  it('rejects cwd outside allowedRoots', () => {
    const p = createPolicy({ allowedRoots: [root], allowedCommands: ['node'] });
    expect(() => checkExec(p, { command: 'node', cwd: '/etc' })).toThrow(ShellError);
  });

  it('clamps timeoutMs to maxTimeoutMs', () => {
    const p = createPolicy({
      allowedRoots: [root],
      allowedCommands: ['node'],
      defaultTimeoutMs: 1_000,
      maxTimeoutMs: 5_000,
    });
    const r = checkExec(p, { command: 'node', timeoutMs: 60_000 });
    expect(r.timeoutMs).toBe(5_000);
  });
});
