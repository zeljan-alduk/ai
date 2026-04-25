import { EmptyState } from '@/components/empty-state';
import { ErrorView } from '@/components/error-boundary';
import { SweepStatusBadge } from '@/components/eval/sweep-status-badge';
import { PageHeader } from '@/components/page-header';
import { listSuites, listSweeps } from '@/lib/eval-client';
import { formatRelativeTime } from '@/lib/format';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

export default async function EvalIndexPage() {
  let suites: Awaited<ReturnType<typeof listSuites>> | null = null;
  let sweeps: Awaited<ReturnType<typeof listSweeps>> | null = null;
  let error: unknown = null;
  try {
    [suites, sweeps] = await Promise.all([listSuites(), listSweeps()]);
  } catch (err) {
    error = err;
  }

  return (
    <>
      <PageHeader
        title="Eval"
        description="Suites, sweeps, and promotion gates. Compare any model on the same agent spec."
        actions={
          <>
            <Link
              href="/eval/sweeps"
              className="rounded border border-slate-300 bg-white px-3 py-1 text-sm hover:bg-slate-50"
            >
              All sweeps
            </Link>
            <Link
              href="/eval/sweeps/new"
              className="rounded bg-slate-900 px-3 py-1 text-sm font-medium text-white hover:bg-slate-800"
            >
              New sweep
            </Link>
          </>
        }
      />
      {error ? (
        <ErrorView error={error} context="eval" />
      ) : suites && sweeps ? (
        <div className="flex flex-col gap-8">
          <section>
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
              Suites
            </h2>
            {suites.suites.length === 0 ? (
              <EmptyState
                title="No suites registered."
                hint="Add a YAML file under eval/suites/ and the registry will pick it up."
              />
            ) : (
              <div className="overflow-hidden rounded-md border border-slate-200 bg-white">
                <table className="aldo-table">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Version</th>
                      <th>Agent</th>
                      <th className="text-right">Cases</th>
                      <th>Description</th>
                    </tr>
                  </thead>
                  <tbody>
                    {suites.suites.map((s) => (
                      <tr key={`${s.name}@${s.version}`} className="hover:bg-slate-50">
                        <td>
                          <Link
                            className="font-medium text-slate-900 hover:underline"
                            href={`/eval/suites/${encodeURIComponent(s.name)}`}
                          >
                            {s.name}
                          </Link>
                        </td>
                        <td className="font-mono text-xs text-slate-700">{s.version}</td>
                        <td className="text-sm">
                          <Link
                            className="text-slate-700 hover:underline"
                            href={`/agents/${encodeURIComponent(s.agent)}`}
                          >
                            {s.agent}
                          </Link>
                        </td>
                        <td className="text-right text-sm tabular-nums text-slate-700">
                          {s.caseCount}
                        </td>
                        <td className="text-sm text-slate-600">{s.description}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section>
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
                Recent sweeps
              </h2>
              <Link href="/eval/sweeps" className="text-xs text-blue-600 hover:underline">
                View all
              </Link>
            </div>
            {sweeps.sweeps.length === 0 ? (
              <EmptyState
                title="No sweeps yet."
                hint="Kick one off via New sweep above."
                action={
                  <Link
                    href="/eval/sweeps/new"
                    className="rounded bg-slate-900 px-3 py-1 text-sm font-medium text-white hover:bg-slate-800"
                  >
                    New sweep
                  </Link>
                }
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
                      <th className="text-right">ID</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sweeps.sweeps.slice(0, 10).map((s) => (
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
          </section>
        </div>
      ) : null}
    </>
  );
}
