import { randomUUID } from 'node:crypto';
import type { SandboxRunner } from '@aldo-ai/sandbox';
import type {
  AgentRef,
  AgentRegistry,
  AgentRun,
  ModelGateway,
  RunId,
  Runtime,
  TenantId,
  ToolHost,
  Tracer,
} from '@aldo-ai/types';
import { type InternalAgentRun, LeafAgentRun, type SecretArgResolver } from './agent-run.js';
import { type Checkpointer, InMemoryCheckpointer } from './checkpointer/index.js';
import type { BreakpointStore } from './debugger/breakpoint-store.js';
import type { PauseController } from './debugger/pause-controller.js';
import type { RunStore } from './stores/postgres-run-store.js';

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
}

/**
 * Permission for spawning children is enforced here: a parent agent
 * may only spawn children whose names appear in its spec.spawn.allowed.
 */
export class PlatformRuntime implements Runtime {
  private readonly runs = new Map<RunId, InternalAgentRun>();
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

  async spawn(ref: AgentRef, inputs: unknown, parent?: RunId): Promise<AgentRun> {
    if (parent !== undefined) {
      const parentRun = this.runs.get(parent);
      if (!parentRun) throw new Error(`unknown parent run: ${parent}`);
      const parentSpec = await this.registry.load(parentRun.ref);
      if (!parentSpec.spawn.allowed.includes(ref.name)) {
        throw new SpawnNotAllowedError(parentRun.ref.name, ref.name);
      }
    }

    const spec = await this.registry.load(ref);
    const id = randomUUID() as RunId;
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

  async get(id: RunId): Promise<AgentRun | null> {
    return this.runs.get(id) ?? null;
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
