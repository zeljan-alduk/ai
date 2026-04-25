import { randomUUID } from 'node:crypto';
import type { SandboxRunner } from '@aldo-ai/sandbox';
import type {
  AgentRef,
  AgentRegistry,
  AgentRun,
  AgentSpec,
  ModelGateway,
  PrivacyTier,
  RunEvent,
  RunId,
  Runtime,
  TenantId,
  ToolHost,
  Tracer,
  UsageRecord,
} from '@aldo-ai/types';
import { type InternalAgentRun, LeafAgentRun, type SecretArgResolver } from './agent-run.js';
import { type Checkpointer, InMemoryCheckpointer } from './checkpointer/index.js';
import type { BreakpointStore } from './debugger/breakpoint-store.js';
import type { PauseController } from './debugger/pause-controller.js';
import type { RunStore } from './stores/postgres-run-store.js';

/**
 * Wave-9: structural interface the engine uses to call into
 * `@aldo-ai/orchestrator` WITHOUT a compile-time import (which would
 * create a cycle since the orchestrator depends on the engine).
 *
 * The Supervisor class in @aldo-ai/orchestrator implements this shape
 * exactly; consumers wire it via `RuntimeDeps.orchestrator`. When the
 * runtime spawns an agent whose spec has a `composite` block, it
 * delegates to `orchestrator.runComposite(...)` instead of constructing
 * a `LeafAgentRun`.
 */
export interface CompositeOrchestrator {
  runComposite(
    spec: AgentSpec,
    input: unknown,
    ctx: {
      readonly tenant: TenantId;
      readonly parentRunId: RunId;
      readonly rootRunId: RunId;
      readonly depth: number;
      readonly privacy: PrivacyTier;
      readonly signal?: AbortSignal;
    },
  ): Promise<{
    readonly ok: boolean;
    readonly output: unknown;
    readonly totalUsage: UsageRecord;
  }>;
}

/**
 * Adapter the orchestrator passes back into the engine to spawn child
 * runs through the existing `runtime.spawn` code path. This is exposed
 * via `PlatformRuntime.asSupervisorAdapter()` so test harnesses can
 * stand the orchestrator up without having a real Supervisor in the
 * type graph.
 */
export interface SpawnedChildHandle {
  readonly runId: RunId;
  wait(): Promise<{ readonly ok: boolean; readonly output: unknown }>;
  collectUsage(): UsageRecord;
}

export interface SupervisorRuntimeAdapter {
  spawnChild(args: {
    readonly agent: AgentRef;
    readonly inputs: unknown;
    readonly parentRunId: RunId;
    readonly rootRunId: RunId;
    readonly tenant: TenantId;
    readonly privacy: PrivacyTier;
    readonly compositeStrategy?: 'sequential' | 'parallel' | 'debate' | 'iterative';
    readonly signal?: AbortSignal;
  }): Promise<SpawnedChildHandle>;
  loadSpec(ref: AgentRef): Promise<AgentSpec>;
}

export interface RuntimeDeps {
  readonly modelGateway: ModelGateway;
  readonly toolHost: ToolHost;
  readonly registry: AgentRegistry;
  readonly tracer: Tracer;
  readonly tenant: TenantId;
  readonly checkpointer?: Checkpointer;
  /**
   * Optional debugger primitives. When supplied, the engine consults
   * `breakpoints` before every model call + tool dispatch and parks the
   * loop on `pauseController` if a match fires. Both must be supplied
   * together (a breakpoint store with no controller would never be
   * able to release a paused run).
   */
  readonly breakpoints?: BreakpointStore;
  readonly pauseController?: PauseController;
  /** Optional persistence for runs + run events. Defaults to in-memory only. */
  readonly runStore?: RunStore;
  /**
   * Optional `secret://NAME` resolver. When present, every tool call's
   * args are scanned for references and substituted before reaching
   * ToolHost. The host injects an implementation backed by
   * `@aldo-ai/secrets`; tests can pass a stub.
   */
  readonly secretResolver?: SecretArgResolver;
  /**
   * Optional sandbox runner that wraps every native + MCP tool
   * dispatch. When absent, the engine builds a default
   * `SandboxRunner` (in-process driver, no real isolation) — agents
   * marked `privacy_tier: sensitive` should always be paired with a
   * `subprocess`-driver runner from runtime config.
   */
  readonly sandbox?: SandboxRunner;
  /**
   * Wave-9: optional composite orchestrator. When supplied, the engine
   * delegates to `orchestrator.runComposite(...)` for any agent whose
   * spec carries a `composite` block. When absent (default), composite
   * agents fail closed with a typed error — fail-closed because a
   * composite spec without a runtime would silently degrade to a
   * single-agent run, which is wrong.
   */
  readonly orchestrator?: CompositeOrchestrator;
}

