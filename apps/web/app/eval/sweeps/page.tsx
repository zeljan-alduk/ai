/**
 * /eval/sweeps — sweep card grid (wave-12 redesign).
 *
 * Replaces the wave-7 table with a grid of cards, each showing a
 * thumbnail of the matrix (cell colors only — no labels). Filters
 * cover agent, suite, status, and a date range.
 *
 * The wire endpoint already supports `?agent=` + `?status=`. The
 * suite + date filters are applied client-side after the list loads
 * (the underlying contract doesn't model them yet — additive
 * extension when it does).
 */

import { ErrorView } from '@/components/error-boundary';
import { SweepStatusBadge } from '@/components/eval/sweep-status-badge';
import { SweepThumbnail } from '@/components/eval/sweep-thumbnail';
import { PageHeader } from '@/components/page-header';
import { Card, CardContent, CardFooter, CardHeader } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { listAgents } from '@/lib/api';
import { listSuites, listSweeps } from '@/lib/eval-client';
import { formatRelativeTime } from '@/lib/format';
import type { SweepStatus } from '@aldo-ai/api-contract';
import Link from 'next/link';
import { SweepFilters } from './filters';

export const dynamic = 'force-dynamic';

const SWEEP_STATUSES = new Set<SweepStatus>([
  'queued',
  'running',
  'completed',
  'failed',
  'cancelled',
]);

function coerceStatus(v: string | undefined): SweepStatus | undefined {
  if (!v) return undefined;
  return SWEEP_STATUSES.has(v as SweepStatus) ? (v as SweepStatus) : undefined;
}

interface SearchParams {
  agent?: string;
  status?: string;
  suite?: string;
  from?: string;
  to?: string;
}

export default async function SweepsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const query: { agent?: string; status?: SweepStatus } = {};
  if (sp.agent) query.agent = sp.agent;
  const statusVal = coerceStatus(sp.status);
  if (statusVal) query.status = statusVal;

  let sweeps: Awaited<ReturnType<typeof listSweeps>> | null = null;
  let agents: Awaited<ReturnType<typeof listAgents>> | null = null;
  let suites: Awaited<ReturnType<typeof listSuites>> | null = null;
  let error: unknown = null;
  try {
    [sweeps, agents, suites] = await Promise.all([
      listSweeps(query),
      listAgents({ limit: 200 }),
      listSuites().catch(() => ({ suites: [] })),
    ]);
  } catch (err) {
    error = err;
  }

  // Client-side filters not yet on the contract.
  const suiteFilter = sp.suite ?? '';
  const fromFilter = sp.from ?? '';
  const toFilter = sp.to ?? '';
  const filteredSweeps = (sweeps?.sweeps ?? []).filter((s) => {
    if (suiteFilter && s.suiteName !== suiteFilter) return false;
    if (fromFilter && s.startedAt < fromFilter) return false;
    if (toFilter) {
      // toFilter is an ISO date "YYYY-MM-DD" — compare against the
      // date prefix of startedAt for inclusivity.
      const day = s.startedAt.slice(0, 10);
      if (day > toFilter) return false;
    }
    return true;
  });

  return (
    <>
      <PageHeader
        title="Sweeps"
        description="Card view: each sweep shows a thumbnail of its matrix at a glance."
        actions={
          <Link
            href="/eval/sweeps/new"
            className="rounded bg-slate-900 px-3 py-1 text-sm font-medium text-white hover:bg-slate-800"
          >
            New sweep
          </Link>
        }
      />
      {error ? (
        <ErrorView error={error} context="sweeps" />
      ) : sweeps && agents ? (
        <>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-4">
            <SweepFilters
              agentNames={agents.agents.map((a) => a.name)}
              suiteNames={suites?.suites.map((s) => s.name) ?? []}
            />
            <p className="text-xs text-slate-500">
              {filteredSweeps.length} of {sweeps.sweeps.length} sweep
              {sweeps.sweeps.length === 1 ? '' : 's'}
            </p>
          </div>
          {filteredSweeps.length === 0 ? (
            <EmptyState
              title="No sweeps match these filters."
              description="Launch one from the eval page or relax the filters."
            />
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {filteredSweeps.map((s) => (
                <Card key={s.id} className="flex flex-col">
                  <CardHeader className="flex flex-col gap-1 p-4">
                    <div className="flex items-center justify-between gap-2">
                      <SweepStatusBadge status={s.status} />
                      <span className="font-mono text-[11px] text-slate-500">
                        {s.id.slice(0, 12)}
                      </span>
                    </div>
                    <Link
                      href={`/eval/suites/${encodeURIComponent(s.suiteName)}`}
                      className="text-sm font-semibold text-slate-900 hover:underline"
                    >
                      {s.suiteName}
                      <span className="ml-1 font-mono text-[11px] text-slate-500">
                        {s.suiteVersion}
                      </span>
                    </Link>
                    <Link
                      href={`/agents/${encodeURIComponent(s.agentName)}`}
                      className="text-xs text-slate-600 hover:underline"
                    >
                      {s.agentName}{' '}
                      <span className="font-mono text-[11px] text-slate-500">{s.agentVersion}</span>
                    </Link>
                  </CardHeader>
                  <CardContent className="flex flex-col gap-2 px-4 pb-3 pt-0">
                    <div className="flex h-20 items-center justify-center rounded bg-slate-50 p-2">
                      <SweepThumbnail
                        models={Array.from({ length: s.modelCount }, (_, i) => `m${i}`)}
                        caseCount={s.caseCount}
                      />
                    </div>
                    <div className="flex items-center justify-between text-[11px] text-slate-500">
                      <span>
                        {s.modelCount} model{s.modelCount === 1 ? '' : 's'} · {s.caseCount} case
                        {s.caseCount === 1 ? '' : 's'}
                      </span>
                      <span title={s.startedAt}>{formatRelativeTime(s.startedAt)}</span>
                    </div>
                  </CardContent>
                  <CardFooter className="flex items-center justify-end gap-2 border-t border-slate-100 px-4 py-3">
                    <Link
                      href={`/eval/sweeps/${encodeURIComponent(s.id)}`}
                      className="text-xs font-medium text-slate-700 hover:text-slate-900 hover:underline"
                    >
                      Open sweep
                    </Link>
                  </CardFooter>
                </Card>
              ))}
            </div>
          )}
        </>
      ) : null}
    </>
  );
}
