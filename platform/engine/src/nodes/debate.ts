import type { AgentRef, RunId } from '@meridian/types';
import type { InternalAgentRun } from '../agent-run.js';
import type { NodeExecContext, NodeResult } from './types.js';

/**
 * Debate: each party takes turns over N rounds, each seeing the prior
 * transcript. A final judge spawn produces the verdict.
 *
 * v0 transcript shape is a plain array of { party, round, output }
 * objects serialized into each subsequent spawn's input.
 */
export async function runDebateNode(
  parties: readonly AgentRef[],
  judge: AgentRef,
  rounds: number,
  inputs: unknown,
  parent: RunId | undefined,
  ctx: NodeExecContext,
): Promise<NodeResult> {
  const children: RunId[] = [];
  const transcript: Array<{
    party: string;
    round: number;
    output: unknown;
  }> = [];

  for (let round = 0; round < rounds; round++) {
    for (const party of parties) {
      if (ctx.signal.aborted) {
        return { ok: false, output: { cancelled: true, transcript }, childRunIds: children };
      }
      const turnInput = {
        topic: inputs,
        round,
        transcript,
        you: party.name,
      };
      const run = (await ctx.runtime.spawn(party, turnInput, parent)) as InternalAgentRun;
      ctx.registerChild(run);
      children.push(run.id);
      const r = await run.wait();
      if (!r.ok) {
        return {
          ok: false,
          output: { error: `party ${party.name} failed`, transcript },
          childRunIds: children,
        };
      }
      transcript.push({ party: party.name, round, output: r.output });
    }
  }

  const judgeRun = (await ctx.runtime.spawn(
    judge,
    { topic: inputs, transcript },
    parent,
  )) as InternalAgentRun;
  ctx.registerChild(judgeRun);
  children.push(judgeRun.id);
  const verdict = await judgeRun.wait();
  return {
    ok: verdict.ok,
    output: { verdict: verdict.output, transcript },
    childRunIds: children,
  };
}

