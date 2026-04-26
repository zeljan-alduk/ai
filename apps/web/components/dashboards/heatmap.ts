/**
 * Pure-logic helpers for the wave-14 SVG heatmap widget.
 *
 * Given the wire-shape `HeatmapData` (xLabels, yLabels, cells, min,
 * max), compute the per-cell rectangle coords, fill colors, and
 * tooltip strings. No React, no DOM — the SVG component just maps
 * over `layoutCells()`.
 */

import type { HeatmapCell, HeatmapData } from '@aldo-ai/api-contract';

export interface HeatmapDimensions {
  /** Total SVG width in px (including y-axis label gutter). */
  readonly width: number;
  /** Total SVG height in px (including x-axis label gutter). */
  readonly height: number;
  /** Reserved for the y-axis labels on the left. */
  readonly yGutter: number;
  /** Reserved for the x-axis labels on the bottom. */
  readonly xGutter: number;
}

export interface LaidOutCell extends HeatmapCell {
  readonly rect: { x: number; y: number; width: number; height: number };
  readonly fill: string;
  readonly tooltip: string;
}

/**
 * Map `value` ∈ [min, max] to a CSS color along a green→amber→red
 * gradient. The gradient is cell-color-blind safe up to 3 stops, but
 * we deliberately keep it simple — the page's legend reads the gradient
 * end-to-end so users don't have to memorise the steps.
 */
export function valueToColor(value: number, min: number, max: number): string {
  if (max <= min) return '#e2e8f0';
  // Normalise into [0, 1].
  const t = Math.max(0, Math.min(1, (value - min) / (max - min)));
  // Interpolate between three stops:
  //   t=0   → #e2e8f0 (slate-200, near-empty)
  //   t=0.5 → #f59e0b (amber-500)
  //   t=1   → #dc2626 (red-600)
  const stops: ReadonlyArray<{ at: number; rgb: [number, number, number] }> = [
    { at: 0, rgb: [226, 232, 240] },
    { at: 0.5, rgb: [245, 158, 11] },
    { at: 1, rgb: [220, 38, 38] },
  ];
  const a = stops[Math.max(0, Math.floor(t * (stops.length - 1)))]!;
  const b = stops[Math.min(stops.length - 1, Math.floor(t * (stops.length - 1)) + 1)]!;
  if (a === b) return rgb(a.rgb);
  const span = b.at - a.at;
  const local = span === 0 ? 0 : (t - a.at) / span;
  return rgb([
    Math.round(a.rgb[0] + (b.rgb[0] - a.rgb[0]) * local),
    Math.round(a.rgb[1] + (b.rgb[1] - a.rgb[1]) * local),
    Math.round(a.rgb[2] + (b.rgb[2] - a.rgb[2]) * local),
  ]);
}

function rgb([r, g, b]: [number, number, number]): string {
  return `rgb(${r}, ${g}, ${b})`;
}

/**
 * Lay out every cell in the heatmap into pixel rects + fill colors.
 * Empty matrix → empty array.
 */
export function layoutCells(
  data: HeatmapData,
  dim: HeatmapDimensions,
  formatValue: (v: number) => string = (v) => String(Math.round(v * 100) / 100),
): LaidOutCell[] {
  const xCount = data.xLabels.length;
  const yCount = data.yLabels.length;
  if (xCount === 0 || yCount === 0) return [];
  const plotW = Math.max(1, dim.width - dim.yGutter);
  const plotH = Math.max(1, dim.height - dim.xGutter);
  const cellW = plotW / xCount;
  const cellH = plotH / yCount;
  const yIndex = new Map<string, number>();
  data.yLabels.forEach((y, i) => yIndex.set(y, i));
  return data.cells
    .map((cell): LaidOutCell | null => {
      const yPos = yIndex.get(cell.y);
      if (yPos === undefined) return null;
      const x = dim.yGutter + cell.x * cellW;
      const y = yPos * cellH;
      return {
        ...cell,
        rect: { x, y, width: cellW, height: cellH },
        fill: valueToColor(cell.value, data.min, data.max),
        tooltip: `${data.xLabels[cell.x] ?? `x=${cell.x}`} × ${cell.y}: ${formatValue(cell.value)}`,
      };
    })
    .filter((v): v is LaidOutCell => v !== null);
}

/**
 * Compute the (x, y, label) anchors for the y-axis labels (left
 * gutter). The renderer just maps over this and stamps `<text>`s.
 */
export function yAxisLabels(
  data: HeatmapData,
  dim: HeatmapDimensions,
): ReadonlyArray<{ x: number; y: number; label: string }> {
  const plotH = Math.max(1, dim.height - dim.xGutter);
  const cellH = plotH / Math.max(1, data.yLabels.length);
  return data.yLabels.map((label, i) => ({
    x: dim.yGutter - 4,
    y: i * cellH + cellH / 2,
    label,
  }));
}

export function xAxisLabels(
  data: HeatmapData,
  dim: HeatmapDimensions,
): ReadonlyArray<{ x: number; y: number; label: string }> {
  const plotW = Math.max(1, dim.width - dim.yGutter);
  const cellW = plotW / Math.max(1, data.xLabels.length);
  const yBase = dim.height - dim.xGutter + 12;
  return data.xLabels.map((label, i) => ({
    x: dim.yGutter + i * cellW + cellW / 2,
    y: yBase,
    label,
  }));
}
