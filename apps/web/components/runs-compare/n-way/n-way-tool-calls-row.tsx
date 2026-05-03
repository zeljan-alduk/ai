/**
 * Per-column expandable list of tool calls for the N-way comparison
 * table. Renders as one final row at the bottom of the grid; each
 * cell is a collapsible <details> containing the column's tool-call
 * sequence (name + args).
 *
 * Visual diff signal: when the same tool appears at the same step in
 * multiple columns, identical arg-payloads get an emerald tag and
 * different arg-payloads get an amber tag.
 */

import type { RunDetail, RunEvent } from '@aldo-ai/api-contract';
import type { ComparisonColumn } from './n-way-rows';

interface ToolCall {
  readonly stepIndex: number;
  readonly name: string;
  readonly argsJson: string;
}

function extractToolCalls(run: RunDetail): readonly ToolCall[] {
  const out: ToolCall[] = [];
  let step = 0;
  for (const e of run.events) {
    if (e.type !== 'tool_call') continue;
    const name = pickToolName(e);
    const argsJson = pickToolArgs(e);
    out.push({ stepIndex: step, name, argsJson });
    step++;
  }
  return out;
}

function pickToolName(event: RunEvent): string {
  const p = event.payload as { name?: unknown; tool?: unknown } | null;
  if (p && typeof p === 'object') {
    if (typeof p.name === 'string') return p.name;
    if (typeof p.tool === 'string') return p.tool;
  }
  return '<tool>';
}

function pickToolArgs(event: RunEvent): string {
  const p = event.payload as { args?: unknown; arguments?: unknown } | null;
  if (p && typeof p === 'object') {
    const args = p.args ?? p.arguments;
    if (args !== undefined) {
      try {
        return JSON.stringify(args);
      } catch {
        return String(args);
      }
    }
  }
  return '';
}

export function NWayToolCallsRow({ columns }: { columns: readonly ComparisonColumn[] }) {
  const series = columns.map((c) =>
    c.kind === 'run' ? extractToolCalls(c.run) : ([] as readonly ToolCall[]),
  );
  // Pre-compute per-step diff tags by walking step indices across cols.
  const maxSteps = Math.max(0, ...series.map((s) => s.length));
  return (
    <>
      <div
        className="sticky left-0 z-10 border-b border-border bg-bg-subtle px-3 py-2 text-xs font-medium text-fg-muted"
        data-testid="nway-row-label-toolCalls"
      >
        Tool calls (expand)
      </div>
      {columns.map((col, i) => (
        <div
          key={`tools-${col.id}-${i}`}
          data-testid={`nway-cell-toolCalls-${col.id}`}
          className="border-b border-l border-transparent px-3 py-2 align-top text-xs"
        >
          {col.kind !== 'run' ? (
            <span className="text-fg-faint">—</span>
          ) : series[i] === undefined || series[i]?.length === 0 ? (
            <span className="text-fg-faint">no tool calls</span>
          ) : (
            <details>
              <summary className="cursor-pointer text-[11px] font-medium text-sky-700 hover:underline dark:text-sky-400">
                {series[i]?.length} call{(series[i]?.length ?? 0) === 1 ? '' : 's'}
              </summary>
              <ol className="mt-2 flex flex-col gap-1.5">
                {(series[i] ?? []).map((tc, idx) => {
                  const tag = computeStepTag(series, tc.stepIndex, tc.name, tc.argsJson);
                  return (
                    <li
                      key={`step-${idx}`}
                      className={
                        tag === 'differ'
                          ? 'rounded border border-amber-300 bg-amber-50 px-2 py-1 dark:border-amber-700 dark:bg-amber-950/30'
                          : tag === 'match'
                            ? 'rounded border border-emerald-300 bg-emerald-50/40 px-2 py-1 dark:border-emerald-800 dark:bg-emerald-950/20'
                            : 'rounded border border-border bg-bg-subtle px-2 py-1'
                      }
                    >
                      <div className="flex items-center justify-between text-[10px] text-fg-faint">
                        <span>step {tc.stepIndex + 1}</span>
                        {tag === 'differ' ? (
                          <span className="text-amber-800 dark:text-amber-200">args differ</span>
                        ) : tag === 'match' ? (
                          <span className="text-emerald-800 dark:text-emerald-200">match</span>
                        ) : null}
                      </div>
                      <div className="mt-0.5 font-mono text-[11px] text-fg">{tc.name}</div>
                      {tc.argsJson.length > 0 ? (
                        <pre className="mt-0.5 whitespace-pre-wrap break-words font-mono text-[10px] text-fg-muted">
                          {tc.argsJson}
                        </pre>
                      ) : null}
                    </li>
                  );
                })}
              </ol>
              {(series[i]?.length ?? 0) < maxSteps ? (
                <p className="mt-1 text-[10px] italic text-fg-faint">
                  ({maxSteps - (series[i]?.length ?? 0)} fewer step
                  {maxSteps - (series[i]?.length ?? 0) === 1 ? '' : 's'} than the longest run)
                </p>
              ) : null}
            </details>
          )}
        </div>
      ))}
    </>
  );
}

/**
 * Decide the per-step diff tag: `match` if every column at that step
 * called the same tool with the same args, `differ` if the same tool
 * was called with different args (the interesting case the operator
 * actually wants to spot), `none` otherwise (different tool entirely
 * → already covered by the ordinal mismatch tag in the cell border).
 */
function computeStepTag(
  series: readonly (readonly ToolCall[])[],
  step: number,
  name: string,
  argsJson: string,
): 'match' | 'differ' | 'none' {
  const peers: ToolCall[] = [];
  for (const s of series) {
    const tc = s[step];
    if (tc !== undefined) peers.push(tc);
  }
  if (peers.length < 2) return 'none';
  const sameName = peers.every((p) => p.name === name);
  if (!sameName) return 'none';
  const allSameArgs = peers.every((p) => p.argsJson === argsJson);
  return allSameArgs ? 'match' : 'differ';
}
