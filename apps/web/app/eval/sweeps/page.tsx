import { EmptyState } from '@/components/empty-state';
import { ErrorView } from '@/components/error-boundary';
import { SweepStatusBadge } from '@/components/eval/sweep-status-badge';
import { PageHeader } from '@/components/page-header';
import { listAgents } from '@/lib/api';
import { listSweeps } from '@/lib/eval-client';
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

export default async function SweepsPage({
  searchParams,
}: {
  searchParams: Promise<{ agent?: string; status?: string }>;
}) {
  const sp = await searchParams;
  const query: { agent?: string; status?: SweepStatus } = {};
  if (sp.agent) query.agent = sp.agent;
  const statusVal = coerceStatus(sp.status);
  if (statusVal) query.status = statusVal;

  let sweeps: Awaited<ReturnType<typeof listSweeps>> | null = null;
  let agents: Awaited<ReturnType<typeof listAgents>> | null = null;
  let error: unknown = null;
  try {
    [sweeps, agents] = await Promise.all([listSweeps(query), listAgents({ limit: 200 })]);
  } catch (err) {
    error = err;
  }

  return (
    <>
      <PageHeader
        title="Sweeps"
        description="Every eval sweep ever launched. Filter by agent or status."
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
          <div className="mb-4 flex items-center justify-between gap-4">
            <SweepFilters agentNames={agents.agents.map((a) => a.name)} />
            <p className="text-xs text-slate-500">
              {sweeps.sweeps.length} sweep{sweeps.sweeps.length === 1 ? '' : 's'}
            </p>
          </div>
          {sweeps.sweeps.length === 0 ? (
            <EmptyState
              title="No sweeps match these filters."
              hint="Launch one or relax the filter."
            />
          ) : (
            <div className="overflow-hidden rounded-md border border-slate-200 bg-white">
              <table className="aldo-table">
                <thead>
                  <tr>
                    <th>Status</th>
                    <th>Suite</th>
                    <th>Agent</th>
                    <th className="text-right">Models</th>
                    <th className="text-right">Cases</th>
                    <th>Started</th>
                    <th>Ended</th>
                    <th className="text-right">ID</th>
                  </tr>
                </thead>
                <tbody>
                  {sweeps.sweeps.map((s) => (
                    <tr key={s.id} className="hover:bg-slate-50">
                      <td>
                        <SweepStatusBadge status={s.status} />
                      </td>
                      <td className="text-sm">
                        <Link
                          className="font-medium text-slate-900 hover:underline"
                          href={`/eval/suites/${encodeURIComponent(s.suiteName)}`}
                        >
                          {s.suiteName}
                        </Link>
                        <span className="ml-1 font-mono text-xs text-slate-500">
                          {s.suiteVersion}
                        </span>
                      </td>
                      <td className="text-sm">
                        <Link
                          className="text-slate-700 hover:underline"
                          href={`/agents/${encodeURIComponent(s.agentName)}`}
                        >
                          {s.agentName}
                        </Link>
                        <span className="ml-1 font-mono text-xs text-slate-500">
                          {s.agentVersion}
                        </span>
                      </td>
                      <td className="text-right text-sm tabular-nums text-slate-700">
                        {s.modelCount}
                      </td>
                      <td className="text-right text-sm tabular-nums text-slate-700">
                        {s.caseCount}
                      </td>
                      <td className="text-sm text-slate-600" title={s.startedAt}>
                        {formatRelativeTime(s.startedAt)}
                      </td>
                      <td className="text-sm text-slate-600" title={s.endedAt ?? ''}>
                        {s.endedAt ? formatRelativeTime(s.endedAt) : '—'}
                      </td>
                      <td className="text-right">
                        <Link
                          className="font-mono text-xs text-blue-600 hover:underline"
                          href={`/eval/sweeps/${encodeURIComponent(s.id)}`}
                        >
                          {s.id.slice(0, 12)}
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      ) : null}
    </>
  );
}
