/**
 * MISSING_PIECES §9 / Phase F — eval-side adapter tests.
 *
 * Unit:
 *   - extracts the canonical final output from an iterative event stream
 *   - prefers `run.completed.payload.output` over the last assistant message
 *   - composes text + final tool result with the documented delimiter
 *   - tolerates a leaf-style stream (no cycle.start) gracefully
 *
 * Integration:
 *   - drives the engine's IterativeAgentRun against a scripted gateway,
 *     pipes the resulting event stream through `iterativeRunOutput`,
 *     and feeds the composed output to `evaluate({ kind: 'contains' })`.
 *     End-to-end proof that an iterative run scores correctly via the
 *     existing string-based evaluator surface.
 */

import { randomUUID } from 'node:crypto';
import type {
  AgentRef,
  AgentRegistry,
  AgentSpec,
  Attrs,
  CallContext,
  CompletionRequest,
  Delta,
  IterationSpec,
  ModelDescriptor,
  ModelGateway,
  ReplayBundle,
  RunEvent,
  RunId,
  Span,
  SpanId,
  SpanKind,
  TenantId,
  ToolDescriptor,
  ToolHost,
  ToolRef,
  ToolResult,
  TraceId,
  Tracer,
  UsageRecord,
  ValidationResult,
} from '@aldo-ai/types';
import { describe, expect, it } from 'vitest';
import { iterativeRunOutput } from '../src/iterative-output.js';
import { evaluate } from '../src/evaluators/index.js';
import { PlatformRuntime } from '@aldo-ai/engine';

// Inline minimal mocks. The engine package already has a richer set
// in `engine/tests/mocks/index.ts`, but tsc rootDir prevents
// cross-package test imports — duplicating the bare minimum here
// keeps the eval test self-contained.

function makeSpec(partial: Partial<AgentSpec> & { name: string }): AgentSpec {
  return {
    apiVersion: 'aldo-ai/agent.v1',
    kind: 'Agent',
    identity: {
      name: partial.name,
      version: '1.0.0',
      description: `test agent ${partial.name}`,
      owner: 'tests',
      tags: [],
    },
    role: { team: 'test', pattern: 'worker' },
    modelPolicy: {
      capabilityRequirements: [],
      privacyTier: 'public',
      primary: { capabilityClass: 'reasoning-medium' },
      fallbacks: [],
      budget: { usdMax: 1, usdGrace: 0.1 },
      decoding: { mode: 'free' },
    },
    prompt: { systemFile: 'noop.md' },
    tools: {
      mcp: [],
      native: [],
      permissions: { network: 'none', filesystem: 'none' },
    },
    memory: { read: [], write: [], retention: {} },
    spawn: { allowed: [] },
    escalation: [],
    subscriptions: [],
    evalGate: { requiredSuites: [], mustPassBeforePromote: false },
    ...partial,
  } as AgentSpec;
}

class MockRegistry implements AgentRegistry {
  private readonly specs = new Map<string, AgentSpec>();
  add(spec: AgentSpec): void {
    this.specs.set(spec.identity.name, spec);
  }
  async load(ref: AgentRef): Promise<AgentSpec> {
    const s = this.specs.get(ref.name);
    if (!s) throw new Error(`mock: unknown agent ${ref.name}`);
    return s;
  }
  validate(_yaml: string): ValidationResult {
    return { ok: true, errors: [] };
  }
  async list(): Promise<AgentRef[]> {
    return Array.from(this.specs.values()).map((s) => ({ name: s.identity.name }));
  }
  async promote(): Promise<void> {
    /* no-op */
  }
}

type Scripted = (req: CompletionRequest, ctx: CallContext, idx: number) => Delta[];

class MockGateway implements ModelGateway {
  public calls = 0;
  constructor(private readonly script: Scripted) {}
  async *complete(req: CompletionRequest, ctx: CallContext): AsyncIterable<Delta> {
    const idx = this.calls++;
    const arr = this.script(req, ctx, idx);
    for (const d of arr) {
      await new Promise((r) => setImmediate(r));
      yield d;
    }
  }
  async embed(): Promise<readonly (readonly number[])[]> {
    return [];
  }
}

class MockToolHost implements ToolHost {
  constructor(private readonly handler?: (ref: ToolRef, args: unknown) => unknown) {}
  async invoke(tool: ToolRef, args: unknown, _ctx: CallContext): Promise<ToolResult> {
    const v = this.handler ? this.handler(tool, args) : { echoed: args };
    return { ok: true, value: v };
  }
  async listTools(): Promise<readonly ToolDescriptor[]> {
    return [];
  }
}

