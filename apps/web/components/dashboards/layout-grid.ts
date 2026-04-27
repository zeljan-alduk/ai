/**
 * Pure-logic helpers for the wave-14 dashboard 12-column grid.
 *
 * No React, no DOM — these run inside vitest without a renderer. The
 * page wires them into the editor's drag handler / save action.
 */

import type { DashboardWidget, WidgetLayout } from '@aldo-ai/api-contract';

export const GRID_COLS = 12;

/**
 * Snap a (col, row) intent to a valid position on the 12-col grid for
 * a widget of width `w`. If the requested col would push the right
 * edge past column 12, snap it back so `col + w === 12`.
 */
export function clampColRow(
  intent: { col: number; row: number },
  size: { w: number; h: number },
): { col: number; row: number } {
  const col = Math.max(0, Math.min(GRID_COLS - size.w, Math.round(intent.col)));
  const row = Math.max(0, Math.round(intent.row));
  return { col, row };
}

/**
 * True iff two layout rectangles intersect on the grid.
 * Strict — touching edges are NOT an intersection.
 */
export function rectsOverlap(a: WidgetLayout, b: WidgetLayout): boolean {
  const aRight = a.col + a.w;
  const aBottom = a.row + a.h;
  const bRight = b.col + b.w;
  const bBottom = b.row + b.h;
  return a.col < bRight && b.col < aRight && a.row < bBottom && b.row < aBottom;
}

/**
 * Pack a desired layout into a non-overlapping grid by pushing
 * conflicting widgets DOWN (incrementing row). The desired ordering
 * (input array order) is preserved as the priority for resolving
 * conflicts.
 *
 * Returns a NEW array of widgets with potentially-adjusted row coords.
 */
export function packLayout(layout: ReadonlyArray<DashboardWidget>): DashboardWidget[] {
  const placed: DashboardWidget[] = [];
  for (const w of layout) {
    const placedLayout = { ...w.layout };
    while (placed.some((p) => rectsOverlap(p.layout, placedLayout))) {
      placedLayout.row += 1;
    }
    placed.push({ ...w, layout: placedLayout });
  }
  return placed;
}

/**
 * Find the next free row at the given column for inserting a new
 * widget. Returns 0 if the column has no widgets yet.
 */
export function nextFreeRow(
  layout: ReadonlyArray<DashboardWidget>,
  size: { col: number; w: number; h: number },
): number {
  let row = 0;
  while (layout.some((p) => rectsOverlap(p.layout, { col: size.col, w: size.w, row, h: size.h }))) {
    row += 1;
  }
  return row;
}

/**
 * Total height (in rows) the layout occupies — handy for setting the
 * editor canvas's min-height so widgets near the bottom remain
 * droppable.
 */
export function layoutHeight(layout: ReadonlyArray<DashboardWidget>): number {
  let h = 0;
  for (const w of layout) {
    const bottom = w.layout.row + w.layout.h;
    if (bottom > h) h = bottom;
  }
  return h;
}

/**
 * Move an existing widget by id to a new (col, row), snapping into
 * grid bounds and packing the result so no two widgets overlap.
 */
export function moveWidget(
  layout: ReadonlyArray<DashboardWidget>,
  id: string,
  intent: { col: number; row: number },
): DashboardWidget[] {
  const moved: DashboardWidget[] = [];
  let target: DashboardWidget | null = null;
  for (const w of layout) {
    if (w.id === id) {
      const next = clampColRow(intent, { w: w.layout.w, h: w.layout.h });
      target = { ...w, layout: { ...w.layout, col: next.col, row: next.row } };
    } else {
      moved.push(w);
    }
  }
  if (target === null) return [...layout];
  // Place the moved widget first so it claims its preferred slot; the
  // packer pushes any conflicts down.
  return packLayout([target, ...moved]);
}

/**
 * Resize a widget. Width is clamped to (1..12-col). Height is clamped
 * to (1..12). Conflicts are resolved by `packLayout`.
 */
export function resizeWidget(
  layout: ReadonlyArray<DashboardWidget>,
  id: string,
  size: { w: number; h: number },
): DashboardWidget[] {
  const next: DashboardWidget[] = [];
  for (const w of layout) {
    if (w.id === id) {
      const newW = Math.max(1, Math.min(GRID_COLS - w.layout.col, Math.round(size.w)));
      const newH = Math.max(1, Math.min(12, Math.round(size.h)));
      next.push({ ...w, layout: { ...w.layout, w: newW, h: newH } });
    } else {
      next.push(w);
    }
  }
  return packLayout(next);
}
