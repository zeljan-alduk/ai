/**
 * /threads — wave-19 (Backend + Frontend Engineer).
 *
 * Lists every distinct conversation grouping (`thread_id`) the runs
 * table has accumulated. A "thread" is a derived concept — see
 * migration 026 for the column + threads-store.ts for the GROUP BY.
 *
 * Server-component first: this page owns the data fetch and renders
 * static markup; pagination is link-based so back/forward and saved
 * URLs round-trip deterministically.
 *
 * LLM-agnostic: rows display opaque agent-name strings only.
 */

import { StatusBadge } from '@/components/badge';
import { EmptyState } from '@/components/empty-state';
import { ErrorView } from '@/components/error-boundary';
import { PageHeader } from '@/components/page-header';
import { Card } from '@/components/ui/card';
import { listThreadsApi } from '@/lib/api';
import { formatRelativeTime, formatUsd } from '@/lib/format';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

export default async function ThreadsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const cursorRaw = Array.isArray(sp.cursor) ? sp.cursor[0] : sp.cursor;
  const cursor = typeof cursorRaw === 'string' && cursorRaw.length > 0 ? cursorRaw : undefined;
  const projectRaw = Array.isArray(sp.project) ? sp.project[0] : sp.project;
  const project = typeof projectRaw === 'string' && projectRaw.length > 0 ? projectRaw : undefined;

  let result: Awaited<ReturnType<typeof listThreadsApi>> | null = null;
  let error: unknown = null;
  try {
    result = await listThreadsApi({
      ...(cursor !== undefined ? { cursor } : {}),
      ...(project !== undefined ? { project } : {}),
      limit: 50,
    });
  } catch (err) {
    error = err;
  }

  return (
    <>
      <PageHeader
        title="Threads"
        description="Multi-turn conversations grouped by thread_id. Each thread is a sequence of runs against the same correlation id."
      />
      {error ? (
        <ErrorView error={error} context="threads" />
      ) : result === null ? null : result.threads.length === 0 ? (
        <EmptyThreadsCard />
      ) : (
        <>
          <Card className="overflow-hidden">
            <div className="flex items-center justify-between border-b border-border bg-bg-subtle px-4 py-2">
              <span className="text-xs font-medium text-fg-muted">
                {result.threads.length} thread{result.threads.length === 1 ? '' : 's'}
              </span>
              <span className="text-[11px] text-fg-faint">most recent activity first</span>
            </div>
            <ul className="flex flex-col">
              {result.threads.map((t) => (
                <li
                  key={t.id}
                  className="border-b border-border last:border-b-0 hover:bg-bg-subtle/40"
                >
                  <Link
                    href={`/threads/${encodeURIComponent(t.id)}`}
                    className="flex items-center gap-4 px-4 py-3"
                  >
                    <div className="w-24 shrink-0">
                      <StatusBadge status={t.lastStatus as never} />
                    </div>
                    <div className="min-w-[180px] flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-sm font-medium text-fg">
                          {t.id.length > 32 ? `${t.id.slice(0, 32)}…` : t.id}
                        </span>
                        <span className="rounded-full border border-border bg-bg px-2 py-0.5 text-[10px] font-medium tabular-nums text-fg-muted">
                          {t.runCount} run{t.runCount === 1 ? '' : 's'}
                        </span>
                        {t.agentNames.slice(0, 3).map((n) => (
                          <span
                            key={n}
                            className="rounded bg-bg-subtle px-1.5 py-0.5 text-[10px] text-fg-muted"
                          >
                            {n}
                          </span>
                        ))}
                        {t.agentNames.length > 3 ? (
                          <span className="text-[10px] text-fg-faint">
                            +{t.agentNames.length - 3} more
                          </span>
                        ) : null}
                      </div>
                      <div className="mt-0.5 flex items-center gap-2 text-[11px] text-fg-muted">
                        <span title={t.firstActivityAt}>
                          began {formatRelativeTime(t.firstActivityAt)}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span title={t.lastActivityAt}>
                          last {formatRelativeTime(t.lastActivityAt)}
                        </span>
                      </div>
                    </div>
                    <div className="w-20 shrink-0 text-right font-mono text-sm tabular-nums text-fg">
                      {formatUsd(t.totalUsd)}
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
          <Pagination cursor={cursor} nextCursor={result.nextCursor} project={project} />
        </>
      )}
    </>
  );
}

function EmptyThreadsCard() {
  return (
    <Card className="px-6 py-12 text-center">
      <h3 className="text-base font-semibold text-fg">No threads yet.</h3>
      <p className="mx-auto mt-1 max-w-md text-sm text-fg-muted">
        Threads appear here when runs share a{' '}
        <code className="rounded bg-bg-subtle px-1">thread_id</code>. Set the column on a run insert
        to group consecutive turns of a chat conversation, or any multi-run workflow with a stable
        correlation id.
      </p>
      <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
        <Link
          href="/runs"
          className="inline-flex items-center rounded border border-border bg-bg-elevated px-3 py-1.5 text-sm font-medium text-fg hover:bg-bg-subtle"
        >
          Browse all runs →
        </Link>
        <Link
          href="/docs"
          className="inline-flex items-center rounded bg-fg px-3 py-1.5 text-sm font-medium text-bg hover:bg-fg/90"
        >
          How threads work →
        </Link>
      </div>
    </Card>
  );
}

function Pagination({
  cursor,
  nextCursor,
  project,
}: {
  cursor: string | undefined;
  nextCursor: string | null;
  project: string | undefined;
}) {
  const baseQs = new URLSearchParams();
  if (project !== undefined) baseQs.set('project', project);
  const firstHref = `/threads${baseQs.toString().length > 0 ? `?${baseQs}` : ''}`;
  const nextQs = new URLSearchParams(baseQs);
  if (nextCursor !== null) nextQs.set('cursor', nextCursor);
  const nextHref = nextCursor !== null ? `/threads?${nextQs}` : null;
  return (
    <div className="mt-4 flex items-center justify-end gap-2 text-sm">
      {cursor !== undefined ? (
        <Link
          href={firstHref}
          className="rounded border border-border bg-bg-elevated px-3 py-1 hover:bg-bg-subtle"
        >
          First
        </Link>
      ) : null}
      {nextHref !== null ? (
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
