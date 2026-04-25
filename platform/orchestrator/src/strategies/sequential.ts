import { sumUsage } from '../cost-rollup.js';
import type {
  ChildRunSummary,
  OrchestrationResult,
  SubagentInvocation,
  SupervisorDeps,
} from '../types.js';
import { awaitChild, spawnChild, toCompositeError } from './common.js';

/**
 * Sequential pipeline: a → b → c.
 *
 *   - First subagent receives the supervisor's input as-is.
 *   - Each subsequent subagent receives the previous subagent's
 *     output as `previous` alongside its declared inputs (or as the
 *     raw cursor when no per-subagent input is declared).
 *   - Fail-fast: any non-ok child throws CompositeChildFailedError on
 *     the parent run. Subsequent subagents are NOT spawned.
 */
export async function runSequential(
  subagents: readonly SubagentInvocation[],
  initialInput: unknown,
  deps: SupervisorDeps,
): Promise<OrchestrationResult> {
  const summaries: ChildRunSummary[] = [];
  let cursor: unknown = initialInput;

  for (const sub of subagents) {
    if (deps.ctx.signal?.aborted) {
      const reason = (deps.ctx.signal.reason as Error | undefined)?.message ?? 'cancelled';
      return {
        ok: false,
        output: { cancelled: true, reason },
        children: summaries,
        strategy: 'sequential',
        totalUsage: sumUsage(summaries.map((c) => c.usage)),
      };
    }

    const invocation: SubagentInvocation = { ...sub, inputs: composeInput(sub.inputs, cursor) };
    const handle = await spawnChild(invocation, 'sequential', deps);
    const summary = await awaitChild(handle, invocation, deps);
    summaries.push(summary);
    if (!summary.ok) {
      throw toCompositeError(summary);
    }
    cursor = summary.output;
  }

  return {
    ok: true,
    output: cursor,
    children: summaries,
    strategy: 'sequential',
    totalUsage: sumUsage(summaries.map((c) => c.usage)),
  };
}

/**
 * Input-composition: if the subagent's spec carries its own inputs,
 * we wrap as `{ input, previous }` so a subagent can wire `inputMap`
 * at the YAML layer; otherwise we feed the previous output as-is.
 */
function composeInput(specifiedInputs: unknown, previous: unknown): unknown {
  if (specifiedInputs !== undefined) return { input: specifiedInputs, previous };
  return previous;
}
