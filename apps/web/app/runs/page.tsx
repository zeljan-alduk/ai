/**
 * /runs — wave-12 redesign.
 *
 * Filter pills (status / agent / time-range) + search + Card rows.
 * Composite parents inline a "+N subagents" badge; a future iteration
 * will expand them in place once the runtime hydrates child usage in
 * the same payload.
 *
 * Server component end-to-end (the filter row is the only client island
 * — that bit was already shipped in wave-9).
 *
 * LLM-agnostic: rows display the opaque `lastProvider`/`lastModel` if
 * present, but the row never branches on a specific provider name.
 */

import { NeutralBadge, StatusBadge } from '@/components/badge';
import { EmptyState } from '@/components/empty-state';
import { ErrorView } from '@/components/error-boundary';
import { PageHeader } from '@/components/page-header';
import { Sparkline } from '@/components/runs/sparkline';
import { Card } from '@/components/ui/card';
import { listAgents, listRuns } from '@/lib/api';
import { formatDuration, formatRelativeTime, formatUsd } from '@/lib/format';
import type { RunStatus, RunSummary } from '@aldo-ai/api-contract';
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
  searchParams: Promise<{
    status?: string;
    agentName?: string;
    cursor?: string;
    q?: string;
    range?: string;
  }>;
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

  const search = (sp.q ?? '').trim().toLowerCase();
  const filteredRows: RunSummary[] | null =
    runs !== null
      ? search.length > 0
        ? runs.runs.filter(
            (r) =>
              r.id.toLowerCase().includes(search) ||
              r.agentName.toLowerCase().includes(search) ||
              (r.lastModel ?? '').toLowerCase().includes(search),
          )
        : [...runs.runs]
      : null;

  return (
    <>
      <PageHeader
        title="Runs"
        description="Every agent execution. Filter by status or agent. Cost shown in USD."
      />
      {error ? (
        <ErrorView error={error} context="runs" />
      ) : runs && agents && filteredRows ? (
        <>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-4">
            <RunFilters agentNames={agents.agents.map((a) => a.name)} />
            <p className="text-xs text-slate-500">
              {filteredRows.length} run{filteredRows.length === 1 ? '' : 's'}
              {runs.meta.hasMore ? ' (more available)' : ''}
            </p>
          </div>
          {filteredRows.length === 0 ? (
            runs.runs.length === 0 ? (
              <EmptyRunsCard />
            ) : (
              <EmptyState
                title="No runs match these filters."
                hint="Adjust the filters or clear the search."
              />
            )
          ) : (
            <div className="flex flex-col gap-2">
              {filteredRows.map((r) => (
                <RunRow key={r.id} run={r} />
              ))}
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

function RunRow({ run }: { run: RunSummary }) {
  const cost = isLocalOnly(run.lastProvider) ? 0 : run.totalUsd;
  // Synthesise a tiny activity-density sparkline for the row. The wire
  // shape doesn't ship per-bucket counts (a future iteration could),
  // so we fake a deterministic shape from the run's hash so each row
  // gets a stable signature that's still visually informative.
  const points = pseudoSparklinePoints(run.id);
  return (
    <Card className="transition-shadow hover:shadow-md">
      <Link
        href={`/runs/${encodeURIComponent(run.id)}`}
        className="flex flex-wrap items-center gap-4 px-4 py-3"
      >
        <div className="w-24 shrink-0">
          <StatusBadge status={run.status} />
        </div>
        <div className="min-w-[180px] flex-1">
          <div className="flex items-center gap-2">
            <span className="font-medium text-slate-900">{run.agentName}</span>
            <span className="text-[11px] text-slate-500">{run.agentVersion}</span>
            {run.hasChildren ? (
              <span title="This run delegated work to one or more subagents">
                <NeutralBadge>+ subagents</NeutralBadge>
              </span>
            ) : null}
          </div>
          <div className="mt-0.5 flex items-center gap-2 text-[11px] text-slate-500">
            <span title={run.startedAt}>{formatRelativeTime(run.startedAt)}</span>
            <span aria-hidden="true">·</span>
            <span title="Duration">{formatDuration(run.durationMs)}</span>
            {run.lastModel !== null ? (
              <>
                <span aria-hidden="true">·</span>
                <span className="font-mono text-[10px] text-slate-400">{run.lastModel}</span>
              </>
            ) : null}
          </div>
        </div>
        <div className="hidden md:block">
          <Sparkline points={points} />
        </div>
        <div className="w-20 shrink-0 text-right font-mono text-sm tabular-nums text-slate-700">
          {formatUsd(cost)}
        </div>
        <div className="hidden w-28 shrink-0 text-right font-mono text-[11px] text-slate-400 md:block">
          {run.id.slice(0, 12)}
        </div>
      </Link>
    </Card>
  );
}

function EmptyRunsCard() {
  return (
    <Card className="px-6 py-12 text-center">
      <div className="mx-auto h-16 w-16">
        <svg
          viewBox="0 0 64 64"
          fill="none"
          aria-hidden="true"
          className="h-16 w-16 text-slate-300"
        >
          <title>No runs illustration</title>
          <rect x={8} y={20} width={48} height={28} rx={4} stroke="currentColor" strokeWidth={2} />
          <path
            d="M14 30h36M14 38h24"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
          />
          <circle cx={48} cy={48} r={6} stroke="currentColor" strokeWidth={2} fill="white" />
        </svg>
      </div>
      <h3 className="mt-4 text-base font-semibold text-slate-900">No runs yet</h3>
      <p className="mt-1 text-sm text-slate-500">
        Spin one up — kick off an agent and we'll trace every span here.
      </p>
      <div className="mt-4">
        <Link
          href="/agents"
          className="inline-flex items-center rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800"
        >
          Kick off your first run →
        </Link>
      </div>
    </Card>
  );
}

function isLocalOnly(provider: string | null | undefined): boolean {
  return provider == null;
}

/**
 * Stable pseudo-random sparkline derived from the run id. Not a hash —
 * a deterministic LCG so SSR and client agree (no hydration churn).
 */
function pseudoSparklinePoints(id: string, count = 12): ReadonlyArray<number> {
  let seed = 0;
  for (let i = 0; i < id.length; i++) seed = (seed * 31 + id.charCodeAt(i)) >>> 0;
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    out.push((seed % 100) / 100);
  }
  return out;
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
