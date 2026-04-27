import { describe, expect, it } from 'vitest';
import { CompositeChildFailedError, Supervisor } from '../src/index.js';
import { MockRuntimeAdapter, makeComposite, makeRunContext, makeSpec, usage } from './mocks.js';

describe('parallel strategy', () => {
  it('fans out to N subagents concurrently and returns outputs in declaration order', async () => {
    const adapter = new MockRuntimeAdapter(({ agent }) => ({
      ok: true,
      output: `R(${agent.name})`,
      usage: usage('mock', 'm', 1, 1, 0),
      delayMs: 30,
    }));
    adapter.registerSpec(makeSpec({ name: 'a' }));
    adapter.registerSpec(makeSpec({ name: 'b' }));
    adapter.registerSpec(makeSpec({ name: 'c' }));
    const sup = new Supervisor({ runtime: adapter, emit: () => undefined });
    const result = await sup.runComposite(
      makeSpec({
        name: 'sup',
        composite: makeComposite({
          strategy: 'parallel',
          subagents: [{ name: 'a' }, { name: 'b' }, { name: 'c' }],
        }),
      }),
      'in',
      makeRunContext(),
    );
    expect(result.ok).toBe(true);
    expect(result.output).toEqual(['R(a)', 'R(b)', 'R(c)']);
    expect(adapter.concurrencyPeak).toBeGreaterThanOrEqual(2);
  });

  it('respects ALDO_MAX_PARALLEL_CHILDREN', async () => {
    const original = process.env.ALDO_MAX_PARALLEL_CHILDREN;
    process.env.ALDO_MAX_PARALLEL_CHILDREN = '1';
    try {
      const adapter = new MockRuntimeAdapter(() => ({
        ok: true,
        output: 'x',
        usage: usage('mock', 'm', 1, 1, 0),
        delayMs: 30,
      }));
      adapter.registerSpec(makeSpec({ name: 'a' }));
      adapter.registerSpec(makeSpec({ name: 'b' }));
      adapter.registerSpec(makeSpec({ name: 'c' }));
      const sup = new Supervisor({ runtime: adapter, emit: () => undefined });
      await sup.runComposite(
        makeSpec({
          name: 'sup',
          composite: makeComposite({
            strategy: 'parallel',
            subagents: [{ name: 'a' }, { name: 'b' }, { name: 'c' }],
          }),
        }),
        'in',
        makeRunContext(),
      );
      expect(adapter.concurrencyPeak).toBe(1);
    } finally {
      if (original === undefined) process.env.ALDO_MAX_PARALLEL_CHILDREN = undefined;
      else process.env.ALDO_MAX_PARALLEL_CHILDREN = original;
    }
  });

  it('awaits all children even when one fails, then surfaces first failure', async () => {
    let calls = 0;
    const adapter = new MockRuntimeAdapter(({ agent }) => {
      calls++;
      if (agent.name === 'b') return { ok: false, output: { error: 'boom' } };
      return { ok: true, output: agent.name, usage: usage('mock', 'm', 1, 1, 0) };
    });
    adapter.registerSpec(makeSpec({ name: 'a' }));
    adapter.registerSpec(makeSpec({ name: 'b' }));
    adapter.registerSpec(makeSpec({ name: 'c' }));
    const events: string[] = [];
    const sup = new Supervisor({
      runtime: adapter,
      emit: (e) => events.push(e.type),
    });
    await expect(
      sup.runComposite(
        makeSpec({
          name: 'sup',
          composite: makeComposite({
            strategy: 'parallel',
            subagents: [{ name: 'a' }, { name: 'b' }, { name: 'c' }],
          }),
        }),
        'in',
        makeRunContext(),
      ),
    ).rejects.toBeInstanceOf(CompositeChildFailedError);
    // every party was awaited (a, b, c all spawned)
    expect(calls).toBe(3);
    expect(events.filter((t) => t === 'composite.child_failed')).toHaveLength(1);
  });

  it('handles a single subagent (degenerate case)', async () => {
    const adapter = new MockRuntimeAdapter(() => ({
      ok: true,
      output: 'only',
      usage: usage('mock', 'm', 1, 1, 0),
    }));
    adapter.registerSpec(makeSpec({ name: 'a' }));
    const sup = new Supervisor({ runtime: adapter, emit: () => undefined });
    const result = await sup.runComposite(
      makeSpec({
        name: 'sup',
        composite: makeComposite({ strategy: 'parallel', subagents: [{ name: 'a' }] }),
      }),
      'in',
      makeRunContext(),
    );
    expect(result.output).toEqual(['only']);
  });
});
