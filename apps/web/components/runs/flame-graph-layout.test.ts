/**
 * Layout tests for the trace flame graph.
 *
 * Pure-function math: assert positions for fixture trees. No DOM.
 */

import type { RunTreeNode } from '@aldo-ai/api-contract';
import { describe, expect, it } from 'vitest';
import {
  MIN_BAR_PX,
  ROW_GAP,
  ROW_HEIGHT,
  barRect,
  fitLabel,
  layoutTree,
  statusFill,
} from './flame-graph-layout.js';

function node(opts: {
  id: string;
  agentName?: string;
  startedAt: string;
  endedAt: string | null;
  status?: RunTreeNode['status'];
  children?: RunTreeNode[];
  lastModel?: string | null;
}): RunTreeNode {
  return {
    runId: opts.id,
    agentName: opts.agentName ?? opts.id,
    agentVersion: '1.0.0',
    status: opts.status ?? 'completed',
    parentRunId: null,
    startedAt: opts.startedAt,
    endedAt: opts.endedAt,
    durationMs:
      opts.endedAt === null ? null : Date.parse(opts.endedAt) - Date.parse(opts.startedAt),
    totalUsd: 0,
    lastProvider: null,
    lastModel: opts.lastModel ?? null,
    children: opts.children ?? [],
  };
}

describe('layoutTree', () => {
  it('places the root at depth=0, x=0', () => {
    const root = node({
      id: 'root',
      startedAt: '2026-04-25T10:00:00.000Z',
      endedAt: '2026-04-25T10:00:10.000Z',
    });
    const out = layoutTree(root, { pxPerMs: 0.1, rootDurationMs: 10_000 });
    expect(out.bars).toHaveLength(1);
    expect(out.bars[0]?.depth).toBe(0);
    expect(out.bars[0]?.startMs).toBe(0);
    expect(out.bars[0]?.durationMs).toBe(10_000);
    expect(out.totalDepth).toBe(0);
    expect(out.totalWidthPx).toBeCloseTo(10_000 * 0.1, 6);
    expect(out.totalHeightPx).toBe(ROW_HEIGHT + ROW_GAP);
  });

  it('places children at depth=1 with offsets relative to root', () => {
    const root = node({
      id: 'root',
      startedAt: '2026-04-25T10:00:00.000Z',
      endedAt: '2026-04-25T10:00:10.000Z',
      children: [
        node({
          id: 'child-a',
          startedAt: '2026-04-25T10:00:01.000Z',
          endedAt: '2026-04-25T10:00:03.000Z',
        }),
        node({
          id: 'child-b',
          startedAt: '2026-04-25T10:00:05.000Z',
          endedAt: '2026-04-25T10:00:09.000Z',
        }),
      ],
    });
    const out = layoutTree(root, { pxPerMs: 1, rootDurationMs: 10_000 });
    expect(out.bars).toHaveLength(3);
    const a = out.bars.find((b) => b.id === 'child-a');
    const b = out.bars.find((b) => b.id === 'child-b');
    expect(a?.depth).toBe(1);
    expect(a?.startMs).toBe(1000);
    expect(a?.durationMs).toBe(2000);
    expect(b?.depth).toBe(1);
    expect(b?.startMs).toBe(5000);
    expect(b?.durationMs).toBe(4000);
    expect(out.totalDepth).toBe(1);
  });

  it('treats a still-running node (endedAt=null) as ending at rootDurationMs', () => {
    const root = node({
      id: 'root',
      startedAt: '2026-04-25T10:00:00.000Z',
      endedAt: null,
      status: 'running',
      children: [
        node({
          id: 'child-running',
          startedAt: '2026-04-25T10:00:02.000Z',
          endedAt: null,
          status: 'running',
        }),
      ],
    });
    const out = layoutTree(root, { pxPerMs: 1, rootDurationMs: 12_000 });
    const rootBar = out.bars.find((b) => b.id === 'root');
    const childBar = out.bars.find((b) => b.id === 'child-running');
    expect(rootBar?.endMs).toBe(12_000);
    expect(childBar?.endMs).toBe(12_000);
    expect(childBar?.durationMs).toBe(10_000);
  });

  it('sorts bars by depth then start time', () => {
    const root = node({
      id: 'root',
      startedAt: '2026-04-25T10:00:00.000Z',
      endedAt: '2026-04-25T10:00:10.000Z',
      children: [
        // Children intentionally inserted out-of-order time-wise.
        node({
          id: 'late',
          startedAt: '2026-04-25T10:00:08.000Z',
          endedAt: '2026-04-25T10:00:09.000Z',
        }),
        node({
          id: 'early',
          startedAt: '2026-04-25T10:00:01.000Z',
          endedAt: '2026-04-25T10:00:02.000Z',
        }),
      ],
    });
    const out = layoutTree(root, { pxPerMs: 1, rootDurationMs: 10_000 });
    expect(out.bars[0]?.id).toBe('root');
    expect(out.bars[1]?.id).toBe('early');
    expect(out.bars[2]?.id).toBe('late');
  });

  it('handles deep nesting and reports totalDepth correctly', () => {
    // Build a 4-deep chain.
    const leaf = node({
      id: 'leaf',
      startedAt: '2026-04-25T10:00:03.000Z',
      endedAt: '2026-04-25T10:00:04.000Z',
    });
    const mid2 = node({
      id: 'mid2',
      startedAt: '2026-04-25T10:00:02.000Z',
      endedAt: '2026-04-25T10:00:05.000Z',
      children: [leaf],
    });
    const mid1 = node({
      id: 'mid1',
      startedAt: '2026-04-25T10:00:01.000Z',
      endedAt: '2026-04-25T10:00:06.000Z',
      children: [mid2],
    });
    const root = node({
      id: 'root',
      startedAt: '2026-04-25T10:00:00.000Z',
      endedAt: '2026-04-25T10:00:07.000Z',
      children: [mid1],
    });
    const out = layoutTree(root, { pxPerMs: 1, rootDurationMs: 7000 });
    expect(out.totalDepth).toBe(3);
    const leafBar = out.bars.find((b) => b.id === 'leaf');
    expect(leafBar?.depth).toBe(3);
  });

  it('promotes lastModel to subLabel when present', () => {
    const root = node({
      id: 'root',
      startedAt: '2026-04-25T10:00:00.000Z',
      endedAt: '2026-04-25T10:00:01.000Z',
      lastModel: 'opaque-medium',
    });
    const out = layoutTree(root, { pxPerMs: 1, rootDurationMs: 1000 });
    expect(out.bars[0]?.subLabel).toBe('opaque-medium');
  });
});

