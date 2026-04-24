import type { AgentRef, Node, RunId } from '@meridian/types';
import type { InternalAgentRun } from '../agent-run.js';
import type { NodeExecContext, NodeResult } from './types.js';

/**
 * Router: spawn classifier, read its textual output, pick the branch
 * whose key matches. Unknown labels fall through to a 'default' branch
 * if present; else fail.
 *
 * v0 contract: classifier's final output is a plain string that is
 * exactly one of the branch keys (or JSON with a `.branch` field).
 * TODO(v1): structured-output schema enforcement.
 */
export async function runRouterNode(
  classifier: AgentRef,
  branches: Readonly<Record<string, Node>>,
  inputs: unknown,
  parent: RunId | undefined,
  ctx: NodeExecContext,
): Promise<NodeResult> {
  const children: RunId[] = [];
  const clsRun = (await ctx.runtime.spawn(classifier, inputs, parent)) as InternalAgentRun;
  ctx.registerChild(clsRun);
  children.push(clsRun.id);
  const cls = await clsRun.wait();
  if (!cls.ok) {
    return {
      ok: false,
      output: { error: 'classifier failed', detail: cls.output },
      childRunIds: children,
    };
  }

  const label = extractLabel(cls.output, Object.keys(branches));
  const target = (label !== null ? branches[label] : undefined) ?? branches.default;
  if (!target) {
    return {
      ok: false,
      output: { error: `no matching branch for label ${JSON.stringify(label)}` },
      childRunIds: children,
    };
  }
  const r = await ctx.execute(target, inputs, parent);
  return { ok: r.ok, output: r.output, childRunIds: [...children, ...r.childRunIds] };
}

function extractLabel(output: unknown, candidates: readonly string[]): string | null {
  if (typeof output === 'string') {
    const trimmed = output.trim();
    if (candidates.includes(trimmed)) return trimmed;
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === 'object' && 'branch' in parsed) {
        const b = (parsed as { branch: unknown }).branch;
        if (typeof b === 'string') return b;
      }
    } catch {
      /* not JSON */
    }
    // Accept any token that matches a branch key substring.
    for (const c of candidates) {
      if (trimmed.includes(c)) return c;
    }
  }
  if (output && typeof output === 'object' && 'branch' in output) {
    const b = (output as { branch: unknown }).branch;
    if (typeof b === 'string') return b;
  }
  return null;
}
