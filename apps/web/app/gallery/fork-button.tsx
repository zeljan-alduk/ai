'use client';

/**
 * `<ForkButton />` — wave-3 per-template fork action for the gallery.
 *
 * Rendered inline on every gallery card. When the operator has only the
 * Default project (or hasn't picked one yet) the trigger is a single
 * primary button; once they've picked a project via the sidebar
 * `<ProjectPicker />`, the same trigger becomes a dropdown that lets
 * them re-target a fork to any of their projects without leaving the
 * gallery.
 *
 * After a successful fork the component flashes a status banner with a
 * link straight to the newly-forked agent's detail page (`/agents/<n>`).
 * The banner stays until the operator dismisses it, so they can copy
 * the resolved name + version (the server may have suffixed `-2` to
 * resolve a slug collision).
 *
 * Calls go through `/api/auth-proxy/v1/gallery/fork` so the HTTP-only
 * session cookie never leaves the server. Errors come back as the
 * standard `{ error: { code, message } }` envelope; we surface
 * `template_not_found` and `not_found` (project missing) inline so the
 * operator can pick a different destination instead of staring at a
 * blank toast.
 *
 * LLM-agnostic: forks an AgentSpec; never names a provider.
 */

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useCurrentProject } from '@/lib/use-current-project';
import type { GalleryForkResponse, Project } from '@aldo-ai/api-contract';
import { Check, ChevronDown, GitFork, X } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';

interface ForkButtonProps {
  readonly templateId: string;
}

type ForkState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'forking'; readonly toSlug: string | null }
  | { readonly kind: 'ok'; readonly result: GalleryForkResponse }
  | { readonly kind: 'error'; readonly message: string };

interface ApiErrorBody {
  readonly error?: { readonly code?: string; readonly message?: string };
}

