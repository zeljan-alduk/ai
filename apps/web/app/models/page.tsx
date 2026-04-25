import { NeutralBadge, PrivacyBadge } from '@/components/badge';
import { EmptyState } from '@/components/empty-state';
import { ErrorView } from '@/components/error-boundary';
import { PageHeader } from '@/components/page-header';
import { listModels } from '@/lib/api';
import { formatUsd } from '@/lib/format';

export const dynamic = 'force-dynamic';

export default async function ModelsPage() {
  let data: Awaited<ReturnType<typeof listModels>> | null = null;
  let error: unknown = null;
  try {
    data = await listModels();
  } catch (err) {
    error = err;
  }

  return (
    <>
      <PageHeader
        title="Models"
        description="Registered models. Provider strings are opaque — switch providers via config, not code."
      />
      {error ? (
        <ErrorView error={error} context="models" />
      ) : data ? (
        data.models.length === 0 ? (
          <EmptyState
            title="No models registered."
            hint="Add provider configuration to apps/api to make models available."
          />
        ) : (
          <div className="overflow-hidden rounded-md border border-slate-200 bg-white">
            <table className="aldo-table">
              <thead>
                <tr>
                  <th>Model</th>
                  <th>Provider</th>
                  <th>Locality</th>
                  <th>Capability</th>
                  <th>Privacy allowed</th>
                  <th className="text-right">$/Mtok in</th>
                  <th className="text-right">$/Mtok out</th>
                  <th>Available</th>
                </tr>
              </thead>
              <tbody>
                {data.models.map((m) => (
                  <tr
                    key={m.id}
                    className={m.available ? 'hover:bg-slate-50' : 'opacity-60 hover:bg-slate-50'}
                  >
                    <td>
                      <span className="font-mono text-xs text-slate-900">{m.id}</span>
                      <div className="mt-0.5 flex flex-wrap gap-1">
                        {m.provides.map((p) => (
                          <NeutralBadge key={p}>{p}</NeutralBadge>
                        ))}
                      </div>
                    </td>
                    <td className="text-sm text-slate-700">{m.provider}</td>
                    <td className="text-sm text-slate-700">{m.locality}</td>
                    <td className="text-sm text-slate-700">{m.capabilityClass}</td>
                    <td>
                      <div className="flex flex-wrap gap-1">
                        {m.privacyAllowed.map((t) => (
                          <PrivacyBadge key={t} tier={t} />
                        ))}
                      </div>
                    </td>
                    <td className="text-right text-sm tabular-nums">
                      {formatUsd(m.cost.usdPerMtokIn)}
                    </td>
                    <td className="text-right text-sm tabular-nums">
                      {formatUsd(m.cost.usdPerMtokOut)}
                    </td>
                    <td>
                      {m.available ? (
                        <span className="inline-flex items-center gap-1 text-xs text-emerald-700">
                          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                          available
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs text-slate-500">
                          <span className="h-1.5 w-1.5 rounded-full bg-slate-300" />
                          not configured
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : null}
    </>
  );
}
