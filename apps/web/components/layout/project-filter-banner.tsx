/**
 * Wave-17 (Tier 2.5) — small inline banner shown above list pages
 * (agents, runs) when a `?project=<slug>` filter is active.
 *
 * Tells the operator why fewer rows than expected appear and gives
 * them a one-click "show all" path that strips the query param.
 *
 * Server-component-friendly — no event handlers; the "show all" link
 * is a plain anchor that drops the `project` param. The
 * `ProjectPicker` in the sidebar mirrors the choice into localStorage
 * on the next mount.
 *
 * LLM-agnostic: pure structural component.
 */

import Link from 'next/link';

export interface ProjectFilterBannerProps {
  /** Slug of the active project filter. */
  readonly projectSlug: string;
  /**
   * Pre-resolved display name. Falls back to the slug when the caller
   * hasn't fetched the project record (e.g. on the server before the
   * pickers list endpoint completes). Explicitly allows `undefined`
   * so callers that conditionally resolve it can pass through the
   * `string | undefined` shape without juggling spread.
   */
  readonly projectName?: string | undefined;
  /**
   * The pathname the "show all" link should target. Defaults to the
   * current pathname; callers always pass it because server
   * components don't have access to the location.
   */
  readonly clearHref: string;
  /** What this list shows — "agents", "runs", … — used in the copy. */
  readonly entityNoun: string;
}

export function ProjectFilterBanner({
  projectSlug,
  projectName,
  clearHref,
  entityNoun,
}: ProjectFilterBannerProps) {
  const label = projectName ?? projectSlug;
  return (
    <output
      data-testid="project-filter-banner"
      className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-border bg-bg-elevated px-3 py-2 text-xs text-fg-muted"
    >
      <span className="text-fg">
        Showing {entityNoun} in project <span className="font-semibold">{label}</span>
      </span>
      <span className="font-mono text-[10px] text-fg-muted">{projectSlug}</span>
      <Link
        href={clearHref}
        className="ml-auto rounded text-fg underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        data-testid="project-filter-clear"
      >
        Show all projects
      </Link>
    </output>
  );
}