/**
 * Wave-9: opts carried through the recursive spawn paths. Not part of
 * the public Runtime interface — only the orchestrator adapter passes
 * these in.
 */
export interface SpawnOpts {
  /** Whether the spawn was approved by a composite supervisor's spec. */
  readonly fromComposite?: boolean;
  /** Top-of-tree run id so child runs can find their root in O(1). */
  readonly rootRunId?: RunId;
  /** Strategy that spawned this run; persisted on the runs row. */
  readonly compositeStrategy?: 'sequential' | 'parallel' | 'debate' | 'iterative';
}

/**
 * Typed error raised when a composite spec is run without an
 * orchestrator wired into RuntimeDeps. Fail-closed: a composite agent
 * with no runtime would silently degrade to a single-agent run.
 */
export class CompositeRuntimeMissingError extends Error {
  readonly code = 'composite_runtime_missing' as const;
  constructor(agentName: string) {
    super(
      `agent '${agentName}' carries a composite block but no orchestrator was supplied to RuntimeDeps`,
    );
    this.name = 'CompositeRuntimeMissingError';
  }
}

/**
 * Wave-9: lightweight wrapper that satisfies the public AgentRun
 * surface around a composite Promise<OrchestrationResult>. Composite
 * runs don't have an event-stream of their own (their children are
 * first-class Runs); the wrapper closes the events iterator
 * immediately so callers that drain `for await (const e of run.events())`
 * don't hang.
 */
class CompositeAgentRun implements AgentRun {
  readonly id: RunId;
  private readonly resultP: Promise<{
    readonly ok: boolean;
    readonly output: unknown;
    readonly totalUsage: UsageRecord;
  }>;
  private readonly runStore: RunStore | undefined;

  constructor(
    id: RunId,
    resultP: Promise<{
      readonly ok: boolean;
      readonly output: unknown;
      readonly totalUsage: UsageRecord;
    }>,
    runStore: RunStore | undefined,
  ) {
    this.id = id;
    this.resultP = resultP;
    this.runStore = runStore;
    void this.recordEnd();
  }

  private async recordEnd(): Promise<void> {
    try {
      const r = await this.resultP;
      if (this.runStore) {
        await this.runStore.recordRunEnd({
          runId: this.id,
          status: r.ok ? 'completed' : 'failed',
        });
      }
    } catch {
      if (this.runStore) {
        await this.runStore.recordRunEnd({ runId: this.id, status: 'failed' });
      }
    }
  }

  async send(): Promise<void> {
    throw new Error('composite runs do not accept send(); send to a child instead');
  }
  async cancel(): Promise<void> {
    // v0: cancellation propagation lives on individual children. The
    // signal that the orchestrator threads in was bound at construction
    // time; surfacing a cancellable controller is wave-10 work.
  }
  async checkpoint(): Promise<import('@aldo-ai/types').CheckpointId> {
    throw new Error('composite runs are not directly checkpointable; checkpoint a child instead');
  }
  async resume(): Promise<AgentRun> {
    throw new Error('composite runs replay through the orchestrator, not via resume()');
  }
  events(): AsyncIterable<RunEvent> {
    return {
      [Symbol.asyncIterator]: (): AsyncIterator<RunEvent> => ({
        next: (): Promise<IteratorResult<RunEvent>> =>
          Promise.resolve({ value: undefined as unknown as RunEvent, done: true }),
      }),
    };
  }
  /** Public bridge to the orchestrator's terminal result. */
  async wait(): Promise<{ ok: boolean; output: unknown; totalUsage: UsageRecord }> {
    return this.resultP;
  }
}

/**
 * Roll-up helper local to the engine. Mirrors the orchestrator's
 * `sumUsage()` rules but is duplicated here so the engine doesn't
 * import @aldo-ai/orchestrator (which would create a cycle).
 */
