import type { Node, RunId } from '@meridian/types';
import type { NodeExecContext, NodeResult } from './types.js';

/**
 * Sequential pipeline: each step receives the previous step's output.
 * Short-circuits on first failure.
 */
export async function runPipelineNode(
  steps: readonly Node[],
  inputs: unknown,
  parent: RunId | undefined,
  ctx: NodeExecContext,
): Promise<NodeResult> {
  let cursor: unknown = inputs;
  const children: RunId[] = [];
  for (const step of steps) {
    if (ctx.signal.aborted)
      return { ok: false, output: { cancelled: true }, childRunIds: children };
    const r = await ctx.execute(step, cursor, parent);
    children.push(...r.childRunIds);
    if (!r.ok) return { ok: false, output: r.output, childRunIds: children };
    cursor = r.output;
  }
  return { ok: true, output: cursor, childRunIds: children };
}
