import { mkdtempSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SubprocessSandbox } from '../src/subprocess.js';
import { SandboxError, type SandboxPolicy, type SandboxRequest } from '../src/types.js';

const SKIP = process.platform !== 'linux';
if (SKIP) {
  // biome-ignore lint/suspicious/noConsole: intentional, ran on CI logs.
  console.log('subprocess.test: skipping rlimit-dependent assertions on non-linux');
}

const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));

function basePolicy(overrides: Partial<SandboxPolicy> = {}): SandboxPolicy {
  return {
    cwd: tmpdir(),
    allowedPaths: [],
    env: {},
    network: 'none',
    timeoutMs: 5_000,
    ...overrides,
  };
}

function req<A>(name: string, args: A, policy: SandboxPolicy, signal?: AbortSignal): SandboxRequest<A> {
  return signal !== undefined
    ? { toolName: name, args, policy, signal }
    : { toolName: name, args, policy };
}

describe('SubprocessSandbox', () => {
  it.skipIf(SKIP)('runs a module-mode tool and returns the value', async () => {
    const sbx = new SubprocessSandbox();
    const r = await sbx.run<unknown, { echoed: { x: number } }>(
      { kind: 'module', module: join(FIXTURES, 'echo-tool.mjs'), exportName: 'run' },
      req('echo', { x: 7 }, basePolicy()),
    );
    expect(r.value.echoed).toEqual({ x: 7 });
  });

  it.skipIf(SKIP)('cwd is a fresh tmp jail, not the host cwd', async () => {
    const sbx = new SubprocessSandbox();
    const r = await sbx.run<unknown, { cwd: string }>(
      { kind: 'module', module: join(FIXTURES, 'echo-tool.mjs'), exportName: 'run' },
      req('echo', null, basePolicy()),
    );
    expect(r.value.cwd).not.toBe(process.cwd());
    expect(r.value.cwd).toContain('aldo-sbx-');
  });

  it.skipIf(SKIP)('only allowed paths surface in the jail', async () => {
    const allowedRoot = mkdtempSync(join(tmpdir(), 'aldo-allowed-'));
    writeFileSync(join(allowedRoot, 'marker.txt'), 'hi');
    const sbx = new SubprocessSandbox();
    const r = await sbx.run<unknown, { cwdEntries: string[] }>(
      { kind: 'module', module: join(FIXTURES, 'env-tool.mjs'), exportName: 'run' },
      req('env', null, basePolicy({ allowedPaths: [allowedRoot] })),
    );
    // The basename of the allowed root is symlinked into the jail.
    const expectedLink = allowedRoot.split('/').pop();
    expect(r.value.cwdEntries).toContain(expectedLink);
    // Sanity: the jail isn't accidentally exposing /etc.
    expect(r.value.cwdEntries).not.toContain('etc');
  });

  it.skipIf(SKIP)('env is scrubbed to the policy allowlist (+PATH)', async () => {
    process.env.HOST_SECRET = 'should-not-leak';
    const sbx = new SubprocessSandbox();
    const r = await sbx.run<unknown, { env: Record<string, string> }>(
      { kind: 'module', module: join(FIXTURES, 'env-tool.mjs'), exportName: 'run' },
      req('env', null, basePolicy({ env: { ALDO_OK: 'yes' } })),
    );
    expect(r.value.env.ALDO_OK).toBe('yes');
    expect(r.value.env.HOST_SECRET).toBeUndefined();
    expect(r.value.env.PATH).toBeDefined();
    delete process.env.HOST_SECRET;
  });

  it.skipIf(SKIP)('blocks egress to disallowed hosts', async () => {
    const sbx = new SubprocessSandbox();
    await expect(
      sbx.run(
        { kind: 'module', module: join(FIXTURES, 'fetch-tool.mjs'), exportName: 'run' },
        req(
          'fetch',
          { url: 'http://example.com/' },
          basePolicy({ network: { allowedHosts: ['allowed.test'] } }),
        ),
      ),
    ).rejects.toMatchObject({ code: 'EGRESS_BLOCKED' } satisfies Partial<SandboxError>);
  });

  it.skipIf(SKIP)('blocks all egress when network=none', async () => {
    const sbx = new SubprocessSandbox();
    await expect(
      sbx.run(
        { kind: 'module', module: join(FIXTURES, 'fetch-tool.mjs'), exportName: 'run' },
        req('fetch', { url: 'http://example.com/' }, basePolicy()),
      ),
    ).rejects.toMatchObject({ code: 'EGRESS_BLOCKED' });
  });

  it.skipIf(SKIP)('kills the child on AbortSignal', async () => {
    const sbx = new SubprocessSandbox();
    const ac = new AbortController();
    const promise = sbx.run(
      { kind: 'module', module: join(FIXTURES, 'sleep-tool.mjs'), exportName: 'run' },
      req('sleep', null, basePolicy({ timeoutMs: 30_000 }), ac.signal),
    );
    setTimeout(() => ac.abort(new Error('user-cancel')), 100);
    await expect(promise).rejects.toMatchObject({ code: 'CANCELLED' });
  });

  it.skipIf(SKIP)('raises TIMEOUT when the wall clock fires', async () => {
    const sbx = new SubprocessSandbox();
    await expect(
      sbx.run(
        { kind: 'module', module: join(FIXTURES, 'sleep-tool.mjs'), exportName: 'run' },
        req('sleep', null, basePolicy({ timeoutMs: 200 })),
      ),
    ).rejects.toMatchObject({ code: 'TIMEOUT' });
  });
});

// Acknowledge the unused import on non-linux skip paths.
void readdirSync;
