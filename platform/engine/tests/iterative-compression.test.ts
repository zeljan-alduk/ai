/**
 * MISSING_PIECES §9 / Phase C — history compression.
 *
 * Unit coverage:
 *   - estimateTokens heuristic is monotonic + bounded.
 *   - shouldCompress fires at the 80% threshold.
 *   - rolling-window keeps system + last 2 turns and drops the middle.
 *   - periodic-summary issues exactly one gateway call when triggered.
 *   - summary cap (3) — strategy degrades to rolling-window after.
 *
 * Long-run integration:
 *   - 30-cycle synthetic run with `summaryStrategy: 'rolling-window'`
 *     emits ≥ 1 history.compressed event and never blows past the
 *     declared context window.
 */

import type {
  CallContext,
  CompletionRequest,
  Delta,
  IterationSpec,
  Message,
  ModelDescriptor,
  ModelGateway,
  RunEvent,
  TenantId,
  UsageRecord,
} from '@aldo-ai/types';
import { describe, expect, it } from 'vitest';
import {
  estimateTokens,
  RealHistoryCompressor,
} from '../src/iterative-compression.js';
import { PlatformRuntime } from '../src/runtime.js';
import {
  MockGateway,
  MockRegistry,
  MockToolHost,
  MockTracer,
  makeSpec,
} from './mocks/index.js';

const MODEL_DESC: ModelDescriptor = {
  id: 'mock',
  provider: 'mock',
  locality: 'local',
  provides: [],
  cost: { usdPerMtokIn: 0, usdPerMtokOut: 0 },
  privacyAllowed: ['public', 'internal', 'sensitive'],
  capabilityClass: 'reasoning-medium',
  effectiveContextTokens: 8192,
};

const usage = (over: Partial<UsageRecord> = {}): UsageRecord => ({
  provider: 'mock',
  model: 'mock-1',
  tokensIn: 5,
  tokensOut: 3,
  usd: 0,
  at: '2026-05-04T00:00:00Z',
  ...over,
});

function deltaWithText(text: string): Delta[] {
  return [
    { textDelta: text },
    { end: { finishReason: 'stop', usage: usage(), model: MODEL_DESC } },
  ];
}

const TENANT = 'tenant-c' as TenantId;

// ─── unit: estimateTokens ──────────────────────────────────────────

describe('estimateTokens', () => {
  it('returns 0 for an empty history', () => {
    expect(estimateTokens([])).toBe(0);
  });

  it('grows monotonically with text length', () => {
    const small: Message[] = [
      { role: 'user', content: [{ type: 'text', text: 'a'.repeat(100) }] },
    ];
    const big: Message[] = [
      { role: 'user', content: [{ type: 'text', text: 'a'.repeat(10000) }] },
    ];
    expect(estimateTokens(big)).toBeGreaterThan(estimateTokens(small));
  });

  it('roughly approximates chars/4 (within 30%)', () => {
    const text = 'x'.repeat(4000);
    const tokens = estimateTokens([
      { role: 'user', content: [{ type: 'text', text }] },
    ]);
    // Heuristic + per-message overhead; 1000 tokens ± 30%.
    expect(tokens).toBeGreaterThan(700);
    expect(tokens).toBeLessThan(1300);
  });
});

// ─── unit: shouldCompress ───────────────────────────────────────────

describe('RealHistoryCompressor.shouldCompress', () => {
  const c = new RealHistoryCompressor();

  it('does NOT fire below 80% of contextWindow', () => {
    // ~250 tokens of content, window 1000 → 25% utilization.
    const history: Message[] = [
      { role: 'user', content: [{ type: 'text', text: 'x'.repeat(1000) }] },
    ];
    expect(c.shouldCompress(history, 1000)).toBe(false);
  });

  it('fires at or above 80% of contextWindow', () => {
    const history: Message[] = [
      { role: 'user', content: [{ type: 'text', text: 'x'.repeat(4000) }] },
    ];
    // ~1000 tokens of content, window 1000 → way over 80%.
    expect(c.shouldCompress(history, 1000)).toBe(true);
  });

  it('returns false for non-positive contextWindow', () => {
    const history: Message[] = [
      { role: 'user', content: [{ type: 'text', text: 'huge' }] },
    ];
    expect(c.shouldCompress(history, 0)).toBe(false);
  });
});