export function ForkButton({ templateId }: ForkButtonProps) {
  const router = useRouter();
  const { projectSlug, hydrated } = useCurrentProject();
  const [projects, setProjects] = useState<ReadonlyArray<Project> | null>(null);
  const [state, setState] = useState<ForkState>({ kind: 'idle' });
  // Auto-clear the success banner after 8 seconds so the page doesn't
  // accumulate stale fork notices when the operator forks a few in a
  // row. The user can still click the in-banner "View" link before it
  // fades — the link is the same one we'd surface in a toast.
  const fadeRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (state.kind !== 'ok') return;
    if (fadeRef.current !== null) clearTimeout(fadeRef.current);
    fadeRef.current = setTimeout(() => setState({ kind: 'idle' }), 8_000);
    return () => {
      if (fadeRef.current !== null) clearTimeout(fadeRef.current);
    };
  }, [state]);

  // Lazy-load the project list — only when the dropdown opens.
  // Most operators never use the override; we don't want to spend a
  // /v1/projects round trip on every gallery page view.
  const ensureProjects = useCallback(async () => {
    if (projects !== null) return;
    try {
      const res = await fetch('/api/auth-proxy/v1/projects', {
        method: 'GET',
        headers: { accept: 'application/json' },
      });
      if (!res.ok) return;
      const body = (await res.json()) as { projects?: ReadonlyArray<Project> };
      setProjects(body.projects ?? []);
    } catch {
      /* best-effort: a failure leaves the menu in single-button mode */
    }
  }, [projects]);

  const fork = useCallback(
    async (overrideSlug: string | null) => {
      setState({ kind: 'forking', toSlug: overrideSlug });
      // The route resolves a missing projectSlug to the tenant's
      // Default project. We pass the picker's slug verbatim when set,
      // and let the override (a dropdown click) take precedence.
      const targetSlug = overrideSlug ?? projectSlug ?? null;
      const body: Record<string, string> = { templateId };
      if (targetSlug !== null) body.projectSlug = targetSlug;
      try {
        const res = await fetch('/api/auth-proxy/v1/gallery/fork', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          const errBody = (await res.json().catch(() => ({}))) as ApiErrorBody;
          const code = errBody.error?.code ?? 'unknown';
          const message = errBody.error?.message ?? `Fork failed (${res.status})`;
          setState({
            kind: 'error',
            message: code === 'unknown' ? message : `${code}: ${message}`,
          });
          return;
        }
        const result = (await res.json()) as GalleryForkResponse;
        setState({ kind: 'ok', result });
        // Refresh server components so /agents picks up the new row
        // when the operator navigates over.
        router.refresh();
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Network error while forking template';
        setState({ kind: 'error', message });
      }
    },
    [projectSlug, router, templateId],
  );

  const isBusy = state.kind === 'forking';
  // Per-card label tells the operator where the fork will land. Before
  // hydration we just say "into project" — same string SSR + first
  // client paint, no flicker.
  const targetLabel = hydrated && projectSlug !== null ? `to ${projectSlug}` : 'into project';

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-1">
        <Button
          type="button"
          size="sm"
          onClick={() => void fork(null)}
          disabled={isBusy}
          aria-label={`Fork ${templateId} into project`}
          data-testid={`gallery-fork-${templateId}`}
        >
          <GitFork aria-hidden className="mr-1.5 h-3.5 w-3.5" />
          {isBusy ? 'Forking…' : `Fork ${targetLabel}`}
        </Button>
        <DropdownMenu
          onOpenChange={(open) => {
            if (open) void ensureProjects();
          }}
        >
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={isBusy}
              aria-label={`Pick destination project for ${templateId}`}
              data-testid={`gallery-fork-pick-${templateId}`}
              className="px-2"
            >
              <ChevronDown aria-hidden className="h-3.5 w-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-[200px]">
            <DropdownMenuLabel>Fork into project…</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {projects === null ? (
              <DropdownMenuItem disabled>
                <span className="pl-6 text-fg-muted">Loading…</span>
              </DropdownMenuItem>
            ) : projects.length === 0 ? (
              <DropdownMenuItem disabled>
                <span className="pl-6 text-fg-muted">No projects available</span>
              </DropdownMenuItem>
            ) : (
              projects
                .filter((p) => p.archivedAt === null)
                .map((p) => {
                  const active = projectSlug === p.slug;
                  return (
                    <DropdownMenuItem
                      key={p.id}
                      onSelect={(e) => {
                        e.preventDefault();
                        void fork(p.slug);
                      }}
                      data-testid={`gallery-fork-pick-${templateId}-${p.slug}`}
                    >
                      <span
                        aria-hidden
                        className="mr-2 inline-flex h-3.5 w-3.5 items-center justify-center"
                      >
                        {active ? <Check className="h-3 w-3 text-fg" /> : null}
                      </span>
                      <span className="flex-1 truncate text-fg" title={p.name}>
                        {p.name}
                      </span>
                      <span className="ml-2 truncate font-mono text-[10px] text-fg-muted">
                        {p.slug}
                      </span>
                    </DropdownMenuItem>
                  );
                })
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {state.kind === 'ok' ? (
        <ForkBanner
          tone="success"
          message={
            <>
              Forked to <code className="font-mono">{state.result.projectSlug}</code> as{' '}
              <Link
                href={`/agents/${encodeURIComponent(state.result.agentName)}`}
                className="font-medium underline-offset-2 hover:underline"
                data-testid={`gallery-fork-link-${templateId}`}
              >
                {state.result.agentName}
              </Link>
              .
            </>
          }
          onDismiss={() => setState({ kind: 'idle' })}
        />
      ) : null}
      {state.kind === 'error' ? (
        <ForkBanner
          tone="error"
          message={state.message}
          onDismiss={() => setState({ kind: 'idle' })}
        />
      ) : null}
    </div>
  );
}

interface ForkBannerProps {
  readonly tone: 'success' | 'error';
  readonly message: React.ReactNode;
  readonly onDismiss: () => void;
}

function ForkBanner({ tone, message, onDismiss }: ForkBannerProps) {
  // Token-driven tones — never hardcoded slate-*. Success uses the
  // success token (mapped to a green in the design-token system);
  // error uses the danger token. Both pair with a 30%-alpha border for
  // that subtle ALDO inset look.
  const cls =
    tone === 'success'
      ? 'border-success/30 bg-success/10 text-success'
      : 'border-danger/30 bg-danger/10 text-danger';
  return (
    // <output> carries an implicit `role="status" aria-live="polite"`,
    // so screen readers announce the success/error message without us
    // needing to re-state the role.
    <output
      className={`flex items-start justify-between gap-2 rounded-md border px-3 py-2 text-xs ${cls}`}
      data-testid={tone === 'success' ? 'gallery-fork-success' : 'gallery-fork-error'}
    >
      <span>{message}</span>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        className="-mr-1 -mt-1 shrink-0 rounded p-0.5 opacity-70 transition-opacity hover:opacity-100"
      >
        <X aria-hidden className="h-3.5 w-3.5" />
      </button>
    </output>
  );
}
