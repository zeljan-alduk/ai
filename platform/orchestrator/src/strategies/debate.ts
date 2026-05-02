import type { AgentRef } from '@aldo-ai/types';
import { sumUsage } from '../cost-rollup.js';
import {
  type ChildRunSummary,
  CompositeSpecError,
  type OrchestrationResult,
  type SubagentInvocation,
  type SupervisorDeps,
} from '../types.js';
import { awaitChild, spawnChild, toCompositeError } from './common.js';

/**
 * Debate strategy:
 *
 *   1. fan a + b + c concurrently with the supervisor's input
 *   2. concatenate every party's output into a structured envelope
 *   3. spawn the `aggregator` agent with that envelope as its input
 *   4. return the aggregator's output as the composite output
 *
 * The aggregator is itself a child run (so it shows up in the
 * children list and rolls up into the parent's usage). Failure in
 * any party causes the aggregator to NOT spawn — fail-closed: a
 * debate without all parties is a different decision than a debate
 * with all of them.
 */
export async function runDebate(
  parties: readonly SubagentInvocation[],
  aggregator: AgentRef,
  initialInput: unknown,
  deps: SupervisorDeps,
): Promise<OrchestrationResult> {
  if (parties.length === 0) {
    throw new CompositeSpecError('debate strategy requires at least one party');
  }

  const summaries: ChildRunSummary[] = new Array(parties.length);
  const invocations: SubagentInvocation[] = parties.map((s) => ({
    ...s,
    inputs: s.inputs !== undefined ? s.inputs : initialInput,
  }));

  // Fan-out parties (no concurrency cap on debate parties — these
  // are typically a small fixed set; the parallel cap still applies
  // if K wires it through CompositeSpec.concurrency in a follow-up).
  await Promise.all(
    invocations.map(async (inv, i) => {
      const handle = await spawnChild(inv, 'debate', deps);
      summaries[i] = await awaitChild(handle, inv, deps);
    }),
  );

  if (deps.ctx.signal?.aborted) {
    const reason = (deps.ctx.signal.reason as Error | undefined)?.message ?? 'cancelled';
    return {
      ok: false,
      output: { cancelled: true, reason },
      children: summaries,
      strategy: 'debate',
      totalUsage: sumUsage(summaries.map((c) => c.usage)),
    };
  }

  // Wave-17: feed every party summary through the termination
  // controller in declaration order. If any rule fires, skip the
  // aggregator phase and return the parties' outputs as a partial
  // success — debate's contract (collect + judge) is broken when an
  // operator-set ceiling kicks in, so we surface what we have.
  for (const s of summaries) {
    if (s === undefined) continue;
    const decision = deps.termination.recordChild(s);
    if (decision !== null) {
      deps.emit('run.terminated_by', decision);
      return {
        ok: true,
        output: summaries.filter(Boolean).map((c) => c.output),
        children: summaries.filter(Boolean),
        strategy: 'debate',
        totalUsage: sumUsage(summaries.filter(Boolean).map((c) => c.usage)),
      };
    }
  }

  const firstFailure = summaries.find((s) => !s.ok);
  if (firstFailure !== undefined) {
    throw toCompositeError(firstFailure);
  }

  // Build the aggregator input: ordered list of party results,
  // labelled by alias when present (otherwise by agent name).
  const aggregatorInput = {
    parties: summaries.map((s) => ({
      alias: s.alias ?? s.agent.name,
      agent: s.agent.name,
      output: s.output,
    })),
  };

  const aggregatorInvocation: SubagentInvocation = {
    agent: aggregator,
    alias: 'aggregator',
    inputs: aggregatorInput,
    privacy: deps.ctx.privacy,
  };
  const handle = await spawnChild(aggregatorInvocation, 'debate', deps);
  const aggSummary = await awaitChild(handle, aggregatorInvocation, deps);
  summaries.push(aggSummary);
  if (!aggSummary.ok) {
    throw toCompositeError(aggSummary);
  }

  // Wave-17: the aggregator is itself a child run — feed it through
  // the controller so successRoles=['aggregator'] (or a textMention
  // sentinel emitted by the judge) closes the run with an explicit
  // termination event.
  const aggDecision = deps.termination.recordChild(aggSummary);
  if (aggDecision !== null) {
    deps.emit('run.terminated_by', aggDecision);
  }

  return {
    ok: true,
    output: aggSummary.output,
    children: summaries,
    strategy: 'debate',
    totalUsage: sumUsage(summaries.map((c) => c.usage)),
  };
}
