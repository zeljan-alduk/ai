'use client';

/**
 * Trace flame graph — pure SVG, semantic-token coloured.
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
 * Visual polish (frontend-iter — close the gap to the marketing
 * mockup): semantic Tailwind tokens for bar fills (works in dark
 * mode), subtle alternating lane backgrounds, time-axis ticks via
 * border tokens, status legend with counts at the bottom, hover +
 * selection states using ring tokens.
 *
 * LLM-agnostic: bars are coloured ONLY by status. The optional
 * `subLabel` (lastModel) is rendered as opaque text — never colour
 * coded by provider.
 */

import type { RunTreeNode } from '@aldo-ai/api-contract';
import { useMemo, useState } from 'react';
import {
  type FlameBar,
  type FlameStatus,
  ROW_GAP,
  ROW_HEIGHT,
  barRect,
  fitLabel,
  layoutTree,
  statusFill,
  statusLabel,
  statusSwatch,
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
const TICK_GUTTER = 28; // Px reserved above the bars for tick labels.

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

  // Status counts for the legend chip strip.
  const counts = useMemo(() => {
    const acc = new Map<FlameStatus, number>();
    for (const b of layout.bars) acc.set(b.status, (acc.get(b.status) ?? 0) + 1);
    // Stable display order: completed → running → failed → cancelled → queued → unknown.
    const order: FlameStatus[] = ['completed', 'running', 'failed', 'cancelled', 'queued', 'unknown'];
    return order
      .map((s) => ({ status: s, n: acc.get(s) ?? 0 }))
      .filter((c) => c.n > 0);
  }, [layout.bars]);

  const totalRows = layout.totalDepth + 1;

  return (
    // `max-w-full` clips the outer card to the viewport so the SVG below
    // scrolls horizontally inside it on mobile instead of busting the
    // page width. The SVG keeps a sensible minimum width so spans stay
    // legible even when scrolled.
    <div className="max-w-full overflow-hidden rounded-lg border border-border bg-bg-elevated">
      <div className="flex flex-col gap-1 border-b border-border px-3 py-2 text-fg-muted sm:flex-row sm:items-center sm:justify-between sm:px-4">
        <span className="font-mono text-[11px] uppercase tracking-wider">
          Trace · {layout.bars.length} span{layout.bars.length === 1 ? '' : 's'} · {totalRows} row
          {totalRows === 1 ? '' : 's'}
        </span>
        <span className="text-[11px] text-fg-faint">
          Click a bar for details · colour by status, never by provider
        </span>
      </div>
      <div className="overflow-x-auto">
        <svg
          role="img"
          aria-label="Trace flame graph"
          width={svgWidth}
          height={layout.totalHeightPx + TICK_GUTTER}
          viewBox={`0 0 ${svgWidth} ${layout.totalHeightPx + TICK_GUTTER}`}
          className="block text-fg"
        >
          <title>Trace flame graph</title>

          {/* Lane backgrounds — every other row gets a subtle stripe so
              the eye can track depth at a glance even on long traces. */}
          {Array.from({ length: totalRows }).map((_, depth) => {
            const rowY = TICK_GUTTER + depth * (ROW_HEIGHT + ROW_GAP);
            return (
              <rect
                key={`lane-${depth}`}
                x={0}
                y={rowY - 1}
                width={svgWidth}
                height={ROW_HEIGHT + ROW_GAP}
                className={depth % 2 === 0 ? 'fill-bg-subtle/40' : 'fill-bg/40'}
              />
            );
          })}

          {/* Time-axis ticks — vertical guide lines + numeric labels. */}
          <g>
            {ticks.map((t) => {
              const x = t.ms * pxPerMs;
              return (
                <g key={`tick-${t.ms}`}>
                  <line
                    x1={x}
                    x2={x}
                    y1={TICK_GUTTER - 6}
                    y2={layout.totalHeightPx + TICK_GUTTER}
                    className="stroke-border"
                    strokeWidth={1}
                  />
                  <text
                    x={x + 4}
                    y={12}
                    fontSize={10}
                    className="fill-fg-faint font-mono"
                  >
                    {t.label}
                  </text>
                </g>
              );
            })}
          </g>

          {/* Bars. */}
          <g transform={`translate(0, ${TICK_GUTTER})`}>
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

      {/* Status legend — chip strip with counts. Only renders statuses
          that actually appear in the trace. */}
      {counts.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 border-t border-border bg-bg-subtle/40 px-3 py-2 sm:px-4">
          {counts.map((c) => {
            const sw = statusSwatch(c.status);
            return (
              <div
                key={c.status}
                className="inline-flex items-center gap-1.5 font-mono text-[11px] text-fg-muted"
              >
                <span
                  aria-hidden
                  className={`inline-block h-2.5 w-2.5 rounded-sm ring-1 ${sw.bg} ${sw.ring}`}
                />
                <span>
                  {statusLabel(c.status)} · <span className="text-fg">{c.n}</span>
                </span>
              </div>
            );
          })}
          <span className="ml-auto font-mono text-[11px] text-fg-faint">
            tip: ←/→ to pan · click to inspect
          </span>
        </div>
      )}
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
  const fillClass = statusFill(bar.status);
  // For selection: heavier border (semantic accent). For hover: subtle
  // border (fg-muted). For idle: a hairline for crispness.
  const strokeClass = isSelected
    ? 'stroke-accent'
    : isHover
      ? 'stroke-fg-muted'
      : 'stroke-border';
  const strokeWidth = isSelected ? 2 : 1;
  const tooltip = `${bar.label} · ${bar.status} · ${bar.durationMs}ms${
    bar.subLabel !== undefined ? ` · ${bar.subLabel}` : ''
  }`;
  // For very narrow bars the sub-label has nowhere to go; we drop it.
  const showSubLabel =
    bar.subLabel !== undefined && rect.width >= bar.label.length * 7 + bar.subLabel.length * 6 + 18;
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
        className={`${fillClass} ${strokeClass}`}
        strokeWidth={strokeWidth}
        rx={4}
        ry={4}
        opacity={bar.status === 'running' ? 0.85 : 1}
      >
        {bar.status === 'running' ? (
          <animate
            attributeName="opacity"
            values="0.55;1;0.55"
            dur="1.6s"
            repeatCount="indefinite"
          />
        ) : null}
      </rect>
      {label !== '' ? (
        <text
          x={rect.x + 8}
          y={rect.y + ROW_HEIGHT / 2}
          dy="0.35em"
          fontSize={11}
          fill="white"
          style={{
            pointerEvents: 'none',
            fontFamily: 'ui-sans-serif, system-ui, sans-serif',
            fontWeight: 500,
          }}
        >
          {label}
        </text>
      ) : null}
      {showSubLabel && bar.subLabel !== undefined ? (
        <text
          x={rect.x + rect.width - 8}
          y={rect.y + ROW_HEIGHT / 2}
          dy="0.35em"
          fontSize={10}
          textAnchor="end"
          fill="white"
          opacity={0.75}
          style={{
            pointerEvents: 'none',
            fontFamily: 'ui-monospace, SFMono-Regular, monospace',
          }}
        >
          {bar.subLabel}
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
