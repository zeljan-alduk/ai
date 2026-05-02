/**
 * Wave-17 declarative termination — runtime tests.
 *
 * Covers each of the four cross-strategy rules wired into the
 * Supervisor:
 *
 *   - maxTurns     — sequential (and via parallel for fan-out cap)
 *   - maxUsd       — sequential cost roll-up
 *   - textMention  — case-insensitive substring on a child output
 *   - successRoles — alias-matched short-circuit
 *
 * Plus the additive guarantee: a spec with NO `termination:` block
 * still runs through the original strategy contract unchanged.
 *
 * The fixtures use the existing MockRuntimeAdapter — no real engine
 * or model gateway is involved. Determinism hinges on the cost
 * roll-up which already has its own determinism suite.
 */

import { describe, expect, it } from 'vitest';
import { Supervisor, type TerminationDecision } from '../src/index.js';
import { MockRuntimeAdapter, makeComposite, makeRunContext, makeSpec, usage } from './mocks.js';

describe('declarative termination (wave-17)', () => {
  it('does NOT fire when the spec carries no termination block', async () => {
    const adapter = new MockRuntimeAdapter(() => ({
      ok: true,
      output: 'TERMINATE here',
      usage: usage('mock', 'm', 1, 1, 1),
    }));
    adapter.registerSpec(makeSpec({ name: 'a' }));
    adapter.registerSpec(makeSpec({ name: 'b' }));
    const events: string[] = [];
    const sup = new Supervisor({
      runtime: adapter,
      emit: (e) => events.push(e.type),
    });
    const result = await sup.runComposite(
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
    expect(result.ok).toBe(true);
    expect(result.children).toHaveLength(2);
    expect(events).not.toContain('run.terminated_by');
  });

  it('maxTurns short-circuits sequential after N children', async () => {
    const adapter = new MockRuntimeAdapter(({ agent }) => ({
      ok: true,
      output: `R(${agent.name})`,
      usage: usage('mock', 'm', 1, 1, 0.01),
    }));
    for (const n of ['a', 'b', 'c', 'd']) adapter.registerSpec(makeSpec({ name: n }));
    const decisions: TerminationDecision[] = [];
    const sup = new Supervisor({
      runtime: adapter,
      emit: (e) => {
        if (e.type === 'run.terminated_by') decisions.push(e.payload as TerminationDecision);
      },
    });
    const result = await sup.runComposite(
      makeSpec({
        name: 'sup',
        composite: makeComposite({
          strategy: 'sequential',
          subagents: [{ name: 'a' }, { name: 'b' }, { name: 'c' }, { name: 'd' }],
        }),
        termination: { maxTurns: 2 },
      }),
      'in',
      makeRunContext(),
    );
    expect(result.ok).toBe(true);
    expect(result.children).toHaveLength(2);
    expect(decisions).toHaveLength(1);
    expect(decisions[0]?.reason).toBe('maxTurns');
    expect(decisions[0]?.detail).toMatchObject({ turns: 2, limit: 2 });
  });

  it('maxUsd short-circuits sequential when cumulative cost crosses cap', async () => {
    const adapter = new MockRuntimeAdapter(() => ({
      ok: true,
      output: 'x',
      usage: usage('mock', 'm', 100, 100, 0.4),
    }));
    for (const n of ['a', 'b', 'c', 'd']) adapter.registerSpec(makeSpec({ name: n }));
    const decisions: TerminationDecision[] = [];
    const sup = new Supervisor({
      runtime: adapter,
      emit: (e) => {
        if (e.type === 'run.terminated_by') decisions.push(e.payload as TerminationDecision);
      },
    });
    const result = await sup.runComposite(
      makeSpec({
        name: 'sup',
        composite: makeComposite({
          strategy: 'sequential',
          subagents: [{ name: 'a' }, { name: 'b' }, { name: 'c' }, { name: 'd' }],
        }),
        termination: { maxUsd: 1.0 },
      }),
      'in',
      makeRunContext(),
    );
    expect(result.ok).toBe(true);
    // 0.4 + 0.4 + 0.4 = 1.2 ≥ 1.0 → fires after the 3rd child
    expect(result.children).toHaveLength(3);
    expect(decisions).toHaveLength(1);
    expect(decisions[0]?.reason).toBe('maxUsd');
    const detail = decisions[0]?.detail as { usd: number; cap: number };
    expect(detail.cap).toBe(1.0);
    expect(detail.usd).toBeGreaterThanOrEqual(1.0);
  });

  it('textMention fires (case-insensitive) on a substring in any child output', async () => {
    let call = 0;
    const adapter = new MockRuntimeAdapter(() => {
      call += 1;
      // Second child emits the sentinel (lowercased — match must be CI).
      return {
        ok: true,
        output: call === 2 ? { message: 'all done, please terminate now' } : { message: 'continue' },
        usage: usage('mock', 'm', 1, 1, 0),
      };
    });
    for (const n of ['a', 'b', 'c']) adapter.registerSpec(makeSpec({ name: n }));
    const decisions: TerminationDecision[] = [];
    const sup = new Supervisor({
      runtime: adapter,
      emit: (e) => {
        if (e.type === 'run.terminated_by') decisions.push(e.payload as TerminationDecision);
      },
    });
    const result = await sup.runComposite(
      makeSpec({
        name: 'sup',
        composite: makeComposite({
          strategy: 'sequential',
          subagents: [{ name: 'a' }, { name: 'b' }, { name: 'c' }],
        }),
        termination: { textMention: 'TERMINATE' },
      }),
      'in',
      makeRunContext(),
    );
    expect(result.ok).toBe(true);
    expect(result.children).toHaveLength(2); // 'c' never spawned
    expect(decisions).toHaveLength(1);
    expect(decisions[0]?.reason).toBe('textMention');
    expect(decisions[0]?.detail).toMatchObject({ trigger: 'TERMINATE' });
  });

  it('successRoles fires when a child whose alias is in the list completes', async () => {
    const adapter = new MockRuntimeAdapter(({ agent }) => ({
      ok: true,
      output: `R(${agent.name})`,
      usage: usage('mock', 'm', 1, 1, 0),
    }));
    for (const n of ['drafter', 'reviewer', 'shipper']) {
      adapter.registerSpec(makeSpec({ name: n }));
    }
    const decisions: TerminationDecision[] = [];
    const sup = new Supervisor({
      runtime: adapter,
      emit: (e) => {
        if (e.type === 'run.terminated_by') decisions.push(e.payload as TerminationDecision);
      },
    });
    const result = await sup.runComposite(
      makeSpec({
        name: 'sup',
        composite: makeComposite({
          strategy: 'sequential',
          subagents: [
            { name: 'drafter', as: 'draft' },
            { name: 'reviewer', as: 'judge' },
            { name: 'shipper', as: 'ship' },
          ],
        }),
        termination: { successRoles: ['judge'] },
      }),
      'in',
      makeRunContext(),
    );
    expect(result.ok).toBe(true);
    expect(result.children).toHaveLength(2);
    expect(decisions).toHaveLength(1);
    expect(decisions[0]?.reason).toBe('successRoles');
    expect(decisions[0]?.detail).toMatchObject({ role: 'judge', agent: 'reviewer' });
  });

  it('parallel: stops pulling new work once a rule fires (inflight finish)', async () => {
    // 5 subagents, cap=2, maxTurns=2 → exactly two children land in
    // summaries, the rest are skipped by terminationFired.
    const adapter = new MockRuntimeAdapter(({ agent }) => ({
      ok: true,
      output: `R(${agent.name})`,
      usage: usage('mock', 'm', 1, 1, 0),
      delayMs: 10,
    }));
    for (const n of ['a', 'b', 'c', 'd', 'e']) adapter.registerSpec(makeSpec({ name: n }));
    const original = process.env.ALDO_MAX_PARALLEL_CHILDREN;
    process.env.ALDO_MAX_PARALLEL_CHILDREN = '2';
    let decisions = 0;
    try {
      const sup = new Supervisor({
        runtime: adapter,
        emit: (e) => {
          if (e.type === 'run.terminated_by') decisions += 1;
        },
      });
      const result = await sup.runComposite(
        makeSpec({
          name: 'sup',
          composite: makeComposite({
            strategy: 'parallel',
            subagents: [
              { name: 'a' },
              { name: 'b' },
              { name: 'c' },
              { name: 'd' },
              { name: 'e' },
            ],
          }),
          termination: { maxTurns: 2 },
        }),
        'in',
        makeRunContext(),
      );
      expect(result.ok).toBe(true);
      expect(result.children.length).toBeGreaterThanOrEqual(2);
      // never spawn ALL five — a few of the late ones must be skipped
      expect(result.children.length).toBeLessThan(5);
      expect(decisions).toBe(1);
    } finally {
      if (original === undefined) delete process.env.ALDO_MAX_PARALLEL_CHILDREN;
      else process.env.ALDO_MAX_PARALLEL_CHILDREN = original;
    }
  });

  it('iterative: a fired rule wins over the in-spec terminate predicate', async () => {
    // The subagent never naturally terminates (done:false always).
    // maxTurns:2 must cap the loop at 2 rounds.
    const adapter = new MockRuntimeAdapter(({ inputs }) => ({
      ok: true,
      output: { round: (inputs as { round: number }).round, done: false },
      usage: usage('mock', 'm', 1, 1, 0),
    }));
    adapter.registerSpec(makeSpec({ name: 'worker' }));
    const decisions: TerminationDecision[] = [];
    const sup = new Supervisor({
      runtime: adapter,
      emit: (e) => {
        if (e.type === 'run.terminated_by') decisions.push(e.payload as TerminationDecision);
      },
    });
    const result = await sup.runComposite(
      makeSpec({
        name: 'sup',
        composite: makeComposite({
          strategy: 'iterative',
          subagents: [{ name: 'worker' }],
          iteration: { maxRounds: 10, terminate: '$.done' },
        }),
        termination: { maxTurns: 2 },
      }),
      'goal',
      makeRunContext(),
    );
    expect(result.ok).toBe(true);
    expect(result.rounds).toBe(2);
    expect(decisions).toHaveLength(1);
    expect(decisions[0]?.reason).toBe('maxTurns');
    const out = result.output as { terminated: boolean; terminateReason: string };
    expect(out.terminated).toBe(true);
    expect(out.terminateReason).toBe('termination.maxTurns');
  });
});
