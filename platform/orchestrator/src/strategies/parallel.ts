import { sumUsage } from '../cost-rollup.js';
import type {
  ChildRunSummary,
  OrchestrationResult,
  SpawnedChildHandle,
  SubagentInvocation,
  SupervisorDeps,
} from '../types.js';
import { awaitChild, spawnChild, toCompositeError } from './common.js';

/**
 * Parallel fan-out: a + b + c.
 *
 *   - Spawn every subagent up to `deps.maxParallelChildren` at a time.
 *   - Wait for ALL of them — no early-exit on first failure (the brief
 *     calls this "awaits all + collects").
 *   - If at least one child failed, the supervisor surfaces the FIRST
 *     failure (in declaration order) as a typed CompositeChildFailedError
 *     so the parent run logs it. The full list of summaries is still
 *     returned via the thrown error's caller for inspection — and via
 *     the parent run's `composite.child_failed` events.
 *
 * Output (on success): array of child outputs in DECLARATION order.
 */
export async function runParallel(
  subagents: readonly SubagentInvocation[],
  initialInput: unknown,
  deps: SupervisorDeps,
): Promise<OrchestrationResult> {
  const limit = Math.max(1, deps.maxParallelChildren);
  const summaries: ChildRunSummary[] = new Array(subagents.length);

  // Bind input on every invocation (parallel = same input fan-out).
  const invocations: SubagentInvocation[] = subagents.map((s) => ({
    ...s,
    inputs: s.inputs !== undefined ? s.inputs : initialInput,
  }));

  let cursor = 0;
  let terminationFired = false;
  async function worker(): Promise<void> {
    while (true) {
      const idx = cursor++;
      if (idx >= invocations.length) return;
      if (deps.ctx.signal?.aborted) return;
      // Wave-17: stop pulling new work once a termination rule fires.
      // Inflight children continue to completion (they're already in
      // the runtime) so the cost roll-up + child event log stay
      // coherent — we just refuse to spawn any more.
      if (terminationFired) return;
      const inv = invocations[idx] as SubagentInvocation;
      const handle: SpawnedChildHandle = await spawnChild(inv, 'parallel', deps);
      const summary = await awaitChild(handle, inv, deps);
      summaries[idx] = summary;
      const decision = deps.termination.recordChild(summary);
      if (decision !== null) {
        terminationFired = true;
        deps.emit('run.terminated_by', decision);
      }
    }
  }

  const workerCount = Math.min(limit, invocations.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  if (deps.ctx.signal?.aborted) {
    const reason = (deps.ctx.signal.reason as Error | undefined)?.message ?? 'cancelled';
    return {
      ok: false,
      output: { cancelled: true, reason },
      children: summaries.filter(Boolean),
      strategy: 'parallel',
      totalUsage: sumUsage(summaries.filter(Boolean).map((c) => c.usage)),
    };
  }

  // Wave-17: when termination short-circuited the fan-out, return
  // the partial collection successfully (operator-set ceilings are
  // not failures) and skip the failure-surfacing step.
  if (terminationFired) {
    const partial = summaries.filter(Boolean);
    return {
      ok: true,
      output: partial.map((s) => s.output),
      children: partial,
      strategy: 'parallel',
      totalUsage: sumUsage(partial.map((c) => c.usage)),
    };
  }

  // Surface the first failure as a typed error on the parent run.
  const firstFailure = summaries.find((s) => s !== undefined && !s.ok);
  if (firstFailure !== undefined) {
    throw toCompositeError(firstFailure);
  }

  return {
    ok: true,
    output: summaries.map((s) => s.output),
    children: summaries,
    strategy: 'parallel',
    totalUsage: sumUsage(summaries.map((c) => c.usage)),
  };
}
