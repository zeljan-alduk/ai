/**
 * /runs — Wave-13 trace search + saved views + bulk actions.
 *
 * The page is server-rendered and pulls its data from
 * `GET /v1/runs/search`. Filter state lives in the URL so saved
 * views, deep links, and back-button navigation all round-trip
 * deterministically; the search box, filter sheet, and saved-views
 * dropdown are the only client islands.
 *
 * Empty state for "no matches": offers the operator a one-click "save
 * this query as a view" path so dead-ends turn into shortcuts.
 *
 * LLM-agnostic: the row component displays the opaque
 * `lastProvider`/`lastModel` if present but never branches on a
 * specific provider name.
 */

import { EmptyState } from '@/components/empty-state';
import { ErrorView } from '@/components/error-boundary';
import { PageHeader } from '@/components/page-header';
import { RunsList } from '@/components/runs/runs-list';
import { RunsToolbar } from '@/components/runs/runs-toolbar';
import { parseRunSearchQuery, serializeRunSearchQuery } from '@/components/runs/search-query';
import { Card } from '@/components/ui/card';
import { listAgents, listSavedViews, searchRuns } from '@/lib/api';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

export default async function RunsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const query = parseRunSearchQuery(sp);

  let runs: Awaited<ReturnType<typeof searchRuns>> | null = null;
  let agents: Awaited<ReturnType<typeof listAgents>> | null = null;
  let views: Awaited<ReturnType<typeof listSavedViews>> | null = null;
  let error: unknown = null;
  try {
    [runs, agents, views] = await Promise.all([
      searchRuns({
        ...(query.q !== undefined ? { q: query.q } : {}),
        ...(query.status !== undefined ? { status: query.status } : {}),
        ...(query.agent !== undefined ? { agent: query.agent } : {}),
        ...(query.model !== undefined ? { model: query.model } : {}),
        ...(query.tag !== undefined ? { tag: query.tag } : {}),
        ...(query.cost_gte !== undefined ? { cost_gte: query.cost_gte } : {}),
        ...(query.cost_lte !== undefined ? { cost_lte: query.cost_lte } : {}),
        ...(query.duration_gte !== undefined ? { duration_gte: query.duration_gte } : {}),
        ...(query.duration_lte !== undefined ? { duration_lte: query.duration_lte } : {}),
        ...(query.started_after !== undefined ? { started_after: query.started_after } : {}),
        ...(query.started_before !== undefined ? { started_before: query.started_before } : {}),
        ...(query.has_children !== undefined ? { has_children: query.has_children } : {}),
        ...(query.has_failed_event !== undefined
          ? { has_failed_event: query.has_failed_event }
          : {}),
        ...(query.include_archived !== undefined
          ? { include_archived: query.include_archived }
          : {}),
        ...(query.cursor !== undefined ? { cursor: query.cursor } : {}),
        limit: 50,
      }),
      listAgents({ limit: 200 }),
      listSavedViews({ surface: 'runs' }),
    ]);
  } catch (err) {
    error = err;
  }

  return (
    <>
      <PageHeader
        title="Runs"
        description="Search, filter, save, and bulk-act on every agent execution."
      />
      {error ? (
        <ErrorView error={error} context="runs" />
      ) : runs && agents && views ? (
        <>
          <RunsToolbar
            agentNames={agents.agents.map((a) => a.name)}
            views={views.views}
            query={query}
            total={runs.total}
          />
          {runs.runs.length === 0 ? (
            runs.total === 0 && Object.keys(query).length === 0 ? (
              <EmptyRunsCard />
            ) : (
              <EmptyState
                title="No runs match"
                hint="Clear filters or save this query as a view to bookmark it."
              />
            )
          ) : (
            <RunsList runs={runs.runs} />
          )}
          <Pagination cursor={query.cursor} nextCursor={runs.nextCursor} current={query} />
        </>
      ) : null}
    </>
  );
}

function EmptyRunsCard() {
  // Wave-14C — richer empty state with two illustrated CTAs (playground
  // + sweep) so a fresh tenant has two obvious paths to a first run.
  return (
    <Card className="px-6 py-12 text-center">
      <div className="mx-auto flex h-22 w-22 items-center justify-center text-fg-faint" aria-hidden>
        {/* The 8 SVGs under /public/empty-states are the canonical wave-14C
            illustration set. We route the runs card to runs.svg. */}
        <img src="/empty-states/runs.svg" alt="" width={88} height={88} />
      </div>
      <h3 className="mt-4 text-base font-semibold text-fg">Your runs will appear here.</h3>
      <p className="mx-auto mt-1 max-w-md text-sm text-fg-muted">
        Try the playground for an ad-hoc prompt or kick off a sweep against a saved suite — every
        span, tool call, and replay shows up in this list.
      </p>
      <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
        <Link
          href="/playground"
          className="inline-flex items-center rounded bg-fg px-3 py-1.5 text-sm font-medium text-bg hover:bg-fg/90"
        >
          Open the playground →
        </Link>
        <Link
          href="/eval"
          className="inline-flex items-center rounded border border-border bg-bg-elevated px-3 py-1.5 text-sm font-medium text-fg hover:bg-bg-subtle"
        >
          Kick off a sweep →
        </Link>
      </div>
    </Card>
  );
}

function Pagination({
  cursor,
  nextCursor,
  current,
}: {
  cursor: string | undefined;
  nextCursor: string | null;
  current: import('@/components/runs/search-query').RunSearchQuery;
}) {
  const baseQs = serializeRunSearchQuery({ ...current, cursor: undefined });
  const nextHref = nextCursor
    ? `/runs?${(() => {
        const next = new URLSearchParams(baseQs);
        next.set('cursor', nextCursor);
        return next.toString();
      })()}`
    : null;
  const firstHref = `/runs${baseQs.toString().length > 0 ? `?${baseQs}` : ''}`;
  return (
    <div className="mt-4 flex items-center justify-end gap-2 text-sm">
      {cursor ? (
        <Link
          href={firstHref}
          className="rounded border border-border bg-bg-elevated px-3 py-1 hover:bg-bg-subtle"
        >
          First
        </Link>
      ) : null}
      {nextHref ? (
        <Link
          href={nextHref}
          className="rounded border border-border bg-bg-elevated px-3 py-1 hover:bg-bg-subtle"
        >
          Next
        </Link>
      ) : (
        <span className="text-fg-faint">end of list</span>
      )}
    </div>
  );
}
