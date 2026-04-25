import { sumUsage } from '../cost-rollup.js';
import { evalTerminate } from '../jsonpath.js';
import {
  type ChildRunSummary,
  CompositeSpecError,
  type OrchestrationResult,
  type SubagentInvocation,
  type SupervisorDeps,
} from '../types.js';
import { awaitChild, spawnChild, toCompositeError } from './common.js';

export interface IterativeArgs {
  readonly subagent: SubagentInvocation;
  readonly maxRounds: number;
  readonly terminate: string;
  readonly initialInput: unknown;
}

/**
 * Iterative strategy: loop a single subagent up to `maxRounds`,
 * terminating when `terminate` (a JSONPath-ish expression) evaluates
 * truthy on the round's output.
 *
 * Each round receives `{ input, round, previous }` so the subagent
 * can decide whether to take the original input or refine the
 * previous round's output. Fail-fast: any failed round throws.
 *
 * Output: { rounds, output, terminated, terminateReason }.
 */
export async function runIterative(
  args: IterativeArgs,
  deps: SupervisorDeps,
): Promise<OrchestrationResult> {
  if (args.maxRounds < 1) {
    throw new CompositeSpecError(`iterative.maxRounds must be >= 1, got ${args.maxRounds}`);
  }
  if (args.terminate.trim() === '') {
    throw new CompositeSpecError('iterative.terminate must be a non-empty expression');
  }

  const summaries: ChildRunSummary[] = [];
  let lastOutput: unknown = null;
  let terminated = false;
  let terminateReason = 'max_rounds_reached';
  let actualRounds = 0;

  for (let round = 1; round <= args.maxRounds; round++) {
    if (deps.ctx.signal?.aborted) {
      const reason = (deps.ctx.signal.reason as Error | undefined)?.message ?? 'cancelled';
      return {
        ok: false,
        output: { cancelled: true, reason },
        children: summaries,
        strategy: 'iterative',
        totalUsage: sumUsage(summaries.map((c) => c.usage)),
        rounds: actualRounds,
      };
    }

    const invocation: SubagentInvocation = {
      ...args.subagent,
      inputs: { input: args.initialInput, round, previous: lastOutput },
    };
    const handle = await spawnChild(invocation, 'iterative', deps);
    const summary = await awaitChild(handle, invocation, deps);
    summaries.push(summary);
    actualRounds = round;

    if (!summary.ok) {
      throw toCompositeError(summary);
    }
    lastOutput = summary.output;

    const evalRes = evalTerminate(args.terminate, summary.output);
    if (!evalRes.ok) {
      throw new CompositeSpecError(`iterative.terminate eval failed: ${evalRes.reason}`);
    }
    if (evalRes.truthy) {
      terminated = true;
      terminateReason = `terminate(${args.terminate})=true`;
      deps.emit('composite.iteration', {
        round,
        terminated: true,
        terminateReason,
      });
      break;
    }
    deps.emit('composite.iteration', {
      round,
      terminated: false,
      terminateReason: '',
    });
  }

  if (!terminated) {
    deps.emit('composite.iteration', {
      round: actualRounds,
      terminated: false,
      terminateReason,
    });
  }

  return {
    ok: true,
    output: { rounds: actualRounds, output: lastOutput, terminated, terminateReason },
    children: summaries,
    strategy: 'iterative',
    totalUsage: sumUsage(summaries.map((c) => c.usage)),
    rounds: actualRounds,
  };
}
