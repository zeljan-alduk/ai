/**
 * EmptyState — illustrated placeholder for "nothing to show yet" states.
 *
 * Backward-compatible with the old `components/empty-state.tsx` API
 * (`{title, hint, action}`) so existing call-sites in /agents, /runs,
 * /eval, /models, /secrets keep rendering without churn. New optional
 * props that wave-12 + wave-13 surfaces use:
 *
 *   - `illustration` — slot for a decorative SVG above the title.
 *   - `description`  — alias for `hint` with a slightly looser tone.
 *   - `secondaryAction` — second CTA next to the primary action.
 *
 * Token-driven; dark mode just works.
 */

import { cn } from '@/lib/cn';
import type { ReactNode } from 'react';

export interface EmptyStateProps {
  /** Headline. Always required. */
  title: string;
  /** Short body copy below the title. Either `hint` or `description` works. */
  hint?: string;
  /** Alias for `hint`. */
  description?: string;
  /** Decorative illustration (SVG, icon, etc.) rendered above the title. */
  illustration?: ReactNode;
  /** Primary CTA — usually a `<Button>` or `<Link>`. */
  action?: ReactNode;
  /** Secondary CTA, rendered next to `action`. */
  secondaryAction?: ReactNode;
  className?: string;
}

export function EmptyState({
  title,
  hint,
  description,
  illustration,
  action,
  secondaryAction,
  className,
}: EmptyStateProps) {
  const body = description ?? hint;
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center rounded-lg border border-dashed border-border bg-bg-elevated px-6 py-12 text-center',
        className,
      )}
    >
      {illustration ? (
        <div className="mb-4 text-fg-faint" aria-hidden>
          {illustration}
        </div>
      ) : null}
      <p className="text-sm font-medium text-fg">{title}</p>
      {body ? <p className="mt-1 max-w-md text-sm text-fg-muted">{body}</p> : null}
      {action || secondaryAction ? (
        <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
          {action}
          {secondaryAction}
        </div>
      ) : null}
    </div>
  );
}
