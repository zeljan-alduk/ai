'use client';

/**
 * Trace flame graph — pure SVG, no canvas.
 *
 * Why SVG: each bar is a real DOM node, so it's selectable, accessible
 * (role="button" + keyboard focus), and survives copy-paste into a bug
 * report screenshot. Canvas would be denser pixel-wise but worse for
 * every other axis we care about.
 *
 * Layout math lives in `flame-graph-layout.ts` so the geometry can be
 * unit-tested without dragging jsdom in. This file is a thin React
 * shell over that.
 *
 * LLM-agnostic: bars are coloured ONLY by status. The optional
 * `subLabel` (lastModel) is rendered as opaque text — never colour
 * coded by provider.
 */

import type { RunTreeNode } from '@aldo-ai/api-contract';
import { useMemo, useState } from 'react';
import {
  type FlameBar,
  ROW_GAP,
  ROW_HEIGHT,
  barRect,
  fitLabel,
  layoutTree,
  statusFill,
} from './flame-graph-layout';

export interface FlameGraphProps {
  readonly tree: RunTreeNode;
  /** Overall pixel width to fit. Falls back to 960 when 0/undefined. */
  readonly width?: number;
  /** Click handler — receives the original RunTreeNode so the parent can
   *  open a side-panel without doing a separate lookup. */
  readonly onSelect?: (node: RunTreeNode) => void;
  /** Optional id of the currently selected bar — outlined in the SVG. */
  readonly selectedRunId?: string | null;
}

const DEFAULT_WIDTH = 960;
const MIN_DURATION_MS = 1; // Avoid div-by-zero when a fresh root has no end yet.

export function FlameGraph({
  tree,
  width = DEFAULT_WIDTH,
  onSelect,
  selectedRunId = null,
}: FlameGraphProps) {
  const svgWidth = width > 0 ? width : DEFAULT_WIDTH;

  const layout = useMemo(() => {
    const rootStart = Date.parse(tree.startedAt);
    const rootEnd =
      tree.endedAt !== null ? Date.parse(tree.endedAt) : maxEndAcrossTree(tree, rootStart);
    const rootDurationMs = Math.max(MIN_DURATION_MS, rootEnd - rootStart);
    const pxPerMs = svgWidth / rootDurationMs;
    return layoutTree(tree, { pxPerMs, rootDurationMs });
  }, [tree, svgWidth]);

  const pxPerMs = layout.totalWidthPx / Math.max(MIN_DURATION_MS, durationOfRoot(tree));

  // Hover state stays local — opening the side panel is the parent's job.
  const [hoverId, setHoverId] = useState<string | null>(null);

  const ticks = makeTicks(durationOfRoot(tree));

  return (
    // Wave-15E — `max-w-full` clips the outer card to the viewport so
    // the SVG below scrolls horizontally inside it on mobile instead
    // of busting the page width. The SVG keeps a sensible minimum
    // width so spans stay legible even when scrolled.
    <div className="max-w-full overflow-x-auto rounded-md border border-border bg-bg-elevated">
      <div className="flex flex-col gap-1 border-b border-border px-3 py-2 sm:flex-row sm:items-center sm:justify-between sm:px-4">
        <span className="text-[11px] uppercase tracking-wider text-fg-muted">
          Trace · {layout.bars.length} span{layout.bars.length === 1 ? '' : 's'}
        </span>
        <span className="text-[11px] text-fg-faint">
          Click a bar for details · colour by status, never provider
        </span>
      </div>
      <svg
        role="img"
        aria-label="Trace flame graph"
        width={svgWidth}
        height={layout.totalHeightPx + 28}
        viewBox={`0 0 ${svgWidth} ${layout.totalHeightPx + 28}`}
        className="block"
      >
        <title>Trace flame graph</title>
        <g transform="translate(0, 24)">
          {/* Tick lines */}
          {ticks.map((t) => (
            <g key={`tick-${t.ms}`}>
              <line
                x1={t.ms * pxPerMs}
                x2={t.ms * pxPerMs}
                y1={-18}
                y2={layout.totalHeightPx}
                stroke="#e2e8f0"
                strokeWidth={1}
              />
              <text x={t.ms * pxPerMs + 4} y={-6} fontSize={10} fill="#94a3b8">
                {t.label}
              </text>
            </g>
          ))}
          {layout.bars.map((bar) => (
            <BarView
              key={bar.id}
              bar={bar}
              pxPerMs={pxPerMs}
              isHover={hoverId === bar.id}
              isSelected={selectedRunId === bar.id}
              onMouseEnter={() => setHoverId(bar.id)}
              onMouseLeave={() => setHoverId(null)}
              onClick={() => onSelect?.(bar.node)}
            />
          ))}
        </g>
      </svg>
    </div>
  );
}

