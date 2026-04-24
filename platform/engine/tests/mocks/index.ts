import { randomUUID } from 'node:crypto';
import type {
  AgentRef,
  AgentRegistry,
  AgentSpec,
  Attrs,
  CallContext,
  CompletionRequest,
  Delta,
  ModelGateway,
  ReplayBundle,
  RunId,
  Span,
  SpanId,
  SpanKind,
  ToolDescriptor,
  ToolHost,
  ToolRef,
  ToolResult,
  TraceId,
  Tracer,
  ValidationResult,
} from '@meridian/types';

/** Build a minimal AgentSpec, overriding only what a test cares about. */
export function makeSpec(partial: Partial<AgentSpec> & { name: string }): AgentSpec {
  return {
    apiVersion: 'meridian/agent.v1',
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

export class MockRegistry implements AgentRegistry {
  private readonly specs = new Map<string, AgentSpec>();

  add(spec: AgentSpec): void {
    this.specs.set(spec.identity.name, spec);
  }

  async load(ref: AgentRef): Promise<AgentSpec> {
    const s = this.specs.get(ref.name);
    if (!s) throw new Error(`mock registry: unknown agent ${ref.name}`);
    return s;
  }

  validate(_yaml: string): ValidationResult {
    return { ok: true, errors: [] };
  }

  async list(): Promise<AgentRef[]> {
    return Array.from(this.specs.values()).map((s) => ({
      name: s.identity.name,
      version: s.identity.version,
    }));
  }

  async promote(): Promise<void> {
    /* no-op */
  }
}

export type Scripted = (
  req: CompletionRequest,
  ctx: CallContext,
  callIndex: number,
) => AsyncIterable<Delta> | Delta[];

/**
 * Mock gateway that drives one completion per call via a scripted function.
 * The function receives the CompletionRequest, CallContext and a call index.
 * If the ctx.signal is aborted during iteration, the mock throws.
 */
export class MockGateway implements ModelGateway {
  public calls = 0;
  public lastRequest?: CompletionRequest;
  public lastCtx?: CallContext;

  constructor(private readonly script: Scripted) {}

  async *complete(req: CompletionRequest, ctx: CallContext): AsyncIterable<Delta> {
    const idx = this.calls++;
    this.lastRequest = req;
    this.lastCtx = ctx;
    const out = this.script(req, ctx, idx);
    const signal = (ctx as CallContext & { signal?: AbortSignal }).signal;
    const iter = isAsyncIterable(out) ? out[Symbol.asyncIterator]() : syncToAsync(out);
    while (true) {
      if (signal?.aborted) {
        throw signal.reason ?? new Error('aborted');
      }
      const { value, done } = await iter.next();
      if (done) break;
      yield value;
    }
  }

  async embed(): Promise<readonly (readonly number[])[]> {
    return [];
  }
}

function isAsyncIterable(x: unknown): x is AsyncIterable<Delta> {
  return typeof (x as { [Symbol.asyncIterator]?: unknown })[Symbol.asyncIterator] === 'function';
}

function syncToAsync(arr: Delta[]): AsyncIterator<Delta> {
  let i = 0;
  return {
    async next(): Promise<IteratorResult<Delta>> {
      if (i >= arr.length) return { value: undefined as unknown as Delta, done: true };
      // Yield to the event loop so ctx.signal abort can land between deltas.
      await new Promise((r) => setImmediate(r));
      return { value: arr[i++] as Delta, done: false };
    },
  };
}

/** Build a text-only, one-delta-then-end completion. */
export function textCompletion(text: string, model = 'mock-1'): Delta[] {
  return [
    { textDelta: text },
    {
      end: {
        finishReason: 'stop',
        usage: {
          provider: 'mock',
          model,
          tokensIn: 1,
          tokensOut: Math.max(1, text.length),
          usd: 0,
          at: new Date().toISOString(),
        },
        model: {
          id: model,
          provider: 'mock',
          locality: 'local',
          provides: [],
          cost: { usdPerMtokIn: 0, usdPerMtokOut: 0 },
          privacyAllowed: ['public', 'internal', 'sensitive'],
          capabilityClass: 'reasoning-medium',
          effectiveContextTokens: 8192,
        },
      },
    },
  ];
}

export class MockToolHost implements ToolHost {
  public invocations: Array<{ tool: ToolRef; args: unknown }> = [];
  constructor(private readonly handler?: (ref: ToolRef, args: unknown) => unknown) {}

  async invoke(tool: ToolRef, args: unknown, _ctx: CallContext): Promise<ToolResult> {
    this.invocations.push({ tool, args });
    const v = this.handler ? this.handler(tool, args) : { echoed: args };
    return { ok: true, value: v };
  }

  async listTools(): Promise<readonly ToolDescriptor[]> {
    return [];
  }
}

export class MockTracer implements Tracer {
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
