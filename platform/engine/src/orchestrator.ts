import { randomUUID } from 'node:crypto';
import type { EventBus, Graph, GraphRun, Node, Orchestrator, RunId } from '@meridian/types';
import type { InternalAgentRun } from './agent-run.js';
import { runAgentNode } from './nodes/agent.js';
import { runDebateNode } from './nodes/debate.js';
import { runParallelNode } from './nodes/parallel.js';
import { runPipelineNode } from './nodes/pipeline.js';
import { runRouterNode } from './nodes/router.js';
import { runSubscriptionNode } from './nodes/subscription.js';
import { runSupervisorNode } from './nodes/supervisor.js';
import type { NodeExecContext, NodeResult } from './nodes/types.js';
import type { PlatformRuntime } from './runtime.js';

export interface OrchestratorDeps {
  readonly runtime: PlatformRuntime;
  readonly eventBus: EventBus;
}

/**
 * Platform orchestrator: walks a Graph tree, dispatching each node
 * kind to the appropriate runner. Returns a GraphRun that resolves
 * when the root node settles (or when cancel() is called).
 */
export class PlatformOrchestrator implements Orchestrator {
  private readonly runtime: PlatformRuntime;
  private readonly eventBus: EventBus;
  private readonly activeRuns = new Map<RunId, Set<InternalAgentRun>>();
  private readonly controllers = new Map<RunId, AbortController>();

  constructor(deps: OrchestratorDeps) {
    this.runtime = deps.runtime;
    this.eventBus = deps.eventBus;
  }

  async run(graph: Graph, inputs: unknown): Promise<GraphRun> {
    const id = randomUUID() as RunId;
    const ac = new AbortController();
    this.controllers.set(id, ac);
    const children = new Set<InternalAgentRun>();
    this.activeRuns.set(id, children);

    const ctx: NodeExecContext = {
      runtime: this.runtime,
      signal: ac.signal,
      registerChild: (r) => children.add(r),
      execute: (node, nodeInputs, parent) => this.executeNode(ctx, node, nodeInputs, parent),
    };

    const done = ctx.execute(graph.root, inputs, undefined).then((r) => ({
      ok: r.ok,
      output: r.output,
    }));

    // Cleanup on completion.
    void done.finally(() => {
      this.activeRuns.delete(id);
      this.controllers.delete(id);
    });

    const run: GraphRun & { cancel: (reason: string) => Promise<void> } = {
      id,
      wait: async () => done,
      cancel: async (reason: string) => {
        ac.abort(new Error(reason));
        await Promise.all(Array.from(children).map((c) => c.cancel(reason).catch(() => undefined)));
      },
    };
    return run;
  }

  /** Cancel any in-flight graph run. */
  async cancel(id: RunId, reason: string): Promise<void> {
    const ac = this.controllers.get(id);
    if (ac) ac.abort(new Error(reason));
    const set = this.activeRuns.get(id);
    if (set) {
      await Promise.all(Array.from(set).map((r) => r.cancel(reason).catch(() => undefined)));
    }
  }

  private async executeNode(
    ctx: NodeExecContext,
    node: Node,
    inputs: unknown,
    parent: RunId | undefined,
  ): Promise<NodeResult> {
    switch (node.kind) {
      case 'agent':
        return runAgentNode(node.agent, inputs, parent, ctx);
      case 'pipeline':
        return runPipelineNode(node.steps, inputs, parent, ctx);
      case 'supervisor':
        return runSupervisorNode(node.lead, node.workers, inputs, parent, ctx);
      case 'parallel':
        return runParallelNode(node.branches, node.join, node.quorum, inputs, parent, ctx);
      case 'router':
        return runRouterNode(node.classifier, node.branches, inputs, parent, ctx);
      case 'debate':
        return runDebateNode(node.parties, node.judge, node.rounds, inputs, parent, ctx);
      case 'subscription':
        return runSubscriptionNode(node.event, node.handler, this.eventBus, inputs, parent, ctx);
    }
  }
}