function BarView({
  bar,
  pxPerMs,
  isHover,
  isSelected,
  onMouseEnter,
  onMouseLeave,
  onClick,
}: {
  bar: FlameBar;
  pxPerMs: number;
  isHover: boolean;
  isSelected: boolean;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  onClick: () => void;
}) {
  const rect = barRect(bar, pxPerMs);
  const label = fitLabel(bar.label, rect.width);
  const fill = statusFill(bar.status);
  const stroke = isSelected ? '#0f172a' : isHover ? '#1e293b' : '#ffffff';
  const strokeWidth = isSelected ? 2 : 1;
  const tooltip = `${bar.label} · ${bar.status} · ${bar.durationMs}ms${
    bar.subLabel !== undefined ? ` · ${bar.subLabel}` : ''
  }`;
  return (
    // biome-ignore lint/a11y/useSemanticElements: SVG <g> can't be a real <button>; we provide role + tabIndex + Enter/Space handlers manually
    <g
      role="button"
      tabIndex={0}
      aria-label={tooltip}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
      style={{ cursor: 'pointer' }}
    >
      <rect
        x={rect.x}
        y={rect.y}
        width={rect.width}
        height={rect.height}
        fill={fill}
        stroke={stroke}
        strokeWidth={strokeWidth}
        rx={3}
        ry={3}
        opacity={bar.status === 'running' ? 0.7 : 1}
      >
        {bar.status === 'running' ? (
          <animate attributeName="opacity" values="0.5;1;0.5" dur="1.6s" repeatCount="indefinite" />
        ) : null}
      </rect>
      {label !== '' ? (
        <text
          x={rect.x + 6}
          y={rect.y + ROW_HEIGHT / 2}
          dy="0.35em"
          fontSize={11}
          fill="#ffffff"
          style={{ pointerEvents: 'none', fontFamily: 'system-ui, sans-serif' }}
        >
          {label}
        </text>
      ) : null}
      <title>{tooltip}</title>
    </g>
  );
}

function durationOfRoot(tree: RunTreeNode): number {
  const start = Date.parse(tree.startedAt);
  const end = tree.endedAt !== null ? Date.parse(tree.endedAt) : maxEndAcrossTree(tree, start);
  return Math.max(MIN_DURATION_MS, end - start);
}

/** When the root is still in flight, fall back to the largest endedAt
 *  in the descendant tree (or "now" — but we avoid Date.now() so the
 *  layout stays referentially transparent). */
function maxEndAcrossTree(node: RunTreeNode, fallback: number): number {
  let best = node.endedAt !== null ? Date.parse(node.endedAt) : fallback;
  for (const c of node.children) {
    const childBest = maxEndAcrossTree(c, fallback);
    if (childBest > best) best = childBest;
  }
  return best;
}

/** Round-numbered tick stops (5 ticks total) for the time axis. */
function makeTicks(durationMs: number): ReadonlyArray<{ ms: number; label: string }> {
  const stepCount = 5;
  const out: { ms: number; label: string }[] = [];
  for (let i = 0; i <= stepCount; i++) {
    const ms = (durationMs * i) / stepCount;
    out.push({ ms, label: formatMs(ms) });
  }
  return out;
}

function formatMs(ms: number): string {
  if (ms < 1) return '0ms';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(s < 10 ? 1 : 0)}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${Math.round(s - m * 60)}s`;
}

void ROW_GAP; // silence unused-import
