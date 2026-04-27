import { describe, expect, it } from 'vitest';
import {
  CompositeChildFailedError,
  CompositeSpecError,
  Supervisor,
  evalTerminate,
} from '../src/index.js';
import { MockRuntimeAdapter, makeComposite, makeRunContext, makeSpec, usage } from './mocks.js';

describe('error propagation + spec validation', () => {
  it('CompositeChildFailedError carries the chained child error', async () => {
    const adapter = new MockRuntimeAdapter(() => ({ ok: false, output: { error: 'detail' } }));
    adapter.registerSpec(makeSpec({ name: 'a' }));
    const sup = new Supervisor({ runtime: adapter, emit: () => undefined });
    try {
      await sup.runComposite(
        makeSpec({
          name: 'sup',
          composite: makeComposite({ strategy: 'sequential', subagents: [{ name: 'a' }] }),
        }),
        'in',
        makeRunContext(),
      );
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(CompositeChildFailedError);
      const e = err as CompositeChildFailedError;
      expect(e.code).toBe('composite_child_failed');
      expect(e.chained.message).toContain('detail');
    }
  });

  it('throws CompositeSpecError when runComposite called on a leaf spec', async () => {
    const adapter = new MockRuntimeAdapter(() => ({ ok: true, output: '' }));
    const sup = new Supervisor({ runtime: adapter, emit: () => undefined });
    await expect(
      sup.runComposite(makeSpec({ name: 'leaf' }), 'in', makeRunContext()),
    ).rejects.toBeInstanceOf(CompositeSpecError);
  });

  it('emits composite.child_failed for each failed child', async () => {
    const adapter = new MockRuntimeAdapter(({ agent }) => {
      if (agent.name === 'b') return { ok: false, output: { error: 'x' } };
      return { ok: true, output: agent.name, usage: usage('mock', 'm', 1, 1, 0) };
    });
    adapter.registerSpec(makeSpec({ name: 'a' }));
    adapter.registerSpec(makeSpec({ name: 'b' }));
    adapter.registerSpec(makeSpec({ name: 'c' }));
    const events: string[] = [];
    const sup = new Supervisor({ runtime: adapter, emit: (e) => events.push(e.type) });
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
    expect(events.filter((t) => t === 'composite.child_failed')).toHaveLength(1);
    expect(events.filter((t) => t === 'composite.child_completed')).toHaveLength(2);
  });

  it('a child run that throws synchronously surfaces as composite_child_failed', async () => {
    const adapter = new MockRuntimeAdapter(() => ({
      ok: true,
      output: 'x',
      throws: new Error('process exited'),
    }));
    adapter.registerSpec(makeSpec({ name: 'a' }));
    const sup = new Supervisor({ runtime: adapter, emit: () => undefined });
    try {
      await sup.runComposite(
        makeSpec({
          name: 'sup',
          composite: makeComposite({ strategy: 'sequential', subagents: [{ name: 'a' }] }),
        }),
        'in',
        makeRunContext(),
      );
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(CompositeChildFailedError);
      expect((err as CompositeChildFailedError).chained.message).toContain('process exited');
    }
  });
});

describe('jsonpath terminate evaluator', () => {
  function ok(expr: string, input: unknown): { truthy: boolean; value: unknown } {
    const r = evalTerminate(expr, input);
    if (!r.ok) throw new Error(`expected ok eval; got: ${r.reason}`);
    return { truthy: r.truthy, value: r.value };
  }

  it('handles `true` / `false` literals', () => {
    expect(ok('true', { x: 1 })).toEqual({ truthy: true, value: true });
    expect(ok('false', { x: 1 })).toEqual({ truthy: false, value: false });
  });

  it('handles `$` (whole input)', () => {
    expect(ok('$', { x: 1 }).truthy).toBe(true);
    expect(ok('$', null).truthy).toBe(false);
    expect(ok('$', '').truthy).toBe(false);
  });

  it('handles `$.foo` and `$.foo.bar`', () => {
    expect(ok('$.done', { done: true }).truthy).toBe(true);
    expect(ok('$.foo.bar', { foo: { bar: 'x' } }).truthy).toBe(true);
    expect(ok('$.foo.bar', { foo: {} }).truthy).toBe(false);
  });

  it('handles bracket-quoted keys', () => {
    expect(ok("$['weird-key']", { 'weird-key': 1 }).truthy).toBe(true);
  });

  it('returns ok=false on malformed expressions', () => {
    const r = evalTerminate('???', {});
    expect(r.ok).toBe(false);
  });
});
