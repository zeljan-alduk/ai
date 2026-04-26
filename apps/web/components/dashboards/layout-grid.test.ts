/**
 * Wave-14 — pure-logic tests for the dashboards layout grid.
 */

import type { DashboardWidget } from '@aldo-ai/api-contract';
import { describe, expect, it } from 'vitest';
import {
  GRID_COLS,
  clampColRow,
  layoutHeight,
  moveWidget,
  nextFreeRow,
  packLayout,
  rectsOverlap,
  resizeWidget,
} from './layout-grid';

function w(id: string, col: number, row: number, width = 4, height = 2): DashboardWidget {
  return {
    id,
    kind: 'kpi-runs-24h',
    title: id,
    query: { period: '24h' },
    layout: { col, row, w: width, h: height },
  };
}

describe('layout-grid', () => {
  it('clampColRow snaps cols inside the 12-col grid', () => {
    expect(clampColRow({ col: -3, row: 0 }, { w: 4, h: 2 })).toEqual({ col: 0, row: 0 });
    expect(clampColRow({ col: 99, row: 0 }, { w: 4, h: 2 })).toEqual({
      col: GRID_COLS - 4,
      row: 0,
    });
    expect(clampColRow({ col: 5, row: 7 }, { w: 4, h: 2 })).toEqual({ col: 5, row: 7 });
  });

  it('rectsOverlap is strict — touching edges do not overlap', () => {
    expect(rectsOverlap({ col: 0, row: 0, w: 4, h: 2 }, { col: 4, row: 0, w: 4, h: 2 })).toBe(
      false,
    );
    expect(rectsOverlap({ col: 0, row: 0, w: 4, h: 2 }, { col: 3, row: 0, w: 4, h: 2 })).toBe(true);
    expect(rectsOverlap({ col: 0, row: 0, w: 4, h: 4 }, { col: 0, row: 4, w: 4, h: 2 })).toBe(
      false,
    );
  });

  it('packLayout pushes overlapping widgets DOWN preserving order', () => {
    const a = w('a', 0, 0, 6, 2);
    const b = w('b', 0, 0, 6, 2);
    const c = w('c', 0, 0, 6, 2);
    const packed = packLayout([a, b, c]);
    expect(packed[0]?.layout.row).toBe(0);
    expect(packed[1]?.layout.row).toBe(2);
    expect(packed[2]?.layout.row).toBe(4);
  });

  it('packLayout leaves non-overlapping widgets untouched', () => {
    const a = w('a', 0, 0, 4, 2);
    const b = w('b', 4, 0, 4, 2);
    const c = w('c', 8, 0, 4, 2);
    const packed = packLayout([a, b, c]);
    expect(packed.map((p) => p.layout.row)).toEqual([0, 0, 0]);
  });

  it('nextFreeRow finds the first row with no overlap at the column', () => {
    const layout = [w('a', 0, 0, 6, 2), w('b', 0, 2, 6, 2)];
    expect(nextFreeRow(layout, { col: 0, w: 6, h: 2 })).toBe(4);
    expect(nextFreeRow(layout, { col: 6, w: 6, h: 2 })).toBe(0);
  });

  it('layoutHeight returns the bottom of the lowest widget', () => {
    expect(layoutHeight([w('a', 0, 0, 6, 2), w('b', 0, 4, 6, 4)])).toBe(8);
    expect(layoutHeight([])).toBe(0);
  });

  it('moveWidget snaps + repacks', () => {
    const layout = [w('a', 0, 0, 4, 2), w('b', 4, 0, 4, 2), w('c', 8, 0, 4, 2)];
    const after = moveWidget(layout, 'b', { col: 0, row: 0 });
    // 'b' lands on (0, 0); 'a' (was 0,0) gets pushed down; 'c' stays (8,0).
    const placedB = after.find((w) => w.id === 'b');
    const placedA = after.find((w) => w.id === 'a');
    const placedC = after.find((w) => w.id === 'c');
    expect(placedB?.layout).toEqual({ col: 0, row: 0, w: 4, h: 2 });
    expect((placedA?.layout.row ?? 0) >= 2).toBe(true);
    expect(placedC?.layout).toEqual({ col: 8, row: 0, w: 4, h: 2 });
  });

  it('resizeWidget clamps width to remaining cols', () => {
    const layout = [w('a', 8, 0, 4, 2)];
    const after = resizeWidget(layout, 'a', { w: 99, h: 2 });
    expect(after[0]?.layout.w).toBe(4); // 12 - 8 = 4 max
  });

  it('moveWidget is a no-op when id is unknown', () => {
    const layout = [w('a', 0, 0, 4, 2)];
    const after = moveWidget(layout, 'no-such-id', { col: 5, row: 5 });
    expect(after.length).toBe(1);
    expect(after[0]?.layout).toEqual({ col: 0, row: 0, w: 4, h: 2 });
  });
});
