import { randomUUID } from 'node:crypto';
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
} from '@meridian/types';
import { LeafAgentRun, type InternalAgentRun } from './agent-run.js';
import { InMemoryCheckpointer, type Checkpointer } from './checkpointer/index.js';

export interface RuntimeDeps {
  readonly modelGateway: ModelGateway;
  readonly toolHost: ToolHost;
  readonly registry: AgentRegistry;
  readonly tracer: Tracer;
  readonly tenant: TenantId;
  readonly checkpointer?: Checkpointer;
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

  constructor(deps: RuntimeDeps) {
    this.modelGateway = deps.modelGateway;
    this.toolHost = deps.toolHost;
    this.registry = deps.registry;
    this.tracer = deps.tracer;
    this.tenant = deps.tenant;
    this.checkpointer = deps.checkpointer ?? new InMemoryCheckpointer();
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