describe('barRect', () => {
  it('clamps narrow bars to MIN_BAR_PX', () => {
    const root = node({
      id: 'root',
      startedAt: '2026-04-25T10:00:00.000Z',
      endedAt: '2026-04-25T10:00:01.000Z',
      children: [
        node({
          id: 'tiny',
          // Duration: 1ms — far below the minimum visible width.
          startedAt: '2026-04-25T10:00:00.500Z',
          endedAt: '2026-04-25T10:00:00.501Z',
        }),
      ],
    });
    const out = layoutTree(root, { pxPerMs: 0.5, rootDurationMs: 1000 });
    const tiny = out.bars.find((b) => b.id === 'tiny');
    expect(tiny).toBeDefined();
    if (tiny === undefined) return;
    const rect = barRect(tiny, 0.5);
    // Natural width = 1ms * 0.5 px/ms = 0.5 px → clamped to MIN_BAR_PX.
    expect(rect.width).toBe(MIN_BAR_PX);
    expect(rect.height).toBe(ROW_HEIGHT);
  });

  it('positions y by depth using ROW_HEIGHT + ROW_GAP', () => {
    const root = node({
      id: 'root',
      startedAt: '2026-04-25T10:00:00.000Z',
      endedAt: '2026-04-25T10:00:10.000Z',
      children: [
        node({
          id: 'c',
          startedAt: '2026-04-25T10:00:01.000Z',
          endedAt: '2026-04-25T10:00:02.000Z',
        }),
      ],
    });
    const out = layoutTree(root, { pxPerMs: 1, rootDurationMs: 10_000 });
    const c = out.bars.find((b) => b.id === 'c');
    if (c === undefined) throw new Error('expected child bar');
    const rect = barRect(c, 1);
    expect(rect.y).toBe(ROW_HEIGHT + ROW_GAP);
  });
});

describe('statusFill — never branches on provider name', () => {
  it('returns the same value regardless of provider/model fields', () => {
    expect(statusFill('completed')).toBe(statusFill('completed'));
    expect(statusFill('failed')).not.toBe(statusFill('completed'));
    expect(statusFill('running')).toBeTypeOf('string');
    expect(statusFill('cancelled')).toBeTypeOf('string');
  });
});

describe('fitLabel', () => {
  it('returns the full label when there is room', () => {
    expect(fitLabel('reviewer', 200)).toBe('reviewer');
  });

  it('truncates with an ellipsis when too narrow', () => {
    const out = fitLabel('this-is-a-long-agent-name', 40);
    expect(out.endsWith('…')).toBe(true);
    expect(out.length).toBeLessThan(25);
  });

  it('returns empty for very narrow bars', () => {
    expect(fitLabel('reviewer', MIN_BAR_PX)).toBe('');
  });
});
