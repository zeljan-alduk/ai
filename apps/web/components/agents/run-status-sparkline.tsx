/**
 * Sparkline that renders the last N runs as colored dots.
 *
 * Pure SVG, server-renderable. Each dot is colored by its run status:
 *
 *   - completed -> emerald
 *   - failed    -> red
 *   - running   -> sky
 *   - queued    -> slate
 *   - cancelled -> zinc
 *
 * Dots are emitted left-to-right, oldest first. Empty arrays render an
 * "—" hint. No client interactivity — the component is purely visual.
 *
 * LLM-agnostic: the run status is the platform's, never a provider id.
 */

import type { RunStatus } from '@aldo-ai/api-contract';

const COLOR: Record<RunStatus, string> = {
  completed: '#10b981', // emerald-500
  failed: '#ef4444', // red-500
  running: '#0ea5e9', // sky-500
  queued: '#94a3b8', // slate-400
  cancelled: '#71717a', // zinc-500
};

export interface RunStatusSparklineProps {
  /** Oldest first. Caller may pass any length; we cap at 10. */
  statuses: ReadonlyArray<RunStatus>;
  className?: string;
}

export function RunStatusSparkline({ statuses, className }: RunStatusSparklineProps) {
  const capped = statuses.slice(-10);
  if (capped.length === 0) {
    return <span className={className ?? 'text-xs text-slate-400'}>—</span>;
  }
  const dotSize = 10;
  const gap = 4;
  const width = capped.length * dotSize + (capped.length - 1) * gap;
  const height = dotSize;
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={`Last ${capped.length} run statuses: ${capped.join(', ')}`}
      className={className}
    >
      {capped.map((s, i) => {
        const cx = i * (dotSize + gap) + dotSize / 2;
        // Index + status forms a stable composite key for a position
        // in the oldest-first sequence — items don't move once the
        // sweep window slides.
        return (
          <circle
            key={`${i}-${s}`}
            cx={cx}
            cy={dotSize / 2}
            r={dotSize / 2 - 1}
            fill={COLOR[s]}
            stroke="rgba(15,23,42,0.1)"
            strokeWidth={0.5}
          />
        );
      })}
    </svg>
  );
}
