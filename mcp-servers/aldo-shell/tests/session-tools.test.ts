/**
 * Persistent session tools — shell.cd / shell.pwd / shell.export /
 * shell.unset / shell.env.
 *
 * Pure tests (no spawn) for the session-state mutators, plus one
 * integration test that proves shell.exec inherits the cwd a prior
 * shell.cd set.
 */

import { mkdtemp, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { createPolicy } from '../src/policy.js';
import { createShellSessionState } from '../src/session.js';
import { shellExec } from '../src/tools/exec.js';
import {
  shellCd,
  shellEnv,
  shellExport,
  shellPwd,
  shellUnset,
} from '../src/tools/session-tools.js';

let root = '';

beforeAll(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'aldo-shell-session-')));
  await writeFile(join(root, 'cwd-probe.js'), 'process.stdout.write(process.cwd() + "\\n");\n');
  await writeFile(join(root, 'env-probe.js'), 'process.stdout.write((process.env.MY_VAR ?? "(unset)") + "\\n");\n');
});

describe('shellCd / shellPwd', () => {
  it('cd sets the session cwd; pwd reads it back', async () => {
    const state = createShellSessionState();
    const pwdBefore = await shellPwd(state, {});
    expect(pwdBefore.cwd).toBeNull();

    const cd = await shellCd(state, { path: root });
    expect(cd.cwd).toBe(root);
    expect(state.cwd).toBe(root);

    const pwdAfter = await shellPwd(state, {});
    expect(pwdAfter.cwd).toBe(root);
  });

  it('relative cd resolves against the current cwd', async () => {
    const state = createShellSessionState();
    state.cwd = root;
    const cd = await shellCd(state, { path: '..' });
    // Resolved path is the parent of root; we don't pin the exact
    // value because tmpdir is host-specific.
    expect(cd.cwd).not.toBe(root);
    expect(cd.cwd.length).toBeGreaterThan(0);
  });

  it('absolute cd is used verbatim', async () => {
    const state = createShellSessionState();
    state.cwd = root;
    const cd = await shellCd(state, { path: '/tmp' });
    expect(cd.cwd).toBe('/tmp');
  });
});

describe('shellExport / shellUnset / shellEnv', () => {
  it('export merges; env reads back; unset removes', async () => {
    const state = createShellSessionState();
    await shellExport(state, { pairs: { FOO: '1', BAR: '2' } });
    let env = await shellEnv(state, {});
    expect(env.pairs).toEqual({ FOO: '1', BAR: '2' });

    await shellExport(state, { pairs: { FOO: '99' } });
    env = await shellEnv(state, {});
    expect(env.pairs.FOO).toBe('99');

    const unset = await shellUnset(state, { keys: ['FOO'] });
    expect(unset.remaining).toEqual(['BAR']);
    env = await shellEnv(state, {});
    expect(env.pairs).toEqual({ BAR: '2' });
  });
});

describe('shellExec inherits session cwd + env', () => {
  it('exec uses the session cwd when no `cwd` arg is provided', async () => {
    const policy = createPolicy({
      allowedRoots: [root],
      allowedCommands: ['node'],
      defaultTimeoutMs: 10_000,
    });
    const session = createShellSessionState();
    await shellCd(session, { path: root });

    const out = await shellExec(
      policy,
      { command: 'node', args: ['cwd-probe.js'] },
      session,
    );
    expect(out.exitCode).toBe(0);
    expect(out.stdout.trim()).toBe(root);
  });

  it('exec inherits exported env vars (call-level env overrides)', async () => {
    const policy = createPolicy({
      allowedRoots: [root],
      allowedCommands: ['node'],
      defaultTimeoutMs: 10_000,
    });
    const session = createShellSessionState();
    await shellCd(session, { path: root });
    await shellExport(session, { pairs: { MY_VAR: 'from-session' } });

    const inherited = await shellExec(
      policy,
      { command: 'node', args: ['env-probe.js'] },
      session,
    );
    expect(inherited.stdout.trim()).toBe('from-session');

    const overridden = await shellExec(
      policy,
      { command: 'node', args: ['env-probe.js'], env: { MY_VAR: 'from-call' } },
      session,
    );
    expect(overridden.stdout.trim()).toBe('from-call');
  });

  it('exec without a session is unchanged (call-level cwd still required when no allowedRoots match cwd default)', async () => {
    // Sanity: passing no session must not break the existing surface.
    const policy = createPolicy({
      allowedRoots: [root],
      allowedCommands: ['node'],
      defaultTimeoutMs: 10_000,
    });
    const out = await shellExec(policy, {
      command: 'node',
      args: ['cwd-probe.js'],
      cwd: root,
    });
    expect(out.exitCode).toBe(0);
    expect(out.stdout.trim()).toBe(root);
  });
});
