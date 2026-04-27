import { randomUUID } from 'node:crypto';
import type {
  AgentRef,
  AgentSpec,
  CompositeSpec,
  PrivacyTier,
  RunId,
  TenantId,
  UsageRecord,
} from '@aldo-ai/types';
import type { RunContext, SpawnedChildHandle, SupervisorRuntimeAdapter } from '../src/index.js';

const TENANT = 'tenant-orchestrator-tests' as TenantId;

/** Build a minimal AgentSpec with sane defaults. */
export function makeSpec(partial: Partial<AgentSpec> & { name: string }): AgentSpec {
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
    tools: { mcp: [], native: [], permissions: { network: 'none', filesystem: 'none' } },
    memory: { read: [], write: [], retention: {} },
    spawn: { allowed: [] },
    escalation: [],
    subscriptions: [],
    evalGate: { requiredSuites: [], mustPassBeforePromote: false },
    ...partial,
  } as AgentSpec;
}

/** Build a CompositeSpec with the given strategy + subagents. */
export function makeComposite(args: {
  readonly strategy: 'sequential' | 'parallel' | 'debate' | 'iterative';
  readonly subagents: readonly { readonly name: string; readonly as?: string }[];
  readonly aggregator?: string;
  readonly iteration?: { readonly maxRounds: number; readonly terminate: string };
}): CompositeSpec {
  return {
    strategy: args.strategy,
    subagents: args.subagents.map((s) => ({
      agent: s.name,
      ...(s.as !== undefined ? { as: s.as } : {}),
    })),
    ...(args.aggregator !== undefined ? { aggregator: args.aggregator } : {}),
    ...(args.iteration !== undefined ? { iteration: args.iteration } : {}),
  };
}

export interface MockChildRecord {
  readonly runId: RunId;
  readonly agent: AgentRef;
  readonly inputs: unknown;
  readonly parentRunId: RunId;
  readonly rootRunId: RunId;
  readonly tenant: TenantId;
  readonly privacy: PrivacyTier;
  readonly compositeStrategy?: 'sequential' | 'parallel' | 'debate' | 'iterative';
}

export interface MockHandlerCtx {
  readonly inputs: unknown;
  readonly agent: AgentRef;
  readonly callIndex: number;
}

export interface MockHandlerResult {
  readonly ok: boolean;
  readonly output: unknown;
  readonly usage?: UsageRecord;
  /** When set, the wait() Promise rejects with this error (sync throw of the run). */
  readonly throws?: Error;
  /** Latency in ms — useful for parallel-concurrency assertions. */
  readonly delayMs?: number;
}

/**
 * In-memory adapter that records every spawnChild call and runs a
 * caller-supplied handler to produce the child's "result". This is
 * the test bench for every strategy — it's deliberately tiny: the
 * real engine adapter is exercised in the engine integration test.
 */
export class MockRuntimeAdapter implements SupervisorRuntimeAdapter {
  public readonly children: MockChildRecord[] = [];
  public concurrencyPeak = 0;
  private inflight = 0;
  private callIndex = 0;
  private readonly specs = new Map<string, AgentSpec>();

  constructor(
    private readonly handler: (
      ctx: MockHandlerCtx,
    ) => MockHandlerResult | Promise<MockHandlerResult>,
  ) {}

  registerSpec(spec: AgentSpec): void {
    this.specs.set(spec.identity.name, spec);
  }

  async loadSpec(ref: AgentRef): Promise<AgentSpec> {
    const s = this.specs.get(ref.name);
    if (!s) throw new Error(`mock adapter: unknown agent '${ref.name}'`);
    return s;
  }

  async spawnChild(args: Omit<MockChildRecord, 'runId'>): Promise<SpawnedChildHandle> {
    const runId = randomUUID() as RunId;
    const record: MockChildRecord = { ...args, runId };
    this.children.push(record);
    const idx = this.callIndex++;
    const handler = this.handler;
    const inputs = args.inputs;
    const agent = args.agent;
    let cachedUsage: UsageRecord = zeroUsage();
    return {
      runId,
      wait: async () => {
        this.inflight++;
        if (this.inflight > this.concurrencyPeak) this.concurrencyPeak = this.inflight;
        try {
          const r = await handler({ inputs, agent, callIndex: idx });
          if (r.delayMs !== undefined) {
            await new Promise((res) => setTimeout(res, r.delayMs));
          }
          if (r.throws) throw r.throws;
          if (r.usage) cachedUsage = r.usage;
          return { ok: r.ok, output: r.output };
        } finally {
          this.inflight--;
        }
      },
      collectUsage: () => cachedUsage,
    };
  }
}

function zeroUsage(): UsageRecord {
  return {
    provider: 'mock',
    model: 'none',
    tokensIn: 0,
    tokensOut: 0,
    usd: 0,
    at: new Date(0).toISOString(),
  };
}

export function makeRunContext(args?: {
  readonly privacy?: PrivacyTier;
  readonly depth?: number;
  readonly signal?: AbortSignal;
}): RunContext {
  const id = randomUUID() as RunId;
  return {
    tenant: TENANT,
    parentRunId: id,
    rootRunId: id,
    depth: args?.depth ?? 0,
    privacy: args?.privacy ?? 'public',
    ...(args?.signal !== undefined ? { signal: args.signal } : {}),
  };
}

/**
 * Build a UsageRecord shaped like a real provider call. Used by the
 * cost-rollup determinism tests.
 */
export function usage(
  provider: string,
  model: string,
  tokensIn: number,
  tokensOut: number,
  usd: number,
  at = '2026-04-25T12:00:00.000Z',
): UsageRecord {
  return { provider, model, tokensIn, tokensOut, usd, at };
}