class MockTracer implements Tracer {
  async span<T>(
    _name: string,
    kind: SpanKind,
    _attrs: Attrs,
    fn: (s: Span) => Promise<T>,
  ): Promise<T> {
    const s: Span = {
      id: randomUUID() as SpanId,
      traceId: randomUUID() as TraceId,
      kind,
      setAttr() {},
      event() {},
      end() {},
    };
    return fn(s);
  }
  async export(runId: RunId): Promise<ReplayBundle> {
    return { runId, traceId: randomUUID() as TraceId, checkpoints: [] };
  }
}

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
  tokensIn: 10,
  tokensOut: 5,
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

const at = (s: string): string => `2026-05-04T08:00:${s.padStart(2, '0')}Z`;

describe('iterativeRunOutput — pure extractor', () => {
  it('returns empty bundle for an empty event stream', () => {
    const out = iterativeRunOutput([]);
    expect(out).toEqual({
      text: '',
      finalToolResult: null,
      cycles: 0,
      terminatedBy: null,
      composedForEval: '',
    });
  });

  it('counts cycles via cycle.start events', () => {
    const events: RunEvent[] = [
      { type: 'cycle.start', at: at('00'), payload: { cycle: 1 } },
      { type: 'cycle.start', at: at('01'), payload: { cycle: 2 } },
      { type: 'cycle.start', at: at('02'), payload: { cycle: 3 } },
    ];
    expect(iterativeRunOutput(events).cycles).toBe(3);
  });

  it('prefers run.completed.payload.output over the last assistant message text', () => {
    const events: RunEvent[] = [
      { type: 'cycle.start', at: at('00'), payload: { cycle: 1 } },
      {
        type: 'message',
        at: at('01'),
        payload: { role: 'assistant', content: [{ type: 'text', text: 'intermediate' }] },
      },
      { type: 'cycle.start', at: at('02'), payload: { cycle: 2 } },
      {
        type: 'message',
        at: at('03'),
        payload: { role: 'assistant', content: [{ type: 'text', text: 'penultimate' }] },
      },
      {
        type: 'run.completed',
        at: at('04'),
        payload: { output: 'CANONICAL FINAL', terminatedBy: 'tool-result' },
      },
    ];
    const out = iterativeRunOutput(events);
    expect(out.text).toBe('CANONICAL FINAL');
  });

  it('falls back to the last assistant text when run.completed.output is missing', () => {
    const events: RunEvent[] = [
      { type: 'cycle.start', at: at('00'), payload: { cycle: 1 } },
      {
        type: 'message',
        at: at('01'),
        payload: { role: 'assistant', content: [{ type: 'text', text: 'last text wins' }] },
      },
    ];
    expect(iterativeRunOutput(events).text).toBe('last text wins');
  });

  it('captures the LAST tool result and stringifies it for eval', () => {
    const events: RunEvent[] = [
      { type: 'cycle.start', at: at('00'), payload: { cycle: 1 } },
      {
        type: 'tool_result',
        at: at('01'),
        payload: { callId: 'a', result: { exitCode: 1 }, isError: true },
      },
      { type: 'cycle.start', at: at('02'), payload: { cycle: 2 } },
      {
        type: 'tool_result',
        at: at('03'),
        payload: { callId: 'b', result: { exitCode: 0, stdout: 'OK' }, isError: false },
      },
      { type: 'run.completed', at: at('04'), payload: { output: 'all good' } },
    ];
    const out = iterativeRunOutput(events);
    expect(out.finalToolResult).toBe(JSON.stringify({ exitCode: 0, stdout: 'OK' }));
    expect(out.composedForEval).toBe(
      `all good\n\n[final tool result]\n${JSON.stringify({ exitCode: 0, stdout: 'OK' })}`,
    );
  });

  it('captures the run.terminated_by reason for downstream report rendering', () => {
    const events: RunEvent[] = [
      { type: 'cycle.start', at: at('00'), payload: { cycle: 1 } },
      {
        type: 'run.terminated_by',
        at: at('01'),
        payload: { reason: 'budget-exhausted', detail: { usd: 0.5, cap: 0.5 } },
      },
    ];
    expect(iterativeRunOutput(events).terminatedBy).toBe('budget-exhausted');
  });

  it('tolerates a leaf-style stream (no cycle.start) gracefully', () => {
    const events: RunEvent[] = [
      {
        type: 'message',
        at: at('00'),
        payload: { role: 'assistant', content: [{ type: 'text', text: 'leaf' }] },
      },
      { type: 'run.completed', at: at('01'), payload: { output: 'leaf done' } },
    ];
    const out = iterativeRunOutput(events);
    expect(out.cycles).toBe(0);
    expect(out.text).toBe('leaf done');
    expect(out.composedForEval).toBe('leaf done');
  });
});

