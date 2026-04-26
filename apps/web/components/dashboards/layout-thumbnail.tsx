/**
 * Server-rendered SVG snapshot of a dashboard layout.
 *
 * Pure, deterministic: every widget becomes a labelled rectangle on a
 * 12-col grid. Used by the /dashboards list page so the cards look
 * different at a glance.
 */

import type { DashboardWidget } from '@aldo-ai/api-contract';
import { layoutHeight } from './layout-grid';

export function LayoutThumbnail({
  layout,
}: {
  layout: ReadonlyArray<DashboardWidget>;
}) {
  const cols = 12;
  const rows = Math.max(4, layoutHeight(layout));
  const width = 240;
  const height = Math.min(120, Math.max(60, rows * 8));
  const cellW = width / cols;
  const cellH = height / rows;
  return (
    <svg
      role="img"
      aria-label="dashboard layout preview"
      viewBox={`0 0 ${width} ${height}`}
      className="h-24 w-full rounded bg-slate-50"
    >
      {layout.map((w) => (
        <g key={w.id}>
          <rect
            x={w.layout.col * cellW + 1}
            y={w.layout.row * cellH + 1}
            width={Math.max(1, w.layout.w * cellW - 2)}
            height={Math.max(1, w.layout.h * cellH - 2)}
            rx={2}
            ry={2}
            fill={fillForKind(w.kind)}
            opacity={0.85}
          />
        </g>
      ))}
    </svg>
  );
}

function fillForKind(kind: string): string {
  if (kind.startsWith('kpi-')) return '#bfdbfe'; // blue-200
  if (kind.startsWith('timeseries-')) return '#a7f3d0'; // emerald-200
  if (kind.startsWith('pie-')) return '#fde68a'; // amber-200
  if (kind.startsWith('bar-')) return '#ddd6fe'; // violet-200
  if (kind.startsWith('heatmap-')) return '#fecaca'; // red-200
  return '#e2e8f0'; // slate-200
}
