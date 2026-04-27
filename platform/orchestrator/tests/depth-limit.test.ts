import { describe, expect, it } from 'vitest';
import { CompositeDepthExceededError, DEFAULT_MAX_AGENT_DEPTH, Supervisor } from '../src/index.js';
import { MockRuntimeAdapter, makeComposite, makeRunContext, makeSpec, usage } from './mocks.js';

describe('depth-limit', () => {
  it('throws CompositeDepthExceededError when depth > limit', async () => {
    const original = process.env.ALDO_MAX_AGENT_DEPTH;
    process.env.ALDO_MAX_AGENT_DEPTH = '2';
    try {
      const adapter = new MockRuntimeAdapter(() => ({
        ok: true,
        output: '',
        usage: usage('mock', 'm', 1, 1, 0),
      }));
      adapter.registerSpec(makeSpec({ name: 'a' }));
      const sup = new Supervisor({ runtime: adapter, emit: () => undefined });
      await expect(
        sup.runComposite(
          makeSpec({
            name: 'sup',
            composite: makeComposite({ strategy: 'sequential', subagents: [{ name: 'a' }] }),
          }),
          'in',
          makeRunContext({ depth: 3 }),
        ),
      ).rejects.toBeInstanceOf(CompositeDepthExceededError);
      // No child should have been spawned — fail-closed BEFORE any spawn.
      expect(adapter.children).toHaveLength(0);
    } finally {
      if (original === undefined) process.env.ALDO_MAX_AGENT_DEPTH = undefined;
      else process.env.ALDO_MAX_AGENT_DEPTH = original;
    }
  });

  it('uses default limit of 5 when env unset', async () => {
    const original = process.env.ALDO_MAX_AGENT_DEPTH;
    process.env.ALDO_MAX_AGENT_DEPTH = undefined;
    try {
      const adapter = new MockRuntimeAdapter(() => ({
        ok: true,
        output: '',
        usage: usage('mock', 'm', 1, 1, 0),
      }));
      adapter.registerSpec(makeSpec({ name: 'a' }));
      const sup = new Supervisor({ runtime: adapter, emit: () => undefined });
      // Depth = limit is allowed (the limit is exclusive on the throw — depth>limit only).
      const result = await sup.runComposite(
        makeSpec({
          name: 'sup',
          composite: makeComposite({ strategy: 'sequential', subagents: [{ name: 'a' }] }),
        }),
        'in',
        makeRunContext({ depth: DEFAULT_MAX_AGENT_DEPTH }),
      );
      expect(result.ok).toBe(true);
    } finally {
      if (original !== undefined) process.env.ALDO_MAX_AGENT_DEPTH = original;
    }
  });

  it('throws CompositeDepthExceededError BEFORE any child is spawned', async () => {
    process.env.ALDO_MAX_AGENT_DEPTH = '1';
    try {
      let spawnCount = 0;
      const adapter = new MockRuntimeAdapter(() => {
        spawnCount++;
        return { ok: true, output: '' };
      });
      adapter.registerSpec(makeSpec({ name: 'a' }));
      const sup = new Supervisor({ runtime: adapter, emit: () => undefined });
      await expect(
        sup.runComposite(
          makeSpec({
            name: 'sup',
            composite: makeComposite({ strategy: 'parallel', subagents: [{ name: 'a' }] }),
          }),
          'in',
          makeRunContext({ depth: 5 }),
        ),
      ).rejects.toBeInstanceOf(CompositeDepthExceededError);
      expect(spawnCount).toBe(0);
    } finally {
      process.env.ALDO_MAX_AGENT_DEPTH = undefined;
    }
  });
});
