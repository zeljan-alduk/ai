/**
 * Fixed-width ASCII table renderer for `BenchSuiteCaseResult` rows.
 *
 * Used by the CLI (where it produces the live table you see scrolling
 * in the terminal). The web UI consumes the structured event stream
 * directly and renders its own table — this formatter is pure and
 * has no UI assumptions, so it's reusable.
 */

import type { BenchSuiteCaseResult, BenchSuiteSummary } from './types.js';

export interface ColumnWidths {
  readonly id: number;
}

export function widthsFor(caseIds: readonly string[]): ColumnWidths {
  const id = Math.max(4, ...caseIds.map((s) => s.length));
  return { id };
}

/**
 * Per-case row. ASCII-only; no border characters so the output is
 * clipboard- and pipe-friendly.
 *
 * Columns: id · pass · total_ms · tok_in · tok_out · reason · tok/s
 */
export function formatCaseRow(r: BenchSuiteCaseResult, w: ColumnWidths): string {
  const pass = r.passed ? 'pass' : r.error !== undefined ? 'ERR ' : 'FAIL';
  const id = r.id.padEnd(w.id);
  const total = String(Math.round(r.totalMs)).padStart(8);
  const tokIn = (r.tokensIn === null ? '-' : String(r.tokensIn)).padStart(7);
  const tokOut = (r.tokensOut === null ? '-' : String(r.tokensOut)).padStart(7);
  const reason = (
    r.reasoningRatio === null ? '-' : `${(r.reasoningRatio * 100).toFixed(0)}%`
  ).padStart(6);
  const tps = (r.tokPerSec === null ? '-' : r.tokPerSec.toFixed(1)).padStart(7);
  const head = `  ${id}  ${pass}  ${total}  ${tokIn}  ${tokOut}  ${reason}  ${tps}`;
  if (r.error !== undefined) return `${head}  ${truncate(r.error, 60)}`;
  return head;
}

export function formatHeader(w: ColumnWidths): string {
  return `  ${'case'.padEnd(w.id)}  ${'pass'}  ${'total_ms'.padStart(8)}  ${'tok_in'.padStart(7)}  ${'tok_out'.padStart(7)}  ${'reason'.padStart(6)}  ${'tok/s'.padStart(7)}`;
}

export function formatSummary(s: BenchSuiteSummary): string {
  const lines: string[] = [];
  lines.push(`# overall: ${s.passed}/${s.total} cases pass (${(s.passRate * 100).toFixed(0)}%)`);
  const tps = s.avgTokPerSec === null ? '-' : s.avgTokPerSec.toFixed(1);
  const reason = s.avgReasoningRatio === null ? '-' : `${(s.avgReasoningRatio * 100).toFixed(0)}%`;
  lines.push(
    `# avg tok/s ${tps} · avg reasoning ${reason} · p95 latency ${(s.p95LatencyMs / 1000).toFixed(1)} s`,
  );
  return lines.join('\n');
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n - 1)}…`;
}
