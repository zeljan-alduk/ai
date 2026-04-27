import { describe, expect, it } from 'vitest';
import { InProcessSandbox } from '../src/in-process.js';
import type { SandboxError, SandboxPolicy, SandboxRequest } from '../src/types.js';

const POLICY: SandboxPolicy = {
  cwd: process.cwd(),
  allowedPaths: [],
  env: { FOO: 'bar' },
  network: 'none',
  timeoutMs: 1_000,
};

function req<A>(
  name: string,
  args: A,
  overrides: Partial<SandboxRequest<A>> = {},
): SandboxRequest<A> {
  return { toolName: name, args, policy: POLICY, ...overrides };
}

describe('InProcessSandbox', () => {
  it('runs an inline function and returns its value', async () => {
    const sbx = new InProcessSandbox();
    const r = await sbx.run(
      { kind: 'inline', inline: async (n: number) => n * 2 },
      req('double', 21),
    );
    expect(r.value).toBe(42);
    expect(r.durationMs).toBeGreaterThanOrEqual(0);
    expect(r.stdout).toBe('');
  });

  it('only exposes the policy env to the inline function', async () => {
    process.env.SECRET_LEAK = 'should-not-be-visible';
    const sbx = new InProcessSandbox();
    const r = await sbx.run(
      {
        kind: 'inline',
        inline: async (_a: null, scope) => {
          return { sawFoo: scope.env.FOO, sawSecret: scope.env.SECRET_LEAK };
        },
      },
      req('env-check', null),
    );
    expect(r.value).toEqual({ sawFoo: 'bar', sawSecret: undefined });
    process.env.SECRET_LEAK = undefined;
  });

  it('raises TIMEOUT when the function exceeds the policy', async () => {
    const sbx = new InProcessSandbox();
    const policy: SandboxPolicy = { ...POLICY, timeoutMs: 50 };
    await expect(
      sbx.run(
        {
          kind: 'inline',
          inline: (_args: null, scope) =>
            new Promise<never>((_, rej) => {
              scope.signal.addEventListener('abort', () => rej(scope.signal.reason));
            }),
        },
        { toolName: 'slow', args: null, policy },
      ),
    ).rejects.toMatchObject({
      name: 'SandboxError',
      code: 'TIMEOUT',
    } satisfies Partial<SandboxError>);
  });

  it('honours an external AbortSignal as CANCELLED', async () => {
    const sbx = new InProcessSandbox();
    const ac = new AbortController();
    const promise = sbx.run(
      {
        kind: 'inline',
        inline: (_args: null, scope) =>
          new Promise<never>((_, rej) => {
            scope.signal.addEventListener('abort', () => rej(scope.signal.reason));
          }),
      },
      req('cancellable', null, { signal: ac.signal }),
    );
    setTimeout(() => ac.abort(new Error('user-cancel')), 10);
    await expect(promise).rejects.toMatchObject({
      name: 'SandboxError',
      code: 'CANCELLED',
    });
  });

  it('reports thrown exceptions as RUNTIME_ERROR', async () => {
    const sbx = new InProcessSandbox();
    await expect(
      sbx.run(
        {
          kind: 'inline',
          inline: () => {
            throw new Error('boom');
          },
        },
        req('boom', null),
      ),
    ).rejects.toMatchObject({ code: 'RUNTIME_ERROR', message: 'boom' });
  });

  it('rejects module-mode fns', async () => {
    const sbx = new InProcessSandbox();
    await expect(
      sbx.run({ kind: 'module', module: '/x.js', exportName: 'y' }, req('m', null)),
    ).rejects.toMatchObject({ code: 'RUNTIME_ERROR' });
  });
});
