/**
 * Tiny matrix thumbnail — colored cells only, no labels.
 *
 * Two render modes:
 *
 *   1. Full sweep payload (`cells` populated) — colors per cell:
 *      pass = emerald, fail = red, pending = slate.
 *
 *   2. Summary mode (`cells` empty, only `modelCount`+`caseCount`):
 *      render an `m x n` grid of muted slate cells. The point is to
 *      give the gallery a sense of sweep size at a glance even before
 *      we round-trip the detail endpoint per card.
 *
 * Pure SVG so it server-renders without a client island.
 */

import type { SweepCellResult } from '@aldo-ai/api-contract';

const CELL = 6;
const GAP = 1;
const PADDING = 2;
const MAX_CASES = 24;
const MAX_MODELS = 8;

export interface SweepThumbnailProps {
  models: ReadonlyArray<string>;
  cells?: ReadonlyArray<SweepCellResult>;
  /** Used in summary mode (no cells). Number of cases to draw. */
  caseCount?: number;
  className?: string;
}

export function SweepThumbnail({ models, cells, caseCount, className }: SweepThumbnailProps) {
  const visibleModels = models.slice(0, MAX_MODELS);
  const cellsArr = cells ?? [];
  const caseIds: string[] = [];
  if (cellsArr.length > 0) {
    const seen = new Set<string>();
    for (const c of cellsArr) {
      if (!seen.has(c.caseId)) {
        seen.add(c.caseId);
        caseIds.push(c.caseId);
        if (caseIds.length >= MAX_CASES) break;
      }
    }
  } else if (typeof caseCount === 'number' && caseCount > 0) {
    for (let i = 0; i < Math.min(caseCount, MAX_CASES); i++) caseIds.push(`c${i}`);
  }

  if (visibleModels.length === 0 || caseIds.length === 0) {
    return (
      <div
        className={
          className ??
          'flex h-16 w-full items-center justify-center rounded bg-slate-50 text-[10px] text-slate-400'
        }
      >
        no cells yet
      </div>
    );
  }

  const cellMap = new Map<string, SweepCellResult>();
  for (const c of cellsArr) {
    cellMap.set(`${c.caseId}\0${c.model}`, c);
  }

  const width = PADDING * 2 + visibleModels.length * CELL + (visibleModels.length - 1) * GAP;
  const height = PADDING * 2 + caseIds.length * CELL + (caseIds.length - 1) * GAP;

  return (
    <svg
      width="100%"
      height={Math.max(height, 36)}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label="sweep matrix thumbnail"
      className={className}
    >
      {caseIds.map((caseId, ri) =>
        visibleModels.map((model, ci) => {
          const cell = cellMap.get(`${caseId}\0${model}`);
          // Summary mode: no per-cell info → just outline-style fill.
          let fill = '#cbd5e1';
          if (cell) fill = cell.passed ? '#10b981' : '#ef4444';
          return (
            <rect
              key={`${caseId}-${model}`}
              x={PADDING + ci * (CELL + GAP)}
              y={PADDING + ri * (CELL + GAP)}
              width={CELL}
              height={CELL}
              rx={1}
              ry={1}
              fill={fill}
            />
          );
        }),
      )}
    </svg>
  );
}
