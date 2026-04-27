import { describe, expect, it } from 'vitest';
import { Supervisor, rollup, sumUsage, zeroUsage } from '../src/index.js';
import { MockRuntimeAdapter, makeComposite, makeRunContext, makeSpec, usage } from './mocks.js';

describe('cost-rollup', () => {
  it('sums tokens deterministically', () => {
    const a = usage('p1', 'm1', 10, 5, 0.001);
    const b = usage('p1', 'm1', 7, 8, 0.002);
    const r = sumUsage([a, b]);
    expect(r.tokensIn).toBe(17);
    expect(r.tokensOut).toBe(13);
    // Two identical sums must produce identical totals.
    const r2 = sumUsage([a, b]);
    expect(r).toStrictEqual(r2);
  });

  it('rounds usd to 6 decimals (matches NUMERIC(14,6))', () => {
    // 0.1 + 0.2 = 0.30000000000000004 in IEEE754; the rollup must
    // collapse to 0.3 exactly so two replays produce the same row.
    const a = usage('p', 'm', 0, 0, 0.1);
    const b = usage('p', 'm', 0, 0, 0.2);
    const r = sumUsage([a, b]);
    expect(r.usd).toBe(0.3);
  });

  it('marks divergent provider/model with sentinels', () => {
    const a = usage('openai', 'gpt-4o', 1, 1, 0.001);
    const b = usage('anthropic', 'claude-sonnet', 1, 1, 0.002);
    const r = sumUsage([a, b]);
    expect(r.provider).toBe('aldo:composite');
    expect(r.model).toBe('multi');
  });

  it('keeps the latest at-timestamp', () => {
    const a = usage('p', 'm', 0, 0, 0, '2026-04-25T10:00:00.000Z');
    const b = usage('p', 'm', 0, 0, 0, '2026-04-25T11:00:00.000Z');
    const r = sumUsage([a, b]);
    expect(r.at).toBe('2026-04-25T11:00:00.000Z');
  });

  it('zero-record sum returns the canonical zero row', () => {
    const r = sumUsage([]);
    expect(r.tokensIn).toBe(0);
    expect(r.tokensOut).toBe(0);
    expect(r.usd).toBe(0);
    expect(r.provider).toBe('aldo:composite');
  });

  it('rollup() builds total from self + children', () => {
    const self = zeroUsage('2026-04-25T12:00:00.000Z');
    const c1 = usage('p', 'm', 5, 3, 0.005);
    const c2 = usage('p', 'm', 4, 2, 0.003);
    const r = rollup({ self, children: [c1, c2] });
    expect(r.total.tokensIn).toBe(9);
    expect(r.total.tokensOut).toBe(5);
    expect(r.total.usd).toBe(0.008);
  });

  it('two identical composite runs produce byte-equal totals', async () => {
    function buildAdapter(): MockRuntimeAdapter {
      const a = new MockRuntimeAdapter(({ agent, callIndex }) => ({
        ok: true,
        // Drive deterministic usage from the call index.
        output: agent.name,
        usage: usage(
          'mock',
          'mock-1',
          10 + callIndex,
          5 + callIndex,
          0.001 * (callIndex + 1),
          '2026-04-25T12:00:00.000Z',
        ),
      }));
      a.registerSpec(makeSpec({ name: 'a' }));
      a.registerSpec(makeSpec({ name: 'b' }));
      a.registerSpec(makeSpec({ name: 'c' }));
      return a;
    }
    const spec = makeSpec({
      name: 'sup',
      composite: makeComposite({
        strategy: 'sequential',
        subagents: [{ name: 'a' }, { name: 'b' }, { name: 'c' }],
      }),
    });
    const sup1 = new Supervisor({ runtime: buildAdapter(), emit: () => undefined });
    const sup2 = new Supervisor({ runtime: buildAdapter(), emit: () => undefined });
    const r1 = await sup1.runComposite(spec, 'in', makeRunContext());
    const r2 = await sup2.runComposite(spec, 'in', makeRunContext());
    expect(r1.totalUsage).toStrictEqual(r2.totalUsage);
  });

  it('emits a composite.usage_rollup event from the supervisor', async () => {
    const adapter = new MockRuntimeAdapter(() => ({
      ok: true,
      output: 'x',
      usage: usage('mock', 'm', 5, 5, 0.005),
    }));
    adapter.registerSpec(makeSpec({ name: 'a' }));
    adapter.registerSpec(makeSpec({ name: 'b' }));
    const events: { type: string; payload: unknown }[] = [];
    const sup = new Supervisor({
      runtime: adapter,
      emit: (e) => events.push({ type: e.type, payload: e.payload }),
    });
    await sup.runComposite(
      makeSpec({
        name: 'sup',
        composite: makeComposite({
          strategy: 'parallel',
          subagents: [{ name: 'a' }, { name: 'b' }],
        }),
      }),
      'in',
      makeRunContext(),
    );
    const rollupEv = events.find((e) => e.type === 'composite.usage_rollup');
    expect(rollupEv).toBeDefined();
    const payload = rollupEv?.payload as { total: { tokensIn: number; usd: number } };
    expect(payload.total.tokensIn).toBe(10);
    expect(payload.total.usd).toBe(0.01);
  });
});
