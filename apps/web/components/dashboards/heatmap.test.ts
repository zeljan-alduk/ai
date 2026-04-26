/**
 * Wave-14 — pure-logic tests for the heatmap SVG layout.
 */

import type { HeatmapData } from '@aldo-ai/api-contract';
import { describe, expect, it } from 'vitest';
import { layoutCells, valueToColor, xAxisLabels, yAxisLabels } from './heatmap';

const dim = { width: 600, height: 240, yGutter: 80, xGutter: 24 };

const sample: HeatmapData = {
  shape: 'heatmap',
  xLabels: ['00', '01', '02'],
  yLabels: ['gpt', 'claude'],
  cells: [
    { x: 0, y: 'gpt', value: 1 },
    { x: 1, y: 'gpt', value: 5 },
    { x: 2, y: 'gpt', value: 10 },
    { x: 0, y: 'claude', value: 2 },
    { x: 1, y: 'claude', value: 4 },
    { x: 2, y: 'claude', value: 8 },
  ],
  min: 1,
  max: 10,
};

describe('heatmap', () => {
  it('valueToColor — min returns the slate ramp; max returns red', () => {
    expect(valueToColor(1, 1, 10)).toBe('rgb(226, 232, 240)');
    expect(valueToColor(10, 1, 10)).toBe('rgb(220, 38, 38)');
  });

  it('valueToColor handles degenerate min===max (returns the empty fill)', () => {
    expect(valueToColor(5, 5, 5)).toBe('#e2e8f0');
  });

  it('layoutCells projects every cell into the plot rectangle', () => {
    const laid = layoutCells(sample, dim);
    expect(laid.length).toBe(6);
    // Plot width = 600 - 80 = 520; with 3 cols → cellW ≈ 173.33
    const first = laid.find((c) => c.x === 0 && c.y === 'gpt')!;
    expect(first.rect.x).toBeCloseTo(80);
    expect(first.rect.width).toBeCloseTo(520 / 3, 1);
    expect(first.rect.y).toBeCloseTo(0);
    // Plot height = 240 - 24 = 216; 2 rows → cellH = 108.
    expect(first.rect.height).toBeCloseTo(108);
  });

  it('layoutCells builds a tooltip per cell', () => {
    const laid = layoutCells(sample, dim);
    expect(laid[0]?.tooltip).toContain('gpt');
    expect(laid[0]?.tooltip).toContain('00');
  });

  it('layoutCells returns [] for empty matrix', () => {
    expect(
      layoutCells({ shape: 'heatmap', xLabels: [], yLabels: [], cells: [], min: 0, max: 0 }, dim),
    ).toEqual([]);
  });

  it('yAxisLabels stamps one label per y row', () => {
    const labels = yAxisLabels(sample, dim);
    expect(labels.length).toBe(2);
    expect(labels[0]?.label).toBe('gpt');
    expect(labels[1]?.label).toBe('claude');
  });

  it('xAxisLabels stamps one label per x bucket', () => {
    const labels = xAxisLabels(sample, dim);
    expect(labels.length).toBe(3);
    expect(labels.map((l) => l.label)).toEqual(['00', '01', '02']);
  });

  it('layoutCells skips cells that reference an unknown y label', () => {
    const data: HeatmapData = {
      ...sample,
      cells: [...sample.cells, { x: 0, y: 'orphan', value: 99 }],
    };
    const laid = layoutCells(data, dim);
    expect(laid.find((c) => c.y === 'orphan')).toBeUndefined();
    expect(laid.length).toBe(6);
  });
});