function sumUsageRecords(records: readonly UsageRecord[]): UsageRecord {
  if (records.length === 0) {
    return {
      provider: 'aldo:composite',
      model: 'multi',
      tokensIn: 0,
      tokensOut: 0,
      usd: 0,
      at: new Date(0).toISOString(),
    };
  }
  let tokensIn = 0;
  let tokensOut = 0;
  let usdRaw = 0;
  let latestAt = records[0]?.at ?? new Date(0).toISOString();
  let provider: string | null = records[0]?.provider ?? null;
  let model: string | null = records[0]?.model ?? null;
  for (const r of records) {
    tokensIn += r.tokensIn;
    tokensOut += r.tokensOut;
    usdRaw += r.usd;
    if (r.at > latestAt) latestAt = r.at;
    if (provider !== null && provider !== r.provider) provider = 'aldo:composite';
    if (model !== null && model !== r.model) model = 'multi';
  }
  const usd = Math.round(usdRaw * 1_000_000) / 1_000_000;
  return {
    provider: provider ?? 'aldo:composite',
    model: model ?? 'multi',
    tokensIn,
    tokensOut,
    usd,
    at: latestAt,
  };
}

/**
 * Permission for spawning children is enforced here: a parent agent
 * may only spawn children whose names appear in its spec.spawn.allowed.
 */
export class PlatformRuntime implements Runtime {
  private readonly runs = new Map<RunId, InternalAgentRun>();
  /** Wave-9: composite supervisor wrappers, keyed by their synthesised id. */
  private readonly composites = new Map<RunId, CompositeAgentRun>();
  /**
   * Wave-9: composite-strategy + root-run linkage per run. Populated
   * by `spawn()` for every child and by `runAgent()` for composite
   * roots. Used by debug tools that want the linkage without a round
   * trip through the run store.
   */
  private readonly runMeta = new Map<
    RunId,
    {
      readonly rootRunId: RunId;
      readonly compositeStrategy?: 'sequential' | 'parallel' | 'debate' | 'iterative';
    }
  >();
  private readonly modelGateway: ModelGateway;
  private readonly toolHost: ToolHost;
  private readonly registry: AgentRegistry;
  private readonly tracer: Tracer;
  private readonly tenant: TenantId;
  private readonly checkpointer: Checkpointer;
  private readonly breakpoints: BreakpointStore | undefined;
  private readonly pauseController: PauseController | undefined;
  private readonly runStore: RunStore | undefined;
  private readonly secretResolver: SecretArgResolver | undefined;
  private readonly sandbox: SandboxRunner | undefined;
  private readonly orchestrator: CompositeOrchestrator | undefined;

  constructor(deps: RuntimeDeps) {
    this.modelGateway = deps.modelGateway;
    this.toolHost = deps.toolHost;
    this.registry = deps.registry;
    this.tracer = deps.tracer;
    this.tenant = deps.tenant;
    this.checkpointer = deps.checkpointer ?? new InMemoryCheckpointer();
    this.breakpoints = deps.breakpoints;
    this.pauseController = deps.pauseController;
    this.runStore = deps.runStore;
    this.secretResolver = deps.secretResolver;
    this.sandbox = deps.sandbox;
    this.orchestrator = deps.orchestrator;
  }

  /**
   * Wave-9: late-binding setter for the composite orchestrator.
   *
   * The Supervisor needs a `SupervisorRuntimeAdapter` at construction
   * time which can only come from an already-constructed runtime; we
   * resolve the chicken-and-egg by allowing the orchestrator to be
   * attached after the fact. Once set it's permanent — re-calling
   * throws (orchestrators must be unique per runtime instance).
   */
  setOrchestrator(orchestrator: CompositeOrchestrator): void {
    if (this.orchestrator !== undefined) {
      throw new Error('orchestrator already set on this runtime');
    }
    // Mutating a private readonly via assignment requires bypassing
    // the readonly modifier; treat the field as set-once.
    (this as unknown as { orchestrator: CompositeOrchestrator | undefined }).orchestrator =
      orchestrator;
  }

  /** Read-only access for tests + tools that need to observe live pauses. */
  getPauseController(): PauseController | undefined {
    return this.pauseController;
  }

  /** Read-only access for tests + the API layer. */
  getBreakpointStore(): BreakpointStore | undefined {
    return this.breakpoints;
  }

  /** Read-only access for tests + the API layer. */
  getRunStore(): RunStore | undefined {
    return this.runStore;
  }