// ─── integration: end-to-end IterativeAgentRun → extractor → evaluator ───

describe('iterativeRunOutput — integration with the engine + evaluators', () => {
  it('an iterative run\'s output scores correctly via `evaluate({ kind: contains })`', async () => {
    const iteration: IterationSpec = {
      maxCycles: 3,
      contextWindow: 8000,
      summaryStrategy: 'rolling-window',
      terminationConditions: [{ kind: 'text-includes', text: 'TASK-OK' }],
    };

    const registry = new MockRegistry();
    registry.add(makeSpec({ name: 'eval-target', iteration }));

    let call = 0;
    const gateway = new MockGateway((_req: CompletionRequest, _ctx: CallContext, idx: number) => {
      call += 1;
      void idx;
      // Cycle 1: the model "reasons" about the task.
      if (call === 1) return deltaWithText('first I think about the problem');
      // Cycle 2: the model declares the task done — this fires the
      // text-includes terminator, so cycle 2 is the final cycle.
      return deltaWithText('all checks passed: TASK-OK');
    });

    const TENANT = 'tenant-eval' as TenantId;
    const rt = new PlatformRuntime({
      modelGateway: gateway,
      toolHost: new MockToolHost(),
      registry,
      tracer: new MockTracer(),
      tenant: TENANT,
    });

    const run = await rt.runAgent({ name: 'eval-target' }, 'do the thing');
    const events: RunEvent[] = [];
    for await (const e of run.events()) events.push(e);
    // @ts-expect-error wait is on InternalAgentRun
    await run.wait();

    // Pipe through the extractor.
    const extracted = iterativeRunOutput(events);
    expect(extracted.cycles).toBe(2);
    expect(extracted.terminatedBy).toBe('text-includes');
    expect(extracted.text).toContain('TASK-OK');

    // Hand the composed string to the existing evaluator surface.
    const okResult = await evaluate(extracted.composedForEval, {
      kind: 'contains',
      value: 'TASK-OK',
    });
    expect(okResult.passed).toBe(true);
    expect(okResult.score).toBeGreaterThan(0);

    const failResult = await evaluate(extracted.composedForEval, {
      kind: 'contains',
      value: 'should-not-be-there',
    });
    expect(failResult.passed).toBe(false);
  });

  it('failure case: composed output exposes a failing tool result for the rubric to see', async () => {
    // A run that hits maxCycles without termination — the composed
    // output carries the final assistant text + any final tool result,
    // so a `contains: 'exitCode: 1'`-style assertion catches the
    // failure mode in the rubric.
    const iteration: IterationSpec = {
      maxCycles: 1,
      contextWindow: 8000,
      summaryStrategy: 'rolling-window',
      terminationConditions: [],
    };

    const registry = new MockRegistry();
    registry.add(
      makeSpec({
        name: 'flaky',
        iteration,
        tools: {
          mcp: [{ server: 'aldo-shell', allow: ['shell.exec'] }],
          native: [],
          permissions: { network: 'none', filesystem: 'none' },
        },
      }),
    );

    const gateway = new MockGateway(() => [
      {
        toolCall: {
          type: 'tool_call',
          callId: 't',
          tool: 'aldo-shell.shell.exec',
          args: { cmd: 'false' },
        },
      },
      { end: { finishReason: 'tool_use', usage: usage(), model: MODEL_DESC } },
    ]);
    const toolHost = new MockToolHost(() => ({ exitCode: 1, stdout: '', stderr: 'fail' }));

    const rt = new PlatformRuntime({
      modelGateway: gateway,
      toolHost,
      registry,
      tracer: new MockTracer(),
      tenant: 'tenant-eval' as TenantId,
    });

    const run = await rt.runAgent({ name: 'flaky' }, 'go');
    const events: RunEvent[] = [];
    for await (const e of run.events()) events.push(e);
    // @ts-expect-error wait is on InternalAgentRun
    await run.wait();

    const extracted = iterativeRunOutput(events);
    expect(extracted.terminatedBy).toBe('maxCycles');
    expect(extracted.composedForEval).toContain('exitCode');
    expect(extracted.composedForEval).toContain('1'); // exitCode: 1
  });
});
