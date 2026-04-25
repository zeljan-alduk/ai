'use client';

import { formatUsd } from '@/lib/format';
import type { Sweep, SweepCellResult } from '@aldo-ai/api-contract';
import { useMemo, useState } from 'react';
import { CellDetail } from './cell-detail';

/**
 * Model-x-case matrix.
 *
 * Rows = cases (in the order they appear in the sweep cells, falling
 * back to the order discovered in `cells`). Columns = models from the
 * sweep request. Each cell is colour-coded:
 *   green  — passed
 *   red    — failed
 *   grey   — pending (no result yet — the sweep is still running, or
 *            the runner has not produced this cell)
 *
 * Click a cell to expand a drill-down panel beneath the matrix.
 *
 * CONTRACT ASSUMPTION: while a sweep is `queued` or `running`, the
 * server may include a partial `cells[]` array; cells that have not
 * been produced are simply absent. We render those as `pending`. The
 * full set of cases is recovered from the union of seen `caseId`s — if
 * the sweep produces zero cells we render an empty-state message rather
 * than a placeholder grid (we don't know the case ids without hitting
 * the suite endpoint).
 */
export function SweepMatrix({ sweep }: { sweep: Sweep }) {
  const { caseIds, models, cellMap } = useMemo(() => buildIndex(sweep), [sweep]);
  const [selected, setSelected] = useState<{ caseId: string; model: string } | null>(null);

  if (caseIds.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-slate-300 bg-white px-6 py-12 text-center">
        <p className="text-sm font-medium text-slate-700">No cells yet.</p>
        <p className="mt-1 text-sm text-slate-500">
          Cells appear here as the sweep runner produces them.
        </p>
      </div>
    );
  }

  const selectedCell =
    selected != null ? (cellMap.get(cellKey(selected.caseId, selected.model)) ?? null) : null;

  return (
    <div className="flex flex-col gap-4">
      <div className="overflow-auto rounded-md border border-slate-200 bg-white">
        <table className="aldo-table">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 bg-slate-100">Case</th>
              {models.map((m) => (
                <th key={m} className="text-center font-mono text-[11px]">
                  {m}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {caseIds.map((caseId) => (
              <tr key={caseId}>
                <td className="sticky left-0 z-10 bg-white font-mono text-[11px] text-slate-700">
                  {caseId}
                </td>
                {models.map((model) => {
                  const cell = cellMap.get(cellKey(caseId, model));
                  const isSelected = selected?.caseId === caseId && selected?.model === model;
                  return (
                    <td key={model} className="text-center">
                      <CellButton
                        cell={cell}
                        selected={isSelected}
                        onClick={() =>
                          setSelected((prev) =>
                            prev?.caseId === caseId && prev?.model === model
                              ? null
                              : { caseId, model },
                          )
                        }
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
            <tr className="bg-slate-50">
              <td className="sticky left-0 z-10 bg-slate-50 text-xs font-medium text-slate-700">
                Aggregate
              </td>
              {models.map((m) => {
                const agg = sweep.byModel[m];
                return (
                  <td key={m} className="text-center text-xs tabular-nums text-slate-700">
                    {agg ? (
                      <>
                        <div>
                          <span className="font-medium text-slate-900">{agg.passed}</span>
                          <span className="text-slate-400"> / {agg.total}</span>
                        </div>
                        <div className="text-[11px] text-slate-500">{formatUsd(agg.usd)}</div>
                      </>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
                );
              })}
            </tr>
          </tbody>
        </table>
      </div>

      {selected ? (
        <div>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
              Cell detail
            </h3>
            <button
              type="button"
              onClick={() => setSelected(null)}
              className="rounded border border-slate-300 bg-white px-2 py-0.5 text-xs hover:bg-slate-50"
            >
              Close
            </button>
          </div>
          <CellDetail cell={selectedCell} caseId={selected.caseId} model={selected.model} />
        </div>
      ) : (
        <p className="text-xs text-slate-500">
          Click any cell to inspect output, detail, and cost.
        </p>
      )}
    </div>
  );
}

function CellButton({
  cell,
  selected,
  onClick,
}: {
  cell: SweepCellResult | undefined;
  selected: boolean;
  onClick: () => void;
}) {
  const state: 'pass' | 'fail' | 'pending' =
    cell == null ? 'pending' : cell.passed ? 'pass' : 'fail';
  const colour =
    state === 'pass'
      ? 'bg-emerald-500 hover:bg-emerald-600'
      : state === 'fail'
        ? 'bg-red-500 hover:bg-red-600'
        : 'bg-slate-300 hover:bg-slate-400';
  const ring = selected ? 'ring-2 ring-offset-1 ring-slate-900' : '';
  const label =
    state === 'pass'
      ? `Pass — score ${cell?.score.toFixed(2) ?? ''}`
      : state === 'fail'
        ? `Fail — score ${cell?.score.toFixed(2) ?? ''}`
        : 'Pending';
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className={`h-6 w-10 rounded ${colour} ${ring} transition-colors`}
    />
  );
}

function cellKey(caseId: string, model: string): string {
  return `${caseId}${model}`;
}

function buildIndex(sweep: Sweep) {
  const cellMap = new Map<string, SweepCellResult>();
  const caseOrder: string[] = [];
  const caseSeen = new Set<string>();
  for (const cell of sweep.cells) {
    cellMap.set(cellKey(cell.caseId, cell.model), cell);
    if (!caseSeen.has(cell.caseId)) {
      caseSeen.add(cell.caseId);
      caseOrder.push(cell.caseId);
    }
  }
  // Models come from the sweep request, not the cells — that way columns
  // stay stable even before any cell has been produced.
  const models = [...sweep.models];
  return { caseIds: caseOrder, models, cellMap };
}
