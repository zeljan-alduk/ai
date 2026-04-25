import { describe, expect, it } from 'vitest';
import { Supervisor } from '../src/index.js';
import { MockRuntimeAdapter, makeComposite, makeRunContext, makeSpec, usage } from './mocks.js';

describe('parent_run_id / root_run_id linkage', () => {
  it('threads root + parent into every child run', async () => {
    const adapter = new MockRuntimeAdapter(({ agent }) => ({
      ok: true,
      output: agent.name,
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
          strategy: 'parallel',
          subagents: [{ name: 'a' }, { name: 'b' }],
        }),
      }),
      'in',
      ctx,
    );
    expect(adapter.children).toHaveLength(2);
    for (const c of adapter.children) {
      expect(c.parentRunId).toBe(ctx.parentRunId);
      expect(c.rootRunId).toBe(ctx.rootRunId);
      expect(c.tenant).toBe(ctx.tenant);
      expect(c.compositeStrategy).toBe('parallel');
    }
  });

  it('child events expose childRunId in payload', async () => {
    const adapter = new MockRuntimeAdapter(() => ({
      ok: true,
      output: 'x',
      usage: usage('mock', 'm', 1, 1, 0),
    }));
    adapter.registerSpec(makeSpec({ name: 'a' }));
    const events: { type: string; payload: { childRunId?: string } }[] = [];
    const sup = new Supervisor({
      runtime: adapter,
      emit: (e) => events.push({ type: e.type, payload: e.payload as { childRunId?: string } }),
    });
    await sup.runComposite(
      makeSpec({
        name: 'sup',
        composite: makeComposite({ strategy: 'sequential', subagents: [{ name: 'a' }] }),
      }),
      'in',
      makeRunContext(),
    );
    const start = events.find((e) => e.type === 'composite.child_started');
    const complete = events.find((e) => e.type === 'composite.child_completed');
    expect(start?.payload.childRunId).toBeDefined();
    expect(complete?.payload.childRunId).toBe(start?.payload.childRunId);
  });

  it('cascades sensitive privacy tier into a public-tier child', async () => {
    const adapter = new MockRuntimeAdapter(() => ({
      ok: true,
      output: 'x',
      usage: usage('mock', 'm', 1, 1, 0),
    }));
    // child declared as PUBLIC; parent is SENSITIVE → cascade narrows to sensitive.
    adapter.registerSpec(
      makeSpec({
        name: 'child',
        modelPolicy: {
          capabilityRequirements: [],
          privacyTier: 'public',
          primary: { capabilityClass: 'reasoning-medium' },
          fallbacks: [],
          budget: { usdMax: 1, usdGrace: 0.1 },
          decoding: { mode: 'free' },
        },
      }),
    );
    const sup = new Supervisor({ runtime: adapter, emit: () => undefined });
    await sup.runComposite(
      makeSpec({
        name: 'sup',
        composite: makeComposite({ strategy: 'sequential', subagents: [{ name: 'child' }] }),
      }),
      'in',
      makeRunContext({ privacy: 'sensitive' }),
    );
    expect(adapter.children[0]?.privacy).toBe('sensitive');
  });

  it('does NOT relax privacy when child declares looser tier', async () => {
    const adapter = new MockRuntimeAdapter(() => ({
      ok: true,
      output: 'x',
      usage: usage('mock', 'm', 1, 1, 0),
    }));
    adapter.registerSpec(
      makeSpec({
        name: 'child',
        modelPolicy: {
          capabilityRequirements: [],
          privacyTier: 'public', // tries to relax
          primary: { capabilityClass: 'reasoning-medium' },
          fallbacks: [],
          budget: { usdMax: 1, usdGrace: 0.1 },
          decoding: { mode: 'free' },
        },
      }),
    );
    const sup = new Supervisor({ runtime: adapter, emit: () => undefined });
    await sup.runComposite(
      makeSpec({
        name: 'sup',
        composite: makeComposite({ strategy: 'parallel', subagents: [{ name: 'child' }] }),
      }),
      'in',
      makeRunContext({ privacy: 'internal' }),
    );
    // Parent='internal', child='public' → must stay internal (or stricter).
    expect(adapter.children[0]?.privacy).toBe('internal');
  });

  it('allows the child to widen to a stricter tier', async () => {
    const adapter = new MockRuntimeAdapter(() => ({
      ok: true,
      output: 'x',
      usage: usage('mock', 'm', 1, 1, 0),
    }));
    adapter.registerSpec(
      makeSpec({
        name: 'child',
        modelPolicy: {
          capabilityRequirements: [],
          privacyTier: 'sensitive', // stricter than parent
          primary: { capabilityClass: 'reasoning-medium' },
          fallbacks: [],
          budget: { usdMax: 1, usdGrace: 0.1 },
          decoding: { mode: 'free' },
        },
      }),
    );
    const sup = new Supervisor({ runtime: adapter, emit: () => undefined });
    await sup.runComposite(
      makeSpec({
        name: 'sup',
        composite: makeComposite({ strategy: 'sequential', subagents: [{ name: 'child' }] }),
      }),
      'in',
      makeRunContext({ privacy: 'public' }),
    );
    expect(adapter.children[0]?.privacy).toBe('sensitive');
  });
});
