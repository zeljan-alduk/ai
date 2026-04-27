import { describe, expect, it } from 'vitest';
import { CompositeChildFailedError, CompositeSpecError, Supervisor } from '../src/index.js';
import { MockRuntimeAdapter, makeComposite, makeRunContext, makeSpec, usage } from './mocks.js';

describe('iterative strategy', () => {
  it('loops until terminate JSONPath becomes truthy', async () => {
    const adapter = new MockRuntimeAdapter(({ inputs }) => {
      const round = (inputs as { round: number }).round;
      // Round 3 sets done:true
      return {
        ok: true,
        output: { round, done: round >= 3 },
        usage: usage('mock', 'm', 1, 1, 0),
      };
    });
    adapter.registerSpec(makeSpec({ name: 'worker' }));
    const events: { type: string; payload: unknown }[] = [];
    const sup = new Supervisor({
      runtime: adapter,
      emit: (e) => events.push({ type: e.type, payload: e.payload }),
    });

    const result = await sup.runComposite(
      makeSpec({
        name: 'sup',
        composite: makeComposite({
          strategy: 'iterative',
          subagents: [{ name: 'worker' }],
          iteration: { maxRounds: 10, terminate: '$.done' },
        }),
      }),
      'goal',
      makeRunContext(),
    );

    expect(result.ok).toBe(true);
    expect(result.rounds).toBe(3);
    const out = result.output as { rounds: number; output: unknown; terminated: boolean };
    expect(out.terminated).toBe(true);
    expect(out.rounds).toBe(3);
    // 3 iteration events
    const iterEvents = events.filter((e) => e.type === 'composite.iteration');
    expect(iterEvents).toHaveLength(3);
    expect((iterEvents[2]?.payload as { terminated: boolean }).terminated).toBe(true);
  });

  it('stops at maxRounds when terminate stays false', async () => {
    const adapter = new MockRuntimeAdapter(({ inputs }) => ({
      ok: true,
      output: { round: (inputs as { round: number }).round, done: false },
      usage: usage('mock', 'm', 1, 1, 0),
    }));
    adapter.registerSpec(makeSpec({ name: 'worker' }));
    const sup = new Supervisor({ runtime: adapter, emit: () => undefined });
    const result = await sup.runComposite(
      makeSpec({
        name: 'sup',
        composite: makeComposite({
          strategy: 'iterative',
          subagents: [{ name: 'worker' }],
          iteration: { maxRounds: 4, terminate: '$.done' },
        }),
      }),
      'goal',
      makeRunContext(),
    );
    expect(result.rounds).toBe(4);
    const out = result.output as { terminated: boolean };
    expect(out.terminated).toBe(false);
  });

  it('throws when iteration block missing on iterative spec', async () => {
    const adapter = new MockRuntimeAdapter(() => ({ ok: true, output: '' }));
    adapter.registerSpec(makeSpec({ name: 'worker' }));
    const sup = new Supervisor({ runtime: adapter, emit: () => undefined });
    await expect(
      sup.runComposite(
        makeSpec({
          name: 'sup',
          composite: makeComposite({
            strategy: 'iterative',
            subagents: [{ name: 'worker' }],
          }),
        }),
        'in',
        makeRunContext(),
      ),
    ).rejects.toBeInstanceOf(CompositeSpecError);
  });

  it('throws on a failed round', async () => {
    const adapter = new MockRuntimeAdapter(({ inputs }) => {
      const round = (inputs as { round: number }).round;
      if (round === 2) return { ok: false, output: { error: 'collapse' } };
      return { ok: true, output: { round, done: false }, usage: usage('mock', 'm', 1, 1, 0) };
    });
    adapter.registerSpec(makeSpec({ name: 'worker' }));
    const sup = new Supervisor({ runtime: adapter, emit: () => undefined });
    await expect(
      sup.runComposite(
        makeSpec({
          name: 'sup',
          composite: makeComposite({
            strategy: 'iterative',
            subagents: [{ name: 'worker' }],
            iteration: { maxRounds: 5, terminate: '$.done' },
          }),
        }),
        'in',
        makeRunContext(),
      ),
    ).rejects.toBeInstanceOf(CompositeChildFailedError);
  });

  it('rejects an iterative spec with > 1 subagent', async () => {
    const adapter = new MockRuntimeAdapter(() => ({ ok: true, output: '' }));
    adapter.registerSpec(makeSpec({ name: 'a' }));
    adapter.registerSpec(makeSpec({ name: 'b' }));
    const sup = new Supervisor({ runtime: adapter, emit: () => undefined });
    await expect(
      sup.runComposite(
        makeSpec({
          name: 'sup',
          composite: makeComposite({
            strategy: 'iterative',
            subagents: [{ name: 'a' }, { name: 'b' }],
            iteration: { maxRounds: 1, terminate: 'true' },
          }),
        }),
        'in',
        makeRunContext(),
      ),
    ).rejects.toBeInstanceOf(CompositeSpecError);
  });
});