  async spawn(ref: AgentRef, inputs: unknown, parent?: RunId, opts?: SpawnOpts): Promise<AgentRun> {
    if (parent !== undefined) {
      // The composite orchestrator spawns children whose names come
      // from the parent's `composite.subagents[]` list — those are
      // pre-approved by the supervisor's spec block; the parent in
      // that case is a synthetic CompositeAgentRun that isn't tracked
      // in `runs` (it's in `composites`). Skip the spawn-allowed
      // check when the orchestrator already approved the spawn.
      const orchestratorApproved = opts?.fromComposite === true;
      if (!orchestratorApproved) {
        const parentRun = this.runs.get(parent);
        if (!parentRun) throw new Error(`unknown parent run: ${parent}`);
        const parentSpec = await this.registry.load(parentRun.ref);
        if (!parentSpec.spawn.allowed.includes(ref.name)) {
          throw new SpawnNotAllowedError(parentRun.ref.name, ref.name);
        }
      }
    }

    const spec = await this.registry.load(ref);
    const id = randomUUID() as RunId;
    // Capture the root + strategy linkage so collectUsage / debug
    // tooling can retrieve it without round-tripping the run store.
    const rootRunId: RunId = opts?.rootRunId ?? parent ?? id;
    this.runMeta.set(id, {
      rootRunId,
      ...(opts?.compositeStrategy !== undefined
        ? { compositeStrategy: opts.compositeStrategy }
        : {}),
    });

    // Pre-record the run row WITH the wave-9 fields before the
    // LeafAgentRun's own (sub-set) recordRunStart fires on construction.
    // recordRunStart is idempotent under `ON CONFLICT DO NOTHING`, so
    // whichever write lands first wins — and we want this one to win
    // because it carries the orchestrator-supplied root + strategy.
    if (this.runStore) {
      await this.runStore.recordRunStart({
        runId: id,
        tenant: this.tenant,
        ref,
        ...(parent !== undefined ? { parent } : {}),
        root: rootRunId,
        ...(opts?.compositeStrategy !== undefined
          ? { compositeStrategy: opts.compositeStrategy }
          : {}),
      });
    }

    const run = new LeafAgentRun(
      {
        id,
        tenant: this.tenant,
        ref,
        spec,
        inputs,
        ...(parent !== undefined ? { parent } : {}),
      },
      {
        modelGateway: this.modelGateway,
        toolHost: this.toolHost,
        registry: this.registry,
        tracer: this.tracer,
        checkpointer: this.checkpointer,
        track: (r) => this.runs.set(r.id, r),
        ...(this.breakpoints !== undefined ? { breakpoints: this.breakpoints } : {}),
        ...(this.pauseController !== undefined ? { pauseController: this.pauseController } : {}),
        ...(this.runStore !== undefined ? { runStore: this.runStore } : {}),
        ...(this.secretResolver !== undefined ? { secretResolver: this.secretResolver } : {}),
        ...(this.sandbox !== undefined ? { sandbox: this.sandbox } : {}),
      },
    );
    this.runs.set(id, run);
    return run;
  }

  /**
   * @internal — used by the supervisor adapter to roll up a child's
   * usage. Reads the LeafAgentRun's usageRecords side-channel (wave-9);
   * this does NOT consume the `events()` async iterable so other
   * consumers (CLI streamers, the API layer) can still observe events.
   */
  collectUsageFor(runId: RunId): UsageRecord[] {
    const r = this.runs.get(runId);
    if (!r) return [];
    return [...(r as InternalAgentRun).collectUsage()];
  }

