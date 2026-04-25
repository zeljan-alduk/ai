import { formatDuration, formatUsd } from '@/lib/format';
import type { SweepCellResult } from '@aldo-ai/api-contract';
import { PassBadge } from './pass-badge';

/**
 * Drill-down panel for a single (case x model) cell. Renders the raw
 * agent output, evaluator detail, and per-cell cost/duration. Used both
 * inside the matrix (inline expansion) and on its own.
 *
 * Local-only models cost $0.00 — we render the value as-is from the
 * server (`costUsd` defaults to 0 in the schema), no provider sniffing.
 */
export function CellDetail({
  cell,
  caseId,
  model,
}: {
  cell: SweepCellResult | null;
  caseId: string;
  model: string;
}) {
  if (!cell) {
    return (
      <div className="rounded border border-slate-200 bg-slate-50 p-3 text-xs text-slate-500">
        <div className="mb-1 flex items-center gap-2">
          <PassBadge state="pending" />
          <span className="font-mono text-[11px] text-slate-600">
            {caseId} <span className="text-slate-400">/</span> {model}
          </span>
        </div>
        Pending — the sweep has not produced a result for this cell yet.
      </div>
    );
  }

  return (
    <div className="rounded border border-slate-200 bg-white p-3">
      <div className="mb-2 flex flex-wrap items-center gap-3">
        <PassBadge state={cell.passed ? 'pass' : 'fail'} />
        <span className="font-mono text-[11px] text-slate-600">
          {caseId} <span className="text-slate-400">/</span> {model}
        </span>
        <span className="text-xs text-slate-500">
          score{' '}
          <span className="font-mono tabular-nums text-slate-800">{cell.score.toFixed(2)}</span>
        </span>
        <span className="text-xs text-slate-500">
          cost{' '}
          <span className="font-mono tabular-nums text-slate-800">{formatUsd(cell.costUsd)}</span>
        </span>
        <span className="text-xs text-slate-500">
          duration{' '}
          <span className="font-mono tabular-nums text-slate-800">
            {formatDuration(cell.durationMs)}
          </span>
        </span>
      </div>

      <div className="mb-3">
        <div className="mb-1 text-[10px] uppercase tracking-wider text-slate-500">Output</div>
        <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded bg-slate-950 p-2 text-[11px] text-slate-100">
          {cell.output || '(empty)'}
        </pre>
      </div>

      <div>
        <div className="mb-1 text-[10px] uppercase tracking-wider text-slate-500">
          Evaluator detail
        </div>
        {cell.detail === undefined || cell.detail === null ? (
          <p className="text-xs text-slate-500">(none)</p>
        ) : (
          <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded bg-slate-50 p-2 text-[11px] text-slate-700">
            {typeof cell.detail === 'string' ? cell.detail : JSON.stringify(cell.detail, null, 2)}
          </pre>
        )}
      </div>
    </div>
  );
}
