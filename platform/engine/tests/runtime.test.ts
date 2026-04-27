import type { AgentRef, TenantId } from '@aldo-ai/types';
import { describe, expect, it } from 'vitest';
import { PlatformRuntime, SpawnNotAllowedError } from '../src/runtime.js';
import {
  MockGateway,
  MockRegistry,
  MockToolHost,
  MockTracer,
  makeSpec,
  textCompletion,
} from './mocks/index.js';

const TENANT = 'tenant-a' as TenantId;

describe('PlatformRuntime', () => {
  it('spawns a leaf agent and yields its output', async () => {
    const registry = new MockRegistry();
    registry.add(makeSpec({ name: 'echo' }));
    const gateway = new MockGateway(() => textCompletion('hello world'));
    const rt = new PlatformRuntime({
      modelGateway: gateway,
      toolHost: new MockToolHost(),
      registry,
      tracer: new MockTracer(),
      tenant: TENANT,
    });

    const ref: AgentRef = { name: 'echo' };
    const run = await rt.spawn(ref, { msg: 'hi' });
    const got = await rt.get(run.id);
    expect(got?.id).toBe(run.id);
    // @ts-expect-error wait is on InternalAgentRun
    const { ok, output } = await run.wait();
    expect(ok).toBe(true);
    expect(output).toBe('hello world');
  });

  it('rejects spawning a child not listed in parent.spawn.allowed', async () => {
    const registry = new MockRegistry();
    registry.add(makeSpec({ name: 'parent', spawn: { allowed: ['other'] } }));
    registry.add(makeSpec({ name: 'child' }));
    const gateway = new MockGateway(() => textCompletion('p'));
    const rt = new PlatformRuntime({
      modelGateway: gateway,
      toolHost: new MockToolHost(),
      registry,
      tracer: new MockTracer(),
      tenant: TENANT,
    });

    const parent = await rt.spawn({ name: 'parent' }, null);
    await expect(rt.spawn({ name: 'child' }, null, parent.id)).rejects.toBeInstanceOf(
      SpawnNotAllowedError,
    );
  });

  it('allows spawning when child is in parent.spawn.allowed', async () => {
    const registry = new MockRegistry();
    registry.add(makeSpec({ name: 'parent', spawn: { allowed: ['child'] } }));
    registry.add(makeSpec({ name: 'child' }));
    const gateway = new MockGateway(() => textCompletion('ok'));
    const rt = new PlatformRuntime({
      modelGateway: gateway,
      toolHost: new MockToolHost(),
      registry,
      tracer: new MockTracer(),
      tenant: TENANT,
    });
    const parent = await rt.spawn({ name: 'parent' }, null);
    const child = await rt.spawn({ name: 'child' }, null, parent.id);
    expect(child).toBeDefined();
    expect(rt.childrenOf(parent.id)).toContain(child.id);
    expect(rt.parentsOf(child.id)).toContain(parent.id);
  });

  it('cancel aborts an in-flight model call via AbortSignal', async () => {
    const registry = new MockRegistry();
    registry.add(makeSpec({ name: 'slow' }));
    // Gateway whose deltas never arrive; respects ctx.signal.
    const gateway = new MockGateway(async function* (_req, ctx) {
      const signal = (ctx as unknown as { signal?: AbortSignal }).signal;
      await new Promise<void>((resolve, reject) => {
        signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
        // Never resolves on its own.
      });
      yield {} as never;
    });
    const rt = new PlatformRuntime({
      modelGateway: gateway,
      toolHost: new MockToolHost(),
      registry,
      tracer: new MockTracer(),
      tenant: TENANT,
    });

    const run = await rt.spawn({ name: 'slow' }, 'x');
    // Let the loop start.
    await new Promise((r) => setImmediate(r));
    await run.cancel('user');
    // @ts-expect-error wait is on InternalAgentRun
    const result = await run.wait();
    expect(result.ok).toBe(false);
  });
});
