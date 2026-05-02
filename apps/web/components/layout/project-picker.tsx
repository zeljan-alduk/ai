'use client';

/**
 * Wave-17 (Tier 2.5) — `<ProjectPicker />`.
 *
 * Sidebar-mounted dropdown that lets the operator scope the
 * authenticated surface to one project (or "All projects"). Reads /
 * writes the selected slug via {@link useCurrentProject}; the URL
 * `?project=<slug>` is the source-of-truth, with localStorage as the
 * cross-route fallback.
 *
 * The component is purely client-side. Projects are fetched via
 * `listProjects()` once on mount; subsequent mounts get a cached list
 * for the lifetime of the page (project creation routes through
 * `router.refresh()` inside the create dialog and re-renders this
 * subtree along with everything else).
 *
 * LLM-agnostic: no provider concerns at the picker layer.
 */

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ApiClientError, listProjects } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useCurrentProject } from '@/lib/use-current-project';
import type { Project } from '@aldo-ai/api-contract';
import { Check, ChevronsUpDown, FolderPlus } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';

export const ALL_PROJECTS_LABEL = 'All projects';

export interface ProjectPickerProps {
  /**
   * Optional pre-fetched list (from a server component). Skips the
   * client-side fetch entirely. Used by tests + SSR-friendly mounts.
   */
  readonly projects?: ReadonlyArray<Project>;
  /** Optional className passthrough for the trigger button wrapper. */
  readonly className?: string;
  /** Called whenever a project is picked — used to dismiss mobile drawers. */
  readonly onPicked?: () => void;
}

type LoadState =
  | { kind: 'loading' }
  | { kind: 'ok'; projects: ReadonlyArray<Project> }
  | { kind: 'error'; message: string };

export function ProjectPicker({ projects, className, onPicked }: ProjectPickerProps) {
  const { projectSlug, setProject } = useCurrentProject();
  const [state, setState] = useState<LoadState>(() =>
    projects !== undefined ? { kind: 'ok', projects } : { kind: 'loading' },
  );

  // One-shot fetch on mount when the parent didn't pre-load. The
  // dependency-array is intentionally empty: we don't want a re-fetch
  // if the parent later passes a new projects array (it doesn't, in
  // practice — the sidebar mounts the picker without props).
  // biome-ignore lint/correctness/useExhaustiveDependencies: one-shot fetch on mount; `projects` prop is mount-time only by contract.
  useEffect(() => {
    if (projects !== undefined) {
      setState({ kind: 'ok', projects });
      return;
    }
    let cancelled = false;
    listProjects()
      .then((res) => {
        if (cancelled) return;
        setState({ kind: 'ok', projects: res.projects });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const msg =
          err instanceof ApiClientError
            ? err.message
            : err instanceof Error
              ? err.message
              : 'Failed to load projects';
        setState({ kind: 'error', message: msg });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const activeProjects = useMemo<ReadonlyArray<Project>>(() => {
    if (state.kind !== 'ok') return [];
    // Hide archived in the picker even if listProjects ever starts
    // returning them — operators want a clean menu.
    return state.projects.filter((p) => p.archivedAt === null);
  }, [state]);

  const currentProject = useMemo(
    () => activeProjects.find((p) => p.slug === projectSlug) ?? null,
    [activeProjects, projectSlug],
  );

  const triggerLabel = currentProject?.name ?? ALL_PROJECTS_LABEL;
  const triggerSlug = currentProject?.slug ?? null;

  function pick(slug: string | null) {
    setProject(slug);
    onPicked?.();
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            'group flex w-full items-center justify-between gap-2 rounded-md border border-border bg-bg px-2 py-1.5 text-left text-sm font-normal transition-colors hover:bg-bg-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg',
            className,
          )}
          aria-label={`Project picker — ${triggerLabel}`}
          data-testid="project-picker-trigger"
        >
          <span className="flex min-w-0 flex-col text-left">
            <span className="text-[10px] uppercase tracking-wider text-fg-muted">Project</span>
            <span className="truncate text-fg" title={triggerLabel}>
              {triggerLabel}
            </span>
            {triggerSlug !== null ? (
              <span className="truncate font-mono text-[10px] text-fg-muted" title={triggerSlug}>
                {triggerSlug}
              </span>
            ) : null}
          </span>
          <ChevronsUpDown
            className="h-4 w-4 shrink-0 text-fg-muted group-hover:text-fg"
            aria-hidden
          />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="min-w-[220px]"
        data-testid="project-picker-menu"
      >
        <DropdownMenuLabel>Switch project</DropdownMenuLabel>
        <DropdownMenuItem
          onSelect={(e) => {
            e.preventDefault();
            pick(null);
          }}
          aria-current={projectSlug === null ? 'true' : undefined}
          data-testid="project-picker-item-all"
        >
          <PickerCheck active={projectSlug === null} />
          <span className="flex-1 text-fg">{ALL_PROJECTS_LABEL}</span>
        </DropdownMenuItem>

        {state.kind === 'loading' ? (
          <DropdownMenuItem disabled>
            <span className="pl-6 text-fg-muted">Loading…</span>
          </DropdownMenuItem>
        ) : null}

        {state.kind === 'error' ? (
          <DropdownMenuItem disabled>
            <span className="pl-6 text-fg-muted" title={state.message}>
              Couldn't load projects
            </span>
          </DropdownMenuItem>
        ) : null}

        {activeProjects.length > 0 ? <DropdownMenuSeparator /> : null}

        {activeProjects.map((p) => {
          const active = p.slug === projectSlug;
          return (
            <DropdownMenuItem
              key={p.id}
              onSelect={(e) => {
                e.preventDefault();
                pick(p.slug);
              }}
              aria-current={active ? 'true' : undefined}
              data-testid={`project-picker-item-${p.slug}`}
            >
              <PickerCheck active={active} />
              <span className="flex-1 truncate text-fg" title={p.name}>
                {p.name}
              </span>
              <span className="ml-2 truncate font-mono text-[10px] text-fg-muted">{p.slug}</span>
            </DropdownMenuItem>
          );
        })}

        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link
            href="/projects"
            className="flex w-full cursor-pointer items-center gap-2 text-fg"
            onClick={() => onPicked?.()}
            data-testid="project-picker-create-link"
          >
            <FolderPlus className="h-4 w-4 shrink-0 text-fg-muted" aria-hidden />
            <span>Create new project…</span>
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Inline check mark. We render the icon at fixed width so the items
 * align whether or not they're selected — looks the same as a Radix
 * radio menu without forcing one selection at a time.
 */
function PickerCheck({ active }: { active: boolean }) {
  return (
    <span aria-hidden className="inline-flex h-4 w-4 items-center justify-center">
      {active ? <Check className="h-3.5 w-3.5 text-fg" /> : null}
    </span>
  );
}
