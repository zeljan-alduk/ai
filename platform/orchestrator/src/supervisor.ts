import type { AgentRef, AgentSpec, RunEvent, RunId, TenantId } from '@aldo-ai/types';
import { rollup, sumUsage, zeroUsage } from './cost-rollup.js';
import { maxAgentDepth, maxParallelChildren } from './limits.js';
import { resolveChildPrivacy } from './privacy.js';
import { runDebate } from './strategies/debate.js';
import { runIterative } from './strategies/iterative.js';
import { runParallel } from './strategies/parallel.js';
import { runSequential } from './strategies/sequential.js';
import {
  CompositeDepthExceededError,
  CompositeSpecError,
  type OrchestrationResult,
  type RunContext,
  type SubagentInvocation,
  type SupervisorDeps,
  type SupervisorRuntimeAdapter,
} from './types.js';

export interface SupervisorOpts {
  readonly runtime: SupervisorRuntimeAdapter;
  /**
   * Sink for parent-side composite events. Wired by the engine adapter
   * to the supervisor LeafAgentRun's emit() so events land in the same
   * RunStore + event stream consumers already use.
   */
  readonly emit: (event: RunEvent) => void;
}

/**
 * Composite-run runtime. The engine delegates here when an AgentSpec
 * carries a `composite` block.
 *
 * Public API:
 *
 *   const sup = new Supervisor({ runtime, emit });
 *   const result = await sup.runComposite(spec, input, ctx);
 *
 * Where `ctx` is the parent run's context (tenant, parentRunId,
 * rootRunId, depth, privacy). The Supervisor never names a model or
 * provider — strategies operate on AgentSpec + AgentInput, and the
 * gateway picks the model per child run as it does today.
 */
export class Supervisor {
  private readonly runtime: SupervisorRuntimeAdapter;
  private readonly emit: (event: RunEvent) => void;

  constructor(opts: SupervisorOpts) {
    this.runtime = opts.runtime;
    this.emit = opts.emit;
  }

  /**
   * Run the composite block on `spec` with `input` as the supervisor's
   * top-level input. Returns the strategy's OrchestrationResult.
   *
   * Fail-closed checks performed BEFORE any child is spawned:
   *  - depth limit (ALDO_MAX_AGENT_DEPTH, default 5)
   *  - composite spec well-formedness
   *  - subagent registry resolution
   *  - privacy cascade (child privacy may not relax the parent)
   */
  async runComposite(
    spec: AgentSpec,
    input: unknown,
    ctx: RunContext,
  ): Promise<OrchestrationResult> {
    if (spec.composite === undefined) {
      throw new CompositeSpecError(
        `agent '${spec.identity.name}' has no composite block; runComposite is only for composite agents`,
      );
    }
    const composite = spec.composite;

    // Depth limit BEFORE any spawn — fail-closed.
    const limit = maxAgentDepth();
    if (ctx.depth > limit) {
      throw new CompositeDepthExceededError(ctx.depth, limit, {
        name: spec.identity.name,
        version: spec.identity.version,
      });
    }

    // Resolve the cap once: spec override > env > default.
    const concurrencyOverride =
      (composite as { readonly concurrency?: number }).concurrency ?? undefined;
    const cap = maxParallelChildren(concurrencyOverride);

    // Resolve subagent specs + privacy cascade once, up-front.
    const invocations: SubagentInvocation[] = [];
    for (const sub of composite.subagents) {
      const ref: AgentRef = { name: sub.agent };
      // Resolve the spec so we can apply privacy cascade. We do NOT
      // pass the spec downstream — the engine's runtime will load it
      // again when the child run starts. That keeps the orchestrator
      // free of any "use this exact resolved spec" coupling.
      const childSpec = await this.runtime.loadSpec(ref);
      const childPrivacy = resolveChildPrivacy(ctx.privacy, childSpec);
      const inv: SubagentInvocation = {
        agent: ref,
        ...(sub.as !== undefined ? { alias: sub.as } : {}),
        inputs: undefined,
        privacy: childPrivacy,
      };
      invocations.push(inv);
    }

    const deps: SupervisorDeps = {
      runtime: this.runtime,
      emit: (type, payload) => {
        this.emit({ type, at: new Date().toISOString(), payload } as RunEvent);
      },
      ctx,
      maxParallelChildren: cap,
    };

    let result: OrchestrationResult;
    switch (composite.strategy) {
      case 'sequential':
        result = await runSequential(invocations, input, deps);
        break;
      case 'parallel':
        result = await runParallel(invocations, input, deps);
        break;
      case 'debate': {
        if (composite.aggregator === undefined) {
          throw new CompositeSpecError(
            `composite strategy 'debate' requires aggregator (agent '${spec.identity.name}')`,
          );
        }
        const aggregator: AgentRef = { name: composite.aggregator };
        // Cascade privacy onto the aggregator too.
        const aggSpec = await this.runtime.loadSpec(aggregator);
        const aggPrivacy = resolveChildPrivacy(ctx.privacy, aggSpec);
        result = await runDebate(invocations, aggregator, input, {
          ...deps,
          ctx: { ...ctx, privacy: aggPrivacy },
        });
        break;
      }
      case 'iterative': {
        if (composite.iteration === undefined) {
          throw new CompositeSpecError(
            `composite strategy 'iterative' requires iteration (agent '${spec.identity.name}')`,
          );
        }
        if (invocations.length !== 1) {
          throw new CompositeSpecError(
            `composite strategy 'iterative' requires exactly one subagent (got ${invocations.length})`,
          );
        }
        result = await runIterative(
          {
            subagent: invocations[0] as SubagentInvocation,
            maxRounds: composite.iteration.maxRounds,
            terminate: composite.iteration.terminate,
            initialInput: input,
          },
          deps,
        );
        break;
      }
    }

    // Roll up cost. The supervisor's own self-usage is the canonical
    // zero record (a coordinator never calls a model directly — the
    // LeafAgentRun for the supervisor's prompt, if any, emits its own
    // usage event independently). Pinned to the epoch so two
    // identical composite runs produce byte-equal totalUsage.at; the
    // resulting `at` value is the latest CHILD timestamp because the
    // sumUsage() implementation takes the max across inputs.
    const rolled = rollup({
      self: zeroUsage(),
      children: result.children.map((c) => c.usage),
    });
    this.emit({
      type: 'composite.usage_rollup',
      at: new Date().toISOString(),
      payload: rolled,
    } as RunEvent);

    return { ...result, totalUsage: rolled.total };
  }
}

// Re-export so the engine's RuntimeDeps can name the type without
// reaching into the strategies subdir.
export type { SupervisorRuntimeAdapter } from './types.js';
export { sumUsage } from './cost-rollup.js';

// Helper used by tests: build a minimal RunContext for a fresh root.
export function newRootContext(args: {
  readonly tenant: TenantId;
  readonly rootRunId: RunId;
  readonly privacy: import('@aldo-ai/types').PrivacyTier;
  readonly signal?: AbortSignal;
}): RunContext {
  return {
    tenant: args.tenant,
    parentRunId: args.rootRunId,
    rootRunId: args.rootRunId,
    depth: 0,
    privacy: args.privacy,
    ...(args.signal !== undefined ? { signal: args.signal } : {}),
  };
}