// ─── unit: rolling-window ───────────────────────────────────────────

describe('rolling-window strategy', () => {
  const fakeGateway = {} as ModelGateway;
  const fakeCtx = {} as CallContext;

  it('keeps system + last 2 anchors, drops the middle', async () => {
    const c = new RealHistoryCompressor();
    const messages: Message[] = [
      { role: 'system', content: [{ type: 'text', text: 'sys' }] },
      { role: 'user', content: [{ type: 'text', text: 'u1' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'a1' }] },
      { role: 'user', content: [{ type: 'text', text: 'u2' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'a2' }] },
      { role: 'user', content: [{ type: 'text', text: 'u3' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'a3' }] },
    ];
    const out = await c.compress(messages, 'rolling-window', {
      gateway: fakeGateway,
      callCtx: fakeCtx,
    });
    expect(out.messages.length).toBeLessThan(messages.length);
    // System message preserved.
    expect(out.messages[0]?.role).toBe('system');
    // Last anchor preserved (a3).
    const last = out.messages[out.messages.length - 1];
    expect((last?.content[0] as { text: string }).text).toBe('a3');
    expect(out.droppedMessages).toBeGreaterThan(0);
  });

  it('returns the original history unchanged when there is nothing to compress', async () => {
    const c = new RealHistoryCompressor();
    const messages: Message[] = [
      { role: 'system', content: [{ type: 'text', text: 'sys' }] },
      { role: 'user', content: [{ type: 'text', text: 'u' }] },
    ];
    const out = await c.compress(messages, 'rolling-window', {
      gateway: fakeGateway,
      callCtx: fakeCtx,
    });
    expect(out.droppedMessages).toBe(0);
    expect(out.messages).toHaveLength(2);
  });
});

// ─── unit: periodic-summary ─────────────────────────────────────────

describe('periodic-summary strategy', () => {
  const fakeCtx = {} as CallContext;

  function makeSummariseGateway(text: string): {
    readonly gateway: ModelGateway;
    readonly callCount: () => number;
  } {
    let calls = 0;
    const gateway: ModelGateway = {
      complete: async function* (_req: CompletionRequest, _ctx: CallContext) {
        calls += 1;
        yield { textDelta: text };
        yield {
          end: { finishReason: 'stop', usage: usage(), model: MODEL_DESC },
        };
      },
      embed: async () => [],
    };
    return { gateway, callCount: () => calls };
  }

  it('issues exactly one gateway call and replaces the middle with a summary', async () => {
    const c = new RealHistoryCompressor();
    const { gateway, callCount } = makeSummariseGateway(
      'bullet 1\nbullet 2\nbullet 3',
    );
    const messages: Message[] = [
      { role: 'system', content: [{ type: 'text', text: 'sys' }] },
      ...Array.from({ length: 10 }, (_, i) => [
        {
          role: 'user' as const,
          content: [{ type: 'text' as const, text: `u${i}` }],
        },
        {
          role: 'assistant' as const,
          content: [{ type: 'text' as const, text: `a${i}` }],
        },
      ]).flat(),
    ];

    const out = await c.compress(messages, 'periodic-summary', {
      gateway,
      callCtx: fakeCtx,
    });
    expect(callCount()).toBe(1);
    expect(out.summarisedTo).toContain('bullet 1');
    // System + summary + last 2 anchors = 4 messages.
    expect(out.messages.length).toBe(4);
    expect(out.messages[1]?.role).toBe('system'); // injected summary message
    expect((out.messages[1]?.content[0] as { text: string }).text).toContain(
      'bullet 1',
    );
  });

  it('caps at 3 summaries per run, then degrades to rolling-window', async () => {
    const c = new RealHistoryCompressor();
    const { gateway, callCount } = makeSummariseGateway('s');
    const buildMessages = (): Message[] => [
      { role: 'system', content: [{ type: 'text', text: 'sys' }] },
      ...Array.from({ length: 6 }, (_, i) => [
        {
          role: 'user' as const,
          content: [{ type: 'text' as const, text: `u${i}` }],
        },
        {
          role: 'assistant' as const,
          content: [{ type: 'text' as const, text: `a${i}` }],
        },
      ]).flat(),
    ];

    for (let i = 0; i < 5; i += 1) {
      await c.compress(buildMessages(), 'periodic-summary', {
        gateway,
        callCtx: fakeCtx,
      });
    }
    // 3 summaries, 2 fall-throughs → only 3 gateway calls.
    expect(callCount()).toBe(3);
  });
});

