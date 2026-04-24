import type { AgentRef, RunId } from '@meridian/types';
import type { InternalAgentRun } from '../agent-run.js';
import type { NodeExecContext, NodeResult } from './types.js';

/**
 * Supervisor node: the lead agent splits the input and spawns one child
 * per worker in parallel, collecting results.
 *
 * v0 split: if inputs is an array, round-robin slice it across workers;
 * otherwise every worker gets the same inputs. The lead agent is still
 * spawned as a kick-off but its output is discarded in favor of the
 * collected worker results. A v1 release will let the lead emit a
 * structured split plan.
 *
 * TODO(v1): parse lead's structured output as an assignment plan.
 */
export async function runSupervisorNode(
  lead: AgentRef,
  workers: readonly AgentRef[],
  inputs: unknown,
  parent: RunId | undefined,
  ctx: NodeExecContext,
): Promise<NodeResult> {
  const children: RunId[] = [];

  const leadRun = (await ctx.runtime.spawn(lead, inputs, parent)) as InternalAgentRun;
  ctx.registerChild(leadRun);
  children.push(leadRun.id);
  await leadRun.wait();

  const slices = splitInputs(inputs, workers.length);

  const workerRuns = await Promise.all(
    workers.map(async (w, i) => {
      const input = slices[i] ?? inputs;
      const run = (await ctx.runtime.spawn(w, input, leadRun.id)) as InternalAgentRun;
      ctx.registerChild(run);
      children.push(run.id);
      return run;
    }),
  );

  const results = await Promise.all(workerRuns.map((r) => r.wait()));
  const ok = results.every((r) => r.ok);
  return {
    ok,
    output: results.map((r) => r.output),
    childRunIds: children,
  };
}

function splitInputs(inputs: unknown, n: number): unknown[] {
  if (!Array.isArray(inputs) || n === 0) {
    return Array.from({ length: n }, () => inputs);
  }
  const buckets: unknown[][] = Array.from({ length: n }, () => []);
  for (let i = 0; i < inputs.length; i++) {
    const bucket = buckets[i % n];
    if (bucket) bucket.push(inputs[i]);
  }
  return buckets;
}
