/**
 * MISSING_PIECES §9 / Phase B — declarative termination matchers for
 * `IterativeAgentRun`. Pure functions, exported for unit-testing
 * independent of the loop runtime.
 *
 * Order is operator-meaningful: the loop fires the FIRST matching
 * condition in `spec.iteration.terminationConditions`. The matchers
 * here only DECIDE; the caller emits the `run.terminated_by` event
 * and short-circuits the loop.
 *
 * The three kinds:
 *
 *   - `text-includes` — substring search on the assistant text from
 *     this cycle (case-sensitive — operators who want fuzzy matching
 *     can lower-case both sides via the engine's nudge-prompt rather
 *     than relax the contract here).
 *
 *   - `tool-result` — looks at every tool result from this cycle for
 *     the named tool. `match.exitCode` requires the result payload to
 *     carry that exit code (works on the aldo-shell `shell.exec`
 *     shape: `{ exitCode, stdout, stderr, ... }`). `match.contains`
 *     requires the stringified payload to contain the substring.
 *     When both are set, BOTH must match (AND, not OR).
 *
 *   - `budget-exhausted` — fires when the cumulative USD across the
 *     run's UsageRecords meets/exceeds `spec.modelPolicy.budget.usdMax`.
 *     This is checked by the loop, not the gateway, so an operator
 *     can opt INTO an early bail-out without tightening the budget.
 */

import type { IterationTerminationCondition, ToolResultPart, UsageRecord } from '@aldo-ai/types';

export interface CycleOutcome {
  /** Assistant text from THIS cycle (pre-tool-call). */
  readonly text: string;
  /** Tool results from this cycle, in dispatch order. */
  readonly toolResults: readonly ToolResultPart[];
  /**
   * Per-cycle UsageRecord (terminal end-delta). Optional because a
   * mocked gateway may omit it; matchers default cumulativeUsd to the
   * caller-supplied total when the cycle's record is missing.
   */
  readonly usage: UsageRecord | undefined;
}

export interface TerminationDecision {
  readonly reason:
    | 'text-includes'
    | 'tool-result'
    | 'budget-exhausted'
    | 'maxCycles';
  readonly detail: Readonly<Record<string, unknown>>;
}

/**
 * Walk the conditions in spec order; return the first match (or null).
 *
 * `cumulativeUsd` is the running total across every cycle so far
 * (NOT just this cycle). The caller maintains it; matchers stay pure.
 */
export function firstMatchingTermination(
  conditions: readonly IterationTerminationCondition[],
  cycle: CycleOutcome,
  ctx: { readonly cumulativeUsd: number; readonly budgetUsdMax: number },
): TerminationDecision | null {
  for (const c of conditions) {
    const decision = evaluate(c, cycle, ctx);
    if (decision !== null) return decision;
  }
  return null;
}

function evaluate(
  c: IterationTerminationCondition,
  cycle: CycleOutcome,
  ctx: { readonly cumulativeUsd: number; readonly budgetUsdMax: number },
): TerminationDecision | null {
  switch (c.kind) {
    case 'text-includes': {
      if (cycle.text.length === 0) return null;
      if (!cycle.text.includes(c.text)) return null;
      return { reason: 'text-includes', detail: { trigger: c.text } };
    }
    case 'tool-result': {
      for (const r of cycle.toolResults) {
        if (!matchesToolResult(c, r)) continue;
        return {
          reason: 'tool-result',
          detail: { tool: c.tool, callId: r.callId, match: c.match },
        };
      }
      return null;
    }
    case 'budget-exhausted': {
      if (ctx.budgetUsdMax <= 0) return null;
      if (ctx.cumulativeUsd < ctx.budgetUsdMax) return null;
      return {
        reason: 'budget-exhausted',
        detail: { usd: ctx.cumulativeUsd, cap: ctx.budgetUsdMax },
      };
    }
  }
}

function matchesToolResult(
  c: Extract<IterationTerminationCondition, { kind: 'tool-result' }>,
  r: ToolResultPart,
): boolean {
  // The caller (iterative-run.ts) tags each result with the tool name
  // the model actually used. That tool name may carry the MCP server
  // prefix (`aldo-shell.shell.exec`) while the operator's spec
  // typically writes the bare form (`shell.exec`). We accept either
  // direction — exact match OR `result.tool` ends with `.<c.tool>` —
  // so the spec author can use whichever form reads cleanest in YAML.
  const resultTool = (r as ToolResultPart & { tool?: string }).tool;
  if (resultTool !== undefined) {
    const exact = resultTool === c.tool;
    const suffix = resultTool.endsWith(`.${c.tool}`);
    if (!exact && !suffix) return false;
  }

  const payload = r.result;
  if (c.match.exitCode !== undefined) {
    const observed = readExitCode(payload);
    if (observed !== c.match.exitCode) return false;
  }
  if (c.match.contains !== undefined) {
    const haystack = stringifyForContains(payload);
    if (!haystack.includes(c.match.contains)) return false;
  }
  return true;
}

function readExitCode(payload: unknown): number | undefined {
  if (payload === null || typeof payload !== 'object') return undefined;
  const ec = (payload as { exitCode?: unknown }).exitCode;
  return typeof ec === 'number' ? ec : undefined;
}

function stringifyForContains(payload: unknown): string {
  if (payload === null || payload === undefined) return '';
  if (typeof payload === 'string') return payload;
  try {
    return JSON.stringify(payload);
  } catch {
    return String(payload);
  }
}
