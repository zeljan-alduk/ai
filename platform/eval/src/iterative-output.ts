/**
 * MISSING_PIECES §9 / Phase F — eval-side adapter for iterative runs.
 *
 * The existing `sweep-runner.ts` extractor accumulates every assistant
 * `message` event into a single output string and overrides it with
 * `run.completed.payload.output` when that fires. That works for leaf
 * runs but is lossy for iterative runs:
 *
 *   1. Every cycle emits an assistant `message`, so the accumulator
 *      cross-pollutes intermediate cycles into the final output.
 *   2. The §9 plan calls for the rubric to score "the final assistant
 *      text + the final tool result"; only the text is currently
 *      surfaced.
 *
 * This module provides a small pure helper, `iterativeRunOutput`, that
 * walks the event stream and returns:
 *
 *   - the FINAL assistant message's text (last `message` event with
 *     `role: 'assistant'`), OR `run.completed.payload.output` when
 *     that's set (canonical),
 *   - PLUS the last `tool_result` event's stringified result, joined
 *     by a `\n\n[final tool result]\n` delimiter the rubric prompt
 *     can key on.
 *
 * Per-cycle scoring is deferred per §9 plan; this is the v0
 * "score on the final output" path.
 */

import type { RunEvent } from '@aldo-ai/types';

export interface IterativeOutputBundle {
  /** Final assistant text — empty string when none. */
  readonly text: string;
  /** Last tool result payload, stringified. `null` when none. */
  readonly finalToolResult: string | null;
  /** Number of cycles observed (cycle.start events). */
  readonly cycles: number;
  /** Termination reason from `run.terminated_by` if present. */
  readonly terminatedBy: string | null;
  /**
   * Convenience: text + delimiter + tool result (when both exist).
   * This is the string the existing string-based evaluators
   * (contains, regex, rubric, llm_judge) consume.
   */
  readonly composedForEval: string;
}

export function iterativeRunOutput(events: readonly RunEvent[]): IterativeOutputBundle {
  let finalText = '';
  let runCompletedOutput: string | null = null;
  let lastToolResult: unknown | null = null;
  let cycles = 0;
  let terminatedBy: string | null = null;

  for (const e of events) {
    if (e.type === 'cycle.start') {
      cycles += 1;
      continue;
    }
    if (e.type === 'message') {
      const m = e.payload as {
        role?: string;
        content?: ReadonlyArray<{ type?: string; text?: string }>;
      };
      if (m.role !== 'assistant' || !Array.isArray(m.content)) continue;
      const text = m.content
        .filter((p) => p?.type === 'text' && typeof p.text === 'string')
        .map((p) => p.text as string)
        .join('');
      if (text.length > 0) finalText = text;
      continue;
    }
    if (e.type === 'tool_result') {
      const p = e.payload as { result?: unknown; isError?: boolean } | null;
      if (p && p.result !== undefined) lastToolResult = p.result;
      continue;
    }
    if (e.type === 'run.completed') {
      const p = e.payload as { output?: unknown };
      if (typeof p.output === 'string' && p.output.length > 0) {
        runCompletedOutput = p.output;
      }
      continue;
    }
    if (e.type === 'run.terminated_by') {
      const p = e.payload as { reason?: string };
      if (typeof p.reason === 'string') terminatedBy = p.reason;
      continue;
    }
  }

  // Prefer run.completed.payload.output when set — that's the loop's
  // canonical answer. Fall back to the last assistant `message` text.
  const text = runCompletedOutput ?? finalText;

  const finalToolResult =
    lastToolResult === null || lastToolResult === undefined
      ? null
      : stringifyResult(lastToolResult);

  const composedForEval =
    finalToolResult !== null && finalToolResult.length > 0
      ? `${text}\n\n[final tool result]\n${finalToolResult}`
      : text;

  return {
    text,
    finalToolResult,
    cycles,
    terminatedBy,
    composedForEval,
  };
}

function stringifyResult(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
