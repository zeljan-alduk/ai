'use client';

/**
 * ChartContainer — responsive wrapper for Recharts.
 *
 * Engineer T owns the actual chart components in wave-13; this just
 * provides the responsive sizing + a consistent surface (rounded
 * border, elevated bg, optional title row). T can drop a
 * `<ResponsiveContainer>` from `recharts` inside.
 *
 * Token-driven; dark mode flips automatically.
 */

import { cn } from '@/lib/cn';
import type { HTMLAttributes, ReactNode } from 'react';

export interface ChartContainerProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  /** Optional title rendered above the chart. */
  title?: ReactNode;
  /** Optional helper line under the title. */
  description?: ReactNode;
  /** Right-aligned action slot in the title row (legend toggle, etc.). */
  action?: ReactNode;
  /** Min height of the chart area in pixels. Default 240. */
  minHeight?: number;
}

export function ChartContainer({
  title,
  description,
  action,
  minHeight = 240,
  className,
  children,
  ...props
}: ChartContainerProps) {
  return (
    <div
      className={cn(
        'rounded-lg border border-border bg-bg-elevated p-4 text-fg shadow-sm',
        className,
      )}
      {...props}
    >
      {title || action ? (
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            {title ? <h3 className="text-sm font-semibold text-fg">{title}</h3> : null}
            {description ? <p className="mt-0.5 text-xs text-fg-muted">{description}</p> : null}
          </div>
          {action ? <div className="shrink-0">{action}</div> : null}
        </div>
      ) : null}
      <div className="w-full" style={{ minHeight }}>
        {children}
      </div>
    </div>
  );
}
