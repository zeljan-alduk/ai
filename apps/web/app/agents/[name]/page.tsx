import { PolicyPanels } from '@/components/agent/policy-panels';
import { RoutingDryRunCard } from '@/components/agent/routing-dry-run-card';
import { NeutralBadge, PrivacyBadge } from '@/components/badge';
import { ErrorView } from '@/components/error-boundary';
import { PageHeader } from '@/components/page-header';
import { getAgent } from '@/lib/api';
import { formatRelativeTime } from '@/lib/format';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

export default async function AgentDetailPage({
  params,
}: {
  params: Promise<{ name: string }>;
}) {
  const { name } = await params;
  const decoded = decodeURIComponent(name);

  let data: Awaited<ReturnType<typeof getAgent>> | null = null;
  let error: unknown = null;
  try {
    data = await getAgent(decoded);
  } catch (err) {
    error = err;
  }

  return (
    <>
      <PageHeader
        title={decoded}
        description="Agent identity, versions, model policy, tools, and raw spec."
        actions={
          <>
            <Link
              href="/agents"
              className="rounded border border-slate-300 bg-white px-3 py-1 text-sm hover:bg-slate-50"
            >
              Back to agents
            </Link>
            <Link
              href={`/agents/${encodeURIComponent(decoded)}/promote`}
              className="rounded bg-slate-900 px-3 py-1 text-sm font-medium text-white hover:bg-slate-800"
            >
              Promote
            </Link>
          </>
        }
      />
      {error ? (
        <ErrorView error={error} context="this agent" />
      ) : data ? (
        <AgentBody agent={data.agent} />
      ) : null}
    </>
  );
}

function AgentBody({ agent }: { agent: Awaited<ReturnType<typeof getAgent>>['agent'] }) {
  const spec = agent.spec as Record<string, unknown> | null;
  const role = readString(spec, 'role') ?? readString(spec, 'description');
  const modelPolicy = readObject(spec, 'model_policy') ?? readObject(spec, 'modelPolicy');
  const tools = readArray(spec, 'tools');

  return (
    <div className="flex flex-col gap-6">
      <section className="grid grid-cols-2 gap-4 rounded-md border border-slate-200 bg-white p-5 lg:grid-cols-4">
        <Field label="Privacy">
          <PrivacyBadge tier={agent.privacyTier} />
        </Field>
        <Field label="Team">
          <span className="text-sm text-slate-800">{agent.team}</span>
        </Field>
        <Field label="Owner">
          <span className="text-sm text-slate-800">{agent.owner}</span>
        </Field>
        <Field label="Latest version">
          <span className="font-mono text-xs text-slate-800">{agent.latestVersion}</span>
          {agent.promoted ? (
            <span className="ml-2 text-[10px] uppercase tracking-wider text-emerald-700">
              promoted
            </span>
          ) : null}
        </Field>
        <Field label="Description">
          <span className="text-sm text-slate-700">{agent.description}</span>
        </Field>
        {role && role !== agent.description ? (
          <Field label="Role">
            <span className="text-sm text-slate-700">{role}</span>
          </Field>
        ) : null}
        <Field label="Tags">
          <div className="flex flex-wrap gap-1">
            {agent.tags.length === 0 ? (
              <span className="text-xs text-slate-400">—</span>
            ) : (
              agent.tags.map((t) => <NeutralBadge key={t}>{t}</NeutralBadge>)
            )}
          </div>
        </Field>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
          Model policy
        </h2>
        <div className="overflow-hidden rounded-md border border-slate-200 bg-white p-4">
          {modelPolicy ? (
            <pre className="overflow-x-auto whitespace-pre-wrap break-words text-xs text-slate-700">
              {JSON.stringify(modelPolicy, null, 2)}
            </pre>
          ) : (
            <p className="text-sm text-slate-500">
              No explicit model policy — the gateway will pick a model based on capability
              requirements declared in the spec.
            </p>
          )}
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">Tools</h2>
        <div className="overflow-hidden rounded-md border border-slate-200 bg-white p-4">
          {tools && tools.length > 0 ? (
            <ul className="flex flex-wrap gap-2">
              {dedupeBy(tools.map(describeTool)).map((label) => (
                <li key={label}>
                  <NeutralBadge>{label}</NeutralBadge>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-slate-500">No tools declared.</p>
          )}
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
          Safety policy
        </h2>
        <PolicyPanels agent={agent} />
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
          Routing dry-run
        </h2>
        <RoutingDryRunCard agentName={agent.name} />
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
          Versions
        </h2>
        {agent.versions.length === 0 ? (
          <p className="rounded-md border border-slate-200 bg-white px-4 py-6 text-sm text-slate-500">
            No version history available.
          </p>
        ) : (
          <div className="overflow-hidden rounded-md border border-slate-200 bg-white">
            <table className="aldo-table">
              <thead>
                <tr>
                  <th>Version</th>
                  <th>Promoted</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {agent.versions.map((v) => (
                  <tr key={v.version}>
                    <td className="font-mono text-xs">{v.version}</td>
                    <td>
                      {v.promoted ? (
                        <span className="text-xs uppercase tracking-wider text-emerald-700">
                          promoted
                        </span>
                      ) : (
                        <span className="text-xs text-slate-400">—</span>
                      )}
                    </td>
                    <td className="text-sm text-slate-600" title={v.createdAt}>
                      {formatRelativeTime(v.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
          Raw spec
        </h2>
        <div className="overflow-hidden rounded-md border border-slate-200 bg-slate-950 p-4">
          <pre className="overflow-x-auto whitespace-pre-wrap break-words text-xs text-slate-100">
            {JSON.stringify(agent.spec, null, 2)}
          </pre>
        </div>
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

function readString(obj: Record<string, unknown> | null, key: string): string | null {
  if (!obj) return null;
  const v = obj[key];
  return typeof v === 'string' ? v : null;
}
function readObject(
  obj: Record<string, unknown> | null,
  key: string,
): Record<string, unknown> | null {
  if (!obj) return null;
  const v = obj[key];
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}
function readArray(obj: Record<string, unknown> | null, key: string): unknown[] | null {
  if (!obj) return null;
  const v = obj[key];
  return Array.isArray(v) ? v : null;
}
function describeTool(t: unknown): string {
  if (typeof t === 'string') return t;
  if (t && typeof t === 'object') {
    const o = t as Record<string, unknown>;
    if (typeof o.name === 'string') return o.name;
    if (typeof o.id === 'string') return o.id;
  }
  return 'tool';
}
function dedupeBy(values: ReadonlyArray<string>): ReadonlyArray<string> {
  const seen = new Map<string, number>();
  const out: string[] = [];
  for (const v of values) {
    const n = seen.get(v) ?? 0;
    seen.set(v, n + 1);
    out.push(n === 0 ? v : `${v} (${n + 1})`);
  }
  return out;
}
