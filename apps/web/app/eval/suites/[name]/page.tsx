import { NeutralBadge } from '@/components/badge';
import { ErrorView } from '@/components/error-boundary';
import { SweepStatusBadge } from '@/components/eval/sweep-status-badge';
import { PageHeader } from '@/components/page-header';
import { getSuite, listSweeps } from '@/lib/eval-client';
import { formatRelativeTime } from '@/lib/format';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

export default async function SuiteDetailPage({
  params,
}: {
  params: Promise<{ name: string }>;
}) {
  const { name } = await params;
  const decoded = decodeURIComponent(name);

  let suiteData: Awaited<ReturnType<typeof getSuite>> | null = null;
  let recentSweeps: Awaited<ReturnType<typeof listSweeps>> | null = null;
  let error: unknown = null;
  try {
    suiteData = await getSuite(decoded);
    // Best-effort: list recent sweeps for the suite's agent. The list
    // endpoint filters by agent, so we narrow to the suite's agent and
    // then filter by suite name client-side (no suite filter on the wire
    // contract — see api-contract/eval.ts).
    try {
      recentSweeps = await listSweeps({ agent: suiteData.suite.agent });
    } catch {
      recentSweeps = null;
    }
  } catch (err) {
    error = err;
  }

  return (
    <>
      <PageHeader
        title={decoded}
        description="Suite cases, pass threshold, and recent sweeps."
        actions={
          <>
            <Link
              href="/eval"
              className="rounded border border-slate-300 bg-white px-3 py-1 text-sm hover:bg-slate-50"
            >
              Back to eval
            </Link>
            <Link
              href={`/eval/sweeps/new?suite=${encodeURIComponent(decoded)}`}
              className="rounded bg-slate-900 px-3 py-1 text-sm font-medium text-white hover:bg-slate-800"
            >
              Run sweep
            </Link>
          </>
        }
      />
      {error ? (
        <ErrorView error={error} context="this suite" />
      ) : suiteData ? (
        <SuiteBody suite={suiteData.suite} sweeps={recentSweeps?.sweeps ?? []} />
      ) : null}
    </>
  );
}

function SuiteBody({
  suite,
  sweeps,
}: {
  suite: Awaited<ReturnType<typeof getSuite>>['suite'];
  sweeps: Awaited<ReturnType<typeof listSweeps>>['sweeps'];
}) {
  const filtered = sweeps.filter((s) => s.suiteName === suite.name).slice(0, 10);

  return (
    <div className="flex flex-col gap-6">
      <section className="grid grid-cols-2 gap-4 rounded-md border border-slate-200 bg-white p-5 lg:grid-cols-4">
        <Field label="Version">
          <span className="font-mono text-xs text-slate-800">{suite.version}</span>
        </Field>
        <Field label="Agent under test">
          <Link
            className="text-sm font-medium text-slate-900 hover:underline"
            href={`/agents/${encodeURIComponent(suite.agent)}`}
          >
            {suite.agent}
          </Link>
        </Field>
        <Field label="Cases">
          <span className="text-sm tabular-nums text-slate-800">{suite.cases.length}</span>
        </Field>
        <Field label="Pass threshold">
          <span className="font-mono text-sm text-slate-800">
            {(suite.passThreshold * 100).toFixed(0)}%
          </span>
        </Field>
        <Field label="Description">
          <span className="text-sm text-slate-700">{suite.description}</span>
        </Field>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">Cases</h2>
        <div className="overflow-hidden rounded-md border border-slate-200 bg-white">
          <table className="aldo-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Expectation</th>
                <th className="text-right">Weight</th>
                <th>Tags</th>
                <th>Input</th>
              </tr>
            </thead>
            <tbody>
              {suite.cases.map((c) => (
                <tr key={c.id}>
                  <td className="font-mono text-xs text-slate-700">{c.id}</td>
                  <td className="text-xs">
                    <NeutralBadge>{c.expect.kind}</NeutralBadge>
                    <span className="ml-2 font-mono text-[11px] text-slate-600">
                      {summarizeExpect(c.expect)}
                    </span>
                  </td>
                  <td className="text-right text-sm tabular-nums text-slate-700">{c.weight}</td>
                  <td>
                    <div className="flex flex-wrap gap-1">
                      {(c.tags ?? []).length === 0 ? (
                        <span className="text-xs text-slate-400">—</span>
                      ) : (
                        (c.tags ?? []).map((t) => <NeutralBadge key={t}>{t}</NeutralBadge>)
                      )}
                    </div>
                  </td>
                  <td>
                    <pre className="max-h-24 max-w-md overflow-auto whitespace-pre-wrap break-words text-[11px] text-slate-700">
                      {summarizeInput(c.input)}
                    </pre>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
          Recent sweeps for this suite
        </h2>
        {filtered.length === 0 ? (
          <p className="rounded-md border border-slate-200 bg-white px-4 py-6 text-sm text-slate-500">
            No sweeps recorded for this suite yet.
          </p>
        ) : (
          <div className="overflow-hidden rounded-md border border-slate-200 bg-white">
            <table className="aldo-table">
              <thead>
                <tr>
                  <th>Status</th>
                  <th>Agent version</th>
                  <th className="text-right">Models</th>
                  <th>Started</th>
                  <th className="text-right">ID</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((s) => (
                  <tr key={s.id} className="hover:bg-slate-50">
                    <td>
                      <SweepStatusBadge status={s.status} />
                    </td>
                    <td className="font-mono text-xs text-slate-700">{s.agentVersion}</td>
                    <td className="text-right text-sm tabular-nums text-slate-700">
                      {s.modelCount}
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
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wider text-slate-500">{label}</div>
      <div className="mt-1">{children}</div>
    </div>
  );
}

function summarizeExpect(
  e: Awaited<ReturnType<typeof getSuite>>['suite']['cases'][number]['expect'],
): string {
  switch (e.kind) {
    case 'contains':
    case 'not_contains':
    case 'regex':
    case 'exact':
      return e.value;
    case 'json_schema':
      return 'json schema';
    case 'rubric':
      return e.criterion;
  }
}

function summarizeInput(input: unknown): string {
  if (input == null) return '';
  if (typeof input === 'string') return input;
  try {
    return JSON.stringify(input, null, 2);
  } catch {
    return String(input);
  }
}
