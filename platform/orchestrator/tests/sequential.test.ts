import { describe, expect, it } from 'vitest';
import { CompositeChildFailedError, Supervisor } from '../src/index.js';
import { MockRuntimeAdapter, makeComposite, makeRunContext, makeSpec, usage } from './mocks.js';

describe('sequential strategy', () => {
  it('pipes a -> b -> c, threading each output as `previous`', async () => {
    const adapter = new MockRuntimeAdapter(({ agent, inputs }) => {
      const prev =
        typeof inputs === 'object' && inputs !== null && 'previous' in inputs
          ? (inputs as { previous: unknown }).previous
          : inputs;
      return {
        ok: true,
        output: `${agent.name}(${JSON.stringify(prev)})`,
        usage: usage('mock', 'm', 1, 1, 0),
      };
    });
    adapter.registerSpec(makeSpec({ name: 'a' }));
    adapter.registerSpec(makeSpec({ name: 'b' }));
    adapter.registerSpec(makeSpec({ name: 'c' }));
    const supervisorSpec = makeSpec({
      name: 'sup',
      composite: makeComposite({
        strategy: 'sequential',
        subagents: [{ name: 'a' }, { name: 'b' }, { name: 'c' }],
      }),
    });

    const events: { type: string; payload: unknown }[] = [];
    const sup = new Supervisor({
      runtime: adapter,
      emit: (e) => events.push({ type: e.type, payload: e.payload }),
    });
    const result = await sup.runComposite(supervisorSpec, 'seed', makeRunContext());

    expect(result.ok).toBe(true);
    expect(result.strategy).toBe('sequential');
    expect(result.children).toHaveLength(3);
    expect(result.output).toMatch(/^c\(/);
    // Verify the pipe: c sees b(...), b sees a("seed"), a sees "seed".
    expect(adapter.children[0]?.inputs).toBe('seed');
    expect(adapter.children[1]?.inputs).toMatch(/^a\(/);
    expect(adapter.children[2]?.inputs).toMatch(/^b\(/);
  });

  it('emits child_started + child_completed in order', async () => {
    const adapter = new MockRuntimeAdapter(() => ({
      ok: true,
      output: 'done',
      usage: usage('mock', 'm', 1, 1, 0),
    }));
    adapter.registerSpec(makeSpec({ name: 'a' }));
    adapter.registerSpec(makeSpec({ name: 'b' }));
    const events: { type: string }[] = [];
    const sup = new Supervisor({
      runtime: adapter,
      emit: (e) => events.push({ type: e.type }),
    });
    await sup.runComposite(
      makeSpec({
        name: 'sup',
        composite: makeComposite({
          strategy: 'sequential',
          subagents: [{ name: 'a' }, { name: 'b' }],
        }),
      }),
      'in',
      makeRunContext(),
    );
    const types = events.map((e) => e.type);
    // Two children, each with start + complete; one rollup at the end.
    expect(types.filter((t) => t === 'composite.child_started')).toHaveLength(2);
    expect(types.filter((t) => t === 'composite.child_completed')).toHaveLength(2);
    expect(types.filter((t) => t === 'composite.usage_rollup')).toHaveLength(1);
    // First start precedes first complete.
    const firstStart = types.indexOf('composite.child_started');
    const firstComplete = types.indexOf('composite.child_completed');
    expect(firstStart).toBeLessThan(firstComplete);
  });

  it('fails fast on first non-ok child and throws CompositeChildFailedError', async () => {
    let calls = 0;
    const adapter = new MockRuntimeAdapter(({ agent }) => {
      calls++;
      if (agent.name === 'b') return { ok: false, output: { error: 'boom' } };
      return { ok: true, output: 'x', usage: usage('mock', 'm', 1, 1, 0) };
    });
    adapter.registerSpec(makeSpec({ name: 'a' }));
    adapter.registerSpec(makeSpec({ name: 'b' }));
    adapter.registerSpec(makeSpec({ name: 'c' }));
    const sup = new Supervisor({ runtime: adapter, emit: () => undefined });
    await expect(
      sup.runComposite(
        makeSpec({
          name: 'sup',
          composite: makeComposite({
            strategy: 'sequential',
            subagents: [{ name: 'a' }, { name: 'b' }, { name: 'c' }],
          }),
        }),
        'in',
        makeRunContext(),
      ),
    ).rejects.toBeInstanceOf(CompositeChildFailedError);
    expect(calls).toBe(2); // 'c' never spawned
  });

  it('threads parent_run_id and root_run_id into every child', async () => {
    const adapter = new MockRuntimeAdapter(() => ({
      ok: true,
      output: '',
      usage: usage('mock', 'm', 1, 1, 0),
    }));
    adapter.registerSpec(makeSpec({ name: 'a' }));
    adapter.registerSpec(makeSpec({ name: 'b' }));
    const ctx = makeRunContext();
    const sup = new Supervisor({ runtime: adapter, emit: () => undefined });
    await sup.runComposite(
      makeSpec({
        name: 'sup',
        composite: makeComposite({
          strategy: 'sequential',
          subagents: [{ name: 'a' }, { name: 'b' }],
        }),
      }),
      'in',
      ctx,
    );
    for (const c of adapter.children) {
      expect(c.parentRunId).toBe(ctx.parentRunId);
      expect(c.rootRunId).toBe(ctx.rootRunId);
      expect(c.compositeStrategy).toBe('sequential');
    }
  });

  it('returns the final cursor as output (not the intermediate)', async () => {
    const adapter = new MockRuntimeAdapter(({ agent }) => ({
      ok: true,
      output: agent.name === 'a' ? 'A' : agent.name === 'b' ? 'B' : 'C',
      usage: usage('mock', 'm', 1, 1, 0),
    }));
    adapter.registerSpec(makeSpec({ name: 'a' }));
    adapter.registerSpec(makeSpec({ name: 'b' }));
    adapter.registerSpec(makeSpec({ name: 'c' }));
    const sup = new Supervisor({ runtime: adapter, emit: () => undefined });
    const result = await sup.runComposite(
      makeSpec({
        name: 'sup',
        composite: makeComposite({
          strategy: 'sequential',
          subagents: [{ name: 'a' }, { name: 'b' }, { name: 'c' }],
        }),
      }),
      'seed',
      makeRunContext(),
    );
    expect(result.output).toBe('C');
  });
});
