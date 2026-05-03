/**
 * Pure layout calculations for the trace flame graph.
 *
 * Lifted out of the React component so we can unit-test the math
 * without dragging jsdom in. Every function here is a deterministic
 * map from inputs to numbers — given a fixture tree the assertions
 * pin geometry to within rounding.
 *
 * Coordinate system:
 *   - x = milliseconds since the root's startedAt
 *   - y = depth (rows of `ROW_HEIGHT` px each)
 *   - width = duration in ms
 *
 * The component scales x and width by `pxPerMs` to fit a target SVG
 * width. Callers compute `pxPerMs = svgWidth / rootDurationMs` and
 * pass it to `layoutTree`.
 *
 * LLM-agnostic: the layout never inspects model id or provider.
 */

import type { RunTreeNode } from '@aldo-ai/api-contract';

export const ROW_HEIGHT = 24;
export const ROW_GAP = 2;
export const MIN_BAR_PX = 4;

export type FlameStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'unknown';

export interface FlameBar {
  /** Stable identity for React keys + click callbacks. */
  readonly id: string;
  readonly label: string;
  /** ms-from-root start. */
  readonly startMs: number;
  /** ms-from-root end. */
  readonly endMs: number;
  readonly durationMs: number;
  /** 0-indexed row from the top. */
  readonly depth: number;
  readonly status: FlameStatus;
  /** Optional secondary label (e.g. tool name); rendered when there's room. */
  readonly subLabel?: string;
  /** Original node — handed back to click callbacks so the parent can open
   *  the side-panel without juggling lookup tables. */
  readonly node: RunTreeNode;
}

export interface FlameGraphInput {
  /** Pixels per millisecond used to scale x. Set to 1 to layout in ms. */
  readonly pxPerMs: number;
  /** Total duration the parent measured for the root. Used as a fallback
   *  when a node has a null endedAt (still running). */
  readonly rootDurationMs: number;
}

export interface FlameGraphOutput {
  readonly bars: readonly FlameBar[];
  readonly totalDepth: number;
  /** Total width in px (includes the trailing tail). */
  readonly totalWidthPx: number;
  /** Total height in px (depth * (ROW_HEIGHT + ROW_GAP)). */
  readonly totalHeightPx: number;
}

/**
 * Walk the run tree and produce a flat list of `FlameBar`s with
 * absolute-from-root coordinates. The function is pure — same input,
 * same output, no Date.now() or Math.random().
 */
export function layoutTree(root: RunTreeNode, input: FlameGraphInput): FlameGraphOutput {
  const rootStartMs = Date.parse(root.startedAt);
  const bars: FlameBar[] = [];
  let maxDepth = 0;

  function visit(node: RunTreeNode, depth: number): void {
    if (depth > maxDepth) maxDepth = depth;
    const startMs = Math.max(0, Date.parse(node.startedAt) - rootStartMs);
    const endMs =
      node.endedAt !== null
        ? Math.max(startMs, Date.parse(node.endedAt) - rootStartMs)
        : Math.max(startMs, input.rootDurationMs);
    const durationMs = Math.max(0, endMs - startMs);
    bars.push({
      id: node.runId,
      label: node.agentName,
      startMs,
      endMs,
      durationMs,
      depth,
      status: normaliseStatus(node.status),
      ...(node.lastModel !== null ? { subLabel: node.lastModel } : {}),
      node,
    });
    for (const child of node.children) visit(child, depth + 1);
  }
  visit(root, 0);

  // Stable sort: depth ASC, then start ASC. Keeps siblings left-to-right.
  bars.sort((a, b) => {
    if (a.depth !== b.depth) return a.depth - b.depth;
    if (a.startMs !== b.startMs) return a.startMs - b.startMs;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  const totalWidthPx = Math.max(1, input.rootDurationMs * input.pxPerMs);
  const totalHeightPx = (maxDepth + 1) * (ROW_HEIGHT + ROW_GAP);

  return {
    bars,
    totalDepth: maxDepth,
    totalWidthPx,
    totalHeightPx,
  };
}

/**
 * Compute the on-screen rectangle for a single bar, applying the
 * MIN_BAR_PX clamp. Bars narrower than the clamp are widened to the
 * clamp so they remain visible (a tool call that took 2ms is still a
 * meaningful tick on a multi-second trace).
 */
export function barRect(
  bar: FlameBar,
  pxPerMs: number,
): { readonly x: number; readonly y: number; readonly width: number; readonly height: number } {
  const x = bar.startMs * pxPerMs;
  const naturalWidth = bar.durationMs * pxPerMs;
  const width = Math.max(MIN_BAR_PX, naturalWidth);
  const y = bar.depth * (ROW_HEIGHT + ROW_GAP);
  return { x, y, width, height: ROW_HEIGHT };
}

/**
 * Pick the fill colour for a bar by status. Returns a Tailwind className
 * targeting the semantic token system (works in light + dark mode without
 * a theme switch). The component applies the class to the SVG <rect>.
 *
 * NOTE: never colours by provider name. Status is the only signal.
 */
export function statusFill(status: FlameStatus): string {
  switch (status) {
    case 'completed':
      return 'fill-accent';
    case 'running':
      return 'fill-accent';
    case 'failed':
      return 'fill-danger';
    case 'cancelled':
      return 'fill-fg-muted';
    case 'queued':
      return 'fill-fg-muted/40';
    default:
      return 'fill-fg-muted/30';
  }
}

/** Human-readable label for legends + a11y text. */
export function statusLabel(status: FlameStatus): string {
  switch (status) {
    case 'completed':
      return 'completed';
    case 'running':
      return 'running';
    case 'failed':
      return 'failed';
    case 'cancelled':
      return 'cancelled';
    case 'queued':
      return 'queued';
    default:
      return 'unknown';
  }
}

/** Bg/text pair for the legend swatch chip (CSS-class form). */
export function statusSwatch(status: FlameStatus): { bg: string; ring: string } {
  switch (status) {
    case 'completed':
    case 'running':
      return { bg: 'bg-accent', ring: 'ring-accent/30' };
    case 'failed':
      return { bg: 'bg-danger', ring: 'ring-danger/30' };
    case 'cancelled':
      return { bg: 'bg-fg-muted', ring: 'ring-fg-muted/30' };
    case 'queued':
      return { bg: 'bg-fg-muted/40', ring: 'ring-fg-muted/20' };
    default:
      return { bg: 'bg-fg-muted/30', ring: 'ring-fg-muted/15' };
  }
}

function normaliseStatus(s: RunTreeNode['status']): FlameStatus {
  switch (s) {
    case 'queued':
    case 'running':
    case 'completed':
    case 'failed':
    case 'cancelled':
      return s;
    default:
      return 'unknown';
  }
}

/**
 * Truncate a label so it fits in `widthPx` using a 7px-per-char
 * heuristic. Short bars get an ellipsis; very narrow bars (≤ MIN_BAR_PX
 * × 3) get no label at all so the SVG stays legible.
 */
export function fitLabel(label: string, widthPx: number): string {
  if (widthPx < MIN_BAR_PX * 3) return '';
  const charBudget = Math.max(1, Math.floor((widthPx - 4) / 7));
  if (label.length <= charBudget) return label;
  if (charBudget <= 1) return '…';
  return `${label.slice(0, charBudget - 1)}…`;
}
