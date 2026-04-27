import { describe, expect, it } from 'vitest';
import { CompositeChildFailedError, CompositeSpecError, Supervisor } from '../src/index.js';
import { MockRuntimeAdapter, makeComposite, makeRunContext, makeSpec, usage } from './mocks.js';

describe('debate strategy', () => {
  it('fans parties + then spawns aggregator with concatenated outputs', async () => {
    const adapter = new MockRuntimeAdapter(({ agent, inputs }) => {
      if (agent.name === 'judge') {
        return {
          ok: true,
          output: { judged: inputs },
          usage: usage('mock', 'm', 5, 5, 0),
        };
      }
      return {
        ok: true,
        output: `O(${agent.name})`,
        usage: usage('mock', 'm', 1, 1, 0),
      };
    });
    adapter.registerSpec(makeSpec({ name: 'p1' }));
    adapter.registerSpec(makeSpec({ name: 'p2' }));
    adapter.registerSpec(makeSpec({ name: 'p3' }));
    adapter.registerSpec(makeSpec({ name: 'judge' }));

    const sup = new Supervisor({ runtime: adapter, emit: () => undefined });
    const result = await sup.runComposite(
      makeSpec({
        name: 'sup',
        composite: makeComposite({
          strategy: 'debate',
          subagents: [{ name: 'p1' }, { name: 'p2' }, { name: 'p3' }],
          aggregator: 'judge',
        }),
      }),
      'topic',
      makeRunContext(),
    );

    expect(result.ok).toBe(true);
    expect(result.strategy).toBe('debate');
    // 3 parties + 1 aggregator
    expect(result.children).toHaveLength(4);
    // Aggregator's input: { parties: [{ alias, agent, output }, ...] }
    const aggInputs = adapter.children.find((c) => c.agent.name === 'judge')?.inputs as {
      parties: { agent: string; output: string }[];
    };
    expect(aggInputs.parties.map((p) => p.agent)).toEqual(['p1', 'p2', 'p3']);
    expect(aggInputs.parties.map((p) => p.output)).toEqual(['O(p1)', 'O(p2)', 'O(p3)']);
    // The composite output is the aggregator's output.
    expect(result.output).toEqual({ judged: aggInputs });
  });

  it('throws when aggregator is missing on debate', async () => {
    const adapter = new MockRuntimeAdapter(() => ({
      ok: true,
      output: '',
      usage: usage('mock', 'm', 1, 1, 0),
    }));
    adapter.registerSpec(makeSpec({ name: 'p1' }));
    const sup = new Supervisor({ runtime: adapter, emit: () => undefined });
    await expect(
      sup.runComposite(
        makeSpec({
          name: 'sup',
          composite: makeComposite({ strategy: 'debate', subagents: [{ name: 'p1' }] }),
        }),
        'in',
        makeRunContext(),
      ),
    ).rejects.toBeInstanceOf(CompositeSpecError);
  });

  it('does not spawn aggregator when a party fails', async () => {
    const adapter = new MockRuntimeAdapter(({ agent }) => {
      if (agent.name === 'p2') return { ok: false, output: { error: 'noisy' } };
      return { ok: true, output: 'x', usage: usage('mock', 'm', 1, 1, 0) };
    });
    adapter.registerSpec(makeSpec({ name: 'p1' }));
    adapter.registerSpec(makeSpec({ name: 'p2' }));
    adapter.registerSpec(makeSpec({ name: 'judge' }));
    const sup = new Supervisor({ runtime: adapter, emit: () => undefined });
    await expect(
      sup.runComposite(
        makeSpec({
          name: 'sup',
          composite: makeComposite({
            strategy: 'debate',
            subagents: [{ name: 'p1' }, { name: 'p2' }],
            aggregator: 'judge',
          }),
        }),
        'in',
        makeRunContext(),
      ),
    ).rejects.toBeInstanceOf(CompositeChildFailedError);
    // judge never spawned
    expect(adapter.children.find((c) => c.agent.name === 'judge')).toBeUndefined();
  });
});
