import type { AgentRef, RunId } from '@aldo-ai/types';
import type { InternalAgentRun } from '../agent-run.js';
import type { NodeExecContext, NodeResult } from './types.js';

/**
 * Leaf agent node: spawn a single AgentRun and wait for it to finish.
 * Every spawn is a checkpoint boundary via LeafAgentRun's internal
 * pre/post checkpoints.
 */
export async function runAgentNode(
  agent: AgentRef,
  inputs: unknown,
  parent: RunId | undefined,
  ctx: NodeExecContext,
): Promise<NodeResult> {
  const run = (await ctx.runtime.spawn(agent, inputs, parent)) as InternalAgentRun;
  ctx.registerChild(run);
  const res = await run.wait();
  return { ok: res.ok, output: res.output, childRunIds: [run.id] };
}
