import { NeutralBadge, StatusBadge } from '@/components/badge';
import { EmptyState } from '@/components/empty-state';
import { ErrorView } from '@/components/error-boundary';
import { PageHeader } from '@/components/page-header';
import { listAgents, listRuns } from '@/lib/api';
import { formatDuration, formatRelativeTime, formatUsd } from '@/lib/format';
import type { RunStatus } from '@aldo-ai/api-contract';
import Link from 'next/link';
import { RunFilters } from './filters';

export const dynamic = 'force-dynamic';

const RUN_STATUSES = new Set<RunStatus>(['queued', 'running', 'completed', 'failed', 'cancelled']);

function coerceStatus(v: string | undefined): RunStatus | undefined {
  if (!v) return undefined;
  return RUN_STATUSES.has(v as RunStatus) ? (v as RunStatus) : undefined;
}

export default async function RunsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; agentName?: string; cursor?: string }>;
}) {
  const sp = await searchParams;
  const query = {
    status: coerceStatus(sp.status),
    agentName: sp.agentName || undefined,
    cursor: sp.cursor || undefined,
    limit: 50,
  };

  let runs: Awaited<ReturnType<typeof listRuns>> | null = null;
  let agents: Awaited<ReturnType<typeof listAgents>> | null = null;
  let error: unknown = null;
  try {
    [runs, agents] = await Promise.all([listRuns(query), listAgents({ limit: 200 })]);
  } catch (err) {
    error = err;
  }

  return (
    <>
      <PageHeader
        title="Runs"
        description="Every agent execution. Filter by status or agent. Cost shown in USD."
      />
      {error ? (
        <ErrorView error={error} context="runs" />
      ) : runs && agents ? (
        <>
          <div className="mb-4 flex items-center justify-between gap-4">
            <RunFilters agentNames={agents.agents.map((a) => a.name)} />
            <p className="text-xs text-slate-500">
              {runs.runs.length} run{runs.runs.length === 1 ? '' : 's'}
              {runs.meta.hasMore ? ' (more available)' : ''}
            </p>
          </div>
          {runs.runs.length === 0 ? (
            <EmptyState
              title="No runs match these filters."
              hint="Trigger an agent or relax the filter."
            />
          ) : (
            <div className="overflow-hidden rounded-md border border-slate-200 bg-white">
              <table className="aldo-table">
                <thead>
                  <tr>
                    <th>Status</th>
                    <th>Agent</th>
                    <th>Provider / Model</th>
                    <th>Started</th>
                    <th>Duration</th>
                    <th className="text-right">Cost</th>
                    <th className="text-right">ID</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.runs.map((r) => {
                    const cost = isLocalOnly(r.lastProvider) ? 0 : r.totalUsd;
                    return (
                      <tr key={r.id} className="hover:bg-slate-50">
                        <td>
                          <StatusBadge status={r.status} />
                        </td>
                        <td>
                          <Link
                            className="font-medium text-slate-900 hover:underline"
                            href={`/agents/${encodeURIComponent(r.agentName)}`}
                          >
                            {r.agentName}
                          </Link>
                          <span className="ml-1 text-xs text-slate-500">{r.agentVersion}</span>
                          {r.hasChildren ? (
                            <span
                              className="ml-2 inline-flex"
                              title="This run delegated work to one or more subagents"
                            >
                              <NeutralBadge>composite</NeutralBadge>
                            </span>
                          ) : null}
                        </td>
                        <td className="text-sm text-slate-600">
                          {r.lastProvider ? (
                            <>
                              <span>{r.lastProvider}</span>
                              {r.lastModel ? (
                                <span className="text-slate-400"> / {r.lastModel}</span>
                              ) : null}
                            </>
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </td>
                        <td className="text-sm text-slate-600" title={r.startedAt}>
                          {formatRelativeTime(r.startedAt)}
                        </td>
                        <td className="text-sm text-slate-600">{formatDuration(r.durationMs)}</td>
                        <td className="text-right text-sm tabular-nums text-slate-700">
                          {formatUsd(cost)}
                        </td>
                        <td className="text-right">
                          <Link
                            className="font-mono text-xs text-blue-600 hover:underline"
                            href={`/runs/${encodeURIComponent(r.id)}`}
                          >
                            {r.id.slice(0, 12)}
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <Pagination
            cursor={sp.cursor}
            nextCursor={runs.meta.nextCursor}
            hasMore={runs.meta.hasMore}
            current={sp}
          />
        </>
      ) : null}
    </>
  );
}

function isLocalOnly(provider: string | null | undefined): boolean {
  // Provider strings are opaque, but the convention agreed with apps/api is
  // that local-only runs come back with `lastProvider === null`. We also
  // never branch on a hardcoded provider name — that would violate the
  // LLM-agnostic constraint.
  return provider == null;
}

function Pagination({
  cursor,
  nextCursor,
  hasMore,
  current,
}: {
  cursor: string | undefined;
  nextCursor: string | null;
  hasMore: boolean;
  current: Record<string, string | undefined>;
}) {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(current)) {
    if (v && k !== 'cursor') params.set(k, v);
  }
  const baseQs = params.toString();
  const nextHref =
    hasMore && nextCursor
      ? `/runs?${baseQs ? `${baseQs}&` : ''}cursor=${encodeURIComponent(nextCursor)}`
      : null;
  const firstHref = `/runs${baseQs ? `?${baseQs}` : ''}`;

  return (
    <div className="mt-4 flex items-center justify-end gap-2 text-sm">
      {cursor ? (
        <Link
          href={firstHref}
          className="rounded border border-slate-300 bg-white px-3 py-1 hover:bg-slate-50"
        >
          First
        </Link>
      ) : null}
      {nextHref ? (
        <Link
          href={nextHref}
          className="rounded border border-slate-300 bg-white px-3 py-1 hover:bg-slate-50"
        >
          Next
        </Link>
      ) : (
        <span className="text-slate-400">end of list</span>
      )}
    </div>
  );
}
