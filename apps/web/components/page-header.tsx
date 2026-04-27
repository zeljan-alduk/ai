import type { ReactNode } from 'react';

/**
 * PageHeader — the title bar that sits at the top of every protected
 * page. Wave-15E mobile responsiveness: actions wrap below the title
 * on narrow widths and use a flex-wrap so multi-button rows don't
 * blow past the viewport. The description bumps up to `text-sm` /
 * `text-fg-muted` (slate-600) for WCAG-AA contrast.
 */
export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-col gap-3 border-b border-border pb-4 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight text-fg sm:text-2xl">{title}</h1>
        <p className="mt-1 text-sm text-fg-muted">{description}</p>
      </div>
      {actions ? (
        <div className="flex flex-wrap items-center gap-2 sm:shrink-0">{actions}</div>
      ) : null}
    </div>
  );
}
