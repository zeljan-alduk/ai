import { NeutralBadge, PrivacyBadge } from '@/components/badge';
import { EmptyState } from '@/components/empty-state';
import { ErrorView } from '@/components/error-boundary';
import { PageHeader } from '@/components/page-header';
import { listAgents } from '@/lib/api';
import Link from 'next/link';
import { AgentFilters } from './filters';

export const dynamic = 'force-dynamic';

export default async function AgentsPage({
  searchParams,
}: {
  searchParams: Promise<{ team?: string; cursor?: string }>;
}) {
  const sp = await searchParams;

  let listed: Awaited<ReturnType<typeof listAgents>> | null = null;
  let teamsList: Awaited<ReturnType<typeof listAgents>> | null = null;
  let error: unknown = null;
  try {
    [listed, teamsList] = await Promise.all([
      listAgents({
        team: sp.team || undefined,
        cursor: sp.cursor || undefined,
        limit: 50,
      }),
      // Pull a wider set just to populate the team filter dropdown.
      sp.team ? listAgents({ limit: 200 }) : null,
    ]).then(([l, t]) => [l, t ?? l] as const);
  } catch (err) {
    error = err;
  }

  const teams = teamsList ? Array.from(new Set(teamsList.agents.map((a) => a.team))).sort() : [];

  return (
    <>
      <PageHeader
        title="Agents"
        description="Versioned, eval-gated agent specs. Privacy tier controls model routing."
      />
      {error ? (
        <ErrorView error={error} context="agents" />
      ) : listed ? (
        <>
          <div className="mb-4 flex items-center justify-between gap-4">
            <AgentFilters teams={teams} />
            <p className="text-xs text-slate-500">
              {listed.agents.length} agent{listed.agents.length === 1 ? '' : 's'}
              {listed.meta.hasMore ? ' (more available)' : ''}
            </p>
          </div>
          {listed.agents.length === 0 ? (
            <EmptyState title="No agents match this filter." />
          ) : (
            <div className="overflow-hidden rounded-md border border-slate-200 bg-white">
              <table className="aldo-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Privacy</th>
                    <th>Team</th>
                    <th>Owner</th>
                    <th>Latest version</th>
                    <th>Tags</th>
                  </tr>
                </thead>
                <tbody>
                  {listed.agents.map((a) => (
                    <tr key={a.name} className="hover:bg-slate-50">
                      <td>
                        <Link
                          className="font-medium text-slate-900 hover:underline"
                          href={`/agents/${encodeURIComponent(a.name)}`}
                        >
                          {a.name}
                        </Link>
                        <p className="mt-0.5 text-xs text-slate-500">{a.description}</p>
                      </td>
                      <td>
                        <PrivacyBadge tier={a.privacyTier} />
                      </td>
                      <td className="text-sm text-slate-700">{a.team}</td>
                      <td className="text-sm text-slate-700">{a.owner}</td>
                      <td className="text-sm">
                        <span className="font-mono text-xs text-slate-700">{a.latestVersion}</span>
                        {a.promoted ? (
                          <span className="ml-2 text-[10px] uppercase tracking-wider text-emerald-700">
                            promoted
                          </span>
                        ) : (
                          <span className="ml-2 text-[10px] uppercase tracking-wider text-slate-400">
                            unpromoted
                          </span>
                        )}
                      </td>
                      <td>
                        <div className="flex flex-wrap gap-1">
                          {a.tags.length === 0 ? (
                            <span className="text-xs text-slate-400">—</span>
                          ) : (
                            a.tags.map((t) => <NeutralBadge key={t}>{t}</NeutralBadge>)
                          )}
                        </div>
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