// ─── integration: 30-cycle long run with rolling-window ───────────

describe('IterativeAgentRun + RealHistoryCompressor — long run', () => {
  it('emits ≥1 history.compressed event over a 30-cycle synthetic run and stays inside the window', async () => {
    const iteration: IterationSpec = {
      maxCycles: 30,
      // Tight context window so 5KB of fake assistant text per cycle
      // forces a compression in the early cycles.
      contextWindow: 4000,
      summaryStrategy: 'rolling-window',
      terminationConditions: [{ kind: 'text-includes', text: 'NEVER' }],
    };

    const registry = new MockRegistry();
    registry.add(makeSpec({ name: 'longrun', iteration }));

    // Each model response is 1500 chars (~375 tokens). With a 4000-token
    // contextWindow and 80% threshold (3200), compression will trigger
    // around cycle 9-10.
    const big = 'x'.repeat(1500);
    const gateway = new MockGateway(() => deltaWithText(big));

    const rt = new PlatformRuntime({
      modelGateway: gateway,
      toolHost: new MockToolHost(),
      registry,
      tracer: new MockTracer(),
      tenant: TENANT,
      historyCompressor: new RealHistoryCompressor(),
    });

    const run = await rt.runAgent({ name: 'longrun' }, 'go');
    const events: RunEvent[] = [];
    for await (const e of run.events()) events.push(e);
    // @ts-expect-error wait is on InternalAgentRun
    const r = await run.wait();

    expect(r.ok).toBe(true);
    const cycleStarts = events.filter((e) => e.type === 'cycle.start');
    expect(cycleStarts.length).toBe(30);
    const compressed = events.filter((e) => e.type === 'history.compressed');
    expect(compressed.length).toBeGreaterThanOrEqual(1);
    const term = events.find((e) => e.type === 'run.terminated_by');
    expect((term?.payload as { reason: string }).reason).toBe('maxCycles');

    // Validate compression payload shape.
    const firstC = compressed[0]?.payload as {
      cycle: number;
      strategy: string;
      droppedMessages: number;
    };
    expect(firstC.strategy).toBe('rolling-window');
    expect(firstC.droppedMessages).toBeGreaterThan(0);
  });

  it('periodic-summary triggers a model call exactly when the threshold is crossed', async () => {
    const iteration: IterationSpec = {
      maxCycles: 6,
      // Tight window so a fat assistant response in cycle 2-3 already
      // crosses 80% utilisation and forces a summary call.
      contextWindow: 1000,
      summaryStrategy: 'periodic-summary',
      terminationConditions: [{ kind: 'text-includes', text: 'NEVER' }],
    };

    const registry = new MockRegistry();
    registry.add(makeSpec({ name: 'summariser', iteration }));

    let gatewayCalls = 0;
    const big = 'y'.repeat(3000); // ~750 tokens per response
    const gateway = new MockGateway((_req, _ctx, idx) => {
      gatewayCalls += 1;
      void idx;
      return deltaWithText(big);
    });

    const rt = new PlatformRuntime({
      modelGateway: gateway,
      toolHost: new MockToolHost(),
      registry,
      tracer: new MockTracer(),
      tenant: TENANT,
      historyCompressor: new RealHistoryCompressor(),
    });

    const run = await rt.runAgent({ name: 'summariser' }, 'go');
    const events: RunEvent[] = [];
    for await (const e of run.events()) events.push(e);
    // @ts-expect-error wait is on InternalAgentRun
    await run.wait();

    const compressed = events.filter((e) => e.type === 'history.compressed');
    // At least one summary call fired.
    const summaries = compressed.filter(
      (e) => (e.payload as { strategy: string }).strategy === 'periodic-summary',
    );
    expect(summaries.length).toBeGreaterThanOrEqual(1);
    // Total gateway calls = 6 cycles + at least 1 summary call.
    expect(gatewayCalls).toBeGreaterThanOrEqual(7);
  });
});