  /**
   * Wave-9 entry point. Resolves the spec and either:
   *   - delegates to the composite orchestrator (when spec.composite),
   *   - or spawns a single LeafAgentRun (the existing path).
   *
   * When called with no `parent`/`root`, this run is the root of its
   * own tree.
   */
  async runAgent(
    ref: AgentRef,
    inputs: unknown,
    opts?: { readonly parent?: RunId; readonly root?: RunId },
  ): Promise<AgentRun> {
    const spec = await this.registry.load(ref);
    if (spec.composite !== undefined) {
      if (this.orchestrator === undefined) {
        throw new CompositeRuntimeMissingError(spec.identity.name);
      }
      // Build a synthetic supervisor run-id so the orchestrator's
      // events land on a real Run row (and so children can link via
      // parent_run_id).
      const supervisorId = randomUUID() as RunId;
      const rootRunId: RunId = opts?.root ?? opts?.parent ?? supervisorId;
      this.runMeta.set(supervisorId, { rootRunId, compositeStrategy: spec.composite.strategy });
      if (this.runStore) {
        await this.runStore.recordRunStart({
          runId: supervisorId,
          tenant: this.tenant,
          ref,
          ...(opts?.parent !== undefined ? { parent: opts.parent } : {}),
          root: rootRunId,
          compositeStrategy: spec.composite.strategy,
        });
      }
      // Construct and dispatch — runComposite resolves with the
      // strategy's terminal output. We wrap the result in a tiny
      // CompositeAgentRun so callers can `await run.wait()` and
      // `run.id` exactly as they do for leaf runs.
      const result = this.orchestrator.runComposite(spec, inputs, {
        tenant: this.tenant,
        parentRunId: supervisorId,
        rootRunId,
        depth: 0,
        privacy: spec.modelPolicy.privacyTier,
      });
      const wrapped = new CompositeAgentRun(supervisorId, result, this.runStore);
      this.composites.set(supervisorId, wrapped);
      return wrapped;
    }
    return this.spawn(
      ref,
      inputs,
      opts?.parent,
      opts?.root !== undefined ? { rootRunId: opts.root } : undefined,
    );
  }

  /**
   * Wave-9: structural adapter handed to `@aldo-ai/orchestrator`'s
   * Supervisor so it can spawn children through the existing engine
   * code path. Exposed publicly so a caller can construct a Supervisor
   * with `runtime.asSupervisorAdapter()` and then thread it back via
   * `RuntimeDeps.orchestrator`.
   */
  asSupervisorAdapter(): SupervisorRuntimeAdapter {
    return {
      spawnChild: async (args) => {
        const opts: SpawnOpts = {
          fromComposite: true,
          rootRunId: args.rootRunId,
          ...(args.compositeStrategy !== undefined
            ? { compositeStrategy: args.compositeStrategy }
            : {}),
        };
        const run = (await this.spawn(
          args.agent,
          args.inputs,
          args.parentRunId,
          opts,
        )) as InternalAgentRun;
        return {
          runId: run.id,
          wait: () => run.wait(),
          collectUsage: () => {
            // Roll up the child's own usage + every descendant in
            // the run tree. Walk the parent chain by inspecting each
            // tracked run; cheap because each child has a small graph
            // of children it spawned in turn.
            const records: UsageRecord[] = [...run.collectUsage()];
            for (const other of this.runs.values()) {
              if (other.id === run.id) continue;
              if (this.isDescendant(other.id, run.id)) {
                records.push(...other.collectUsage());
              }
            }
            return sumUsageRecords(records);
          },
        };
      },
      loadSpec: (ref) => this.registry.load(ref),
    };
  }

  /** Walks the parent chain to test descendant-ness. */
  private isDescendant(candidate: RunId, ancestor: RunId): boolean {
    let cur: RunId | undefined = candidate;
    const seen = new Set<RunId>();
    while (cur !== undefined && !seen.has(cur)) {
      seen.add(cur);
      const r = this.runs.get(cur);
      if (r === undefined) return false;
      if (r.parent === ancestor) return true;
      cur = r.parent;
    }
    return false;
  }

  async get(id: RunId): Promise<AgentRun | null> {
    return this.runs.get(id) ?? this.composites.get(id) ?? null;
  }

  /** Synchronous access to internal runs (engine-private, used by the orchestrator). */
  getInternal(id: RunId): InternalAgentRun | undefined {
    return this.runs.get(id);
  }

  /** Walk the parent chain for a given run. */
  parentsOf(id: RunId): RunId[] {
    const path: RunId[] = [];
    let cur = this.runs.get(id);
    while (cur?.parent !== undefined) {
      path.push(cur.parent);
      cur = this.runs.get(cur.parent);
    }
    return path;
  }

  /** Direct children of a given run. */
  childrenOf(id: RunId): RunId[] {
    const out: RunId[] = [];
    for (const r of this.runs.values()) {
      if (r.parent === id) out.push(r.id);
    }
    return out;
  }

  getCheckpointer(): Checkpointer {
    return this.checkpointer;
  }
}

export class SpawnNotAllowedError extends Error {
  constructor(parent: string, child: string) {
    super(`agent '${parent}' is not allowed to spawn '${child}'`);
    this.name = 'SpawnNotAllowedError';
  }
}
