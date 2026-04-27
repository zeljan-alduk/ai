/**
 * /settings/cache — wave 16C LLM-response cache admin.
 *
 * KPI row + per-model breakdown + policy form + purge button.
 * Server component fetches stats + policy; the policy form and the
 * purge button are client components in sibling files.
 */

import { EmptyState } from '@/components/empty-state';
import { ErrorView } from '@/components/error-boundary';
import { PageHeader } from '@/components/page-header';
import { getCachePolicy, getCacheStats } from '@/lib/api-admin';
import { CachePolicyForm } from './policy-form';
import { PurgeCacheButton } from './purge-button';

export const dynamic = 'force-dynamic';

export default async function CacheSettingsPage() {
  let stats: Awaited<ReturnType<typeof getCacheStats>> | null = null;
  let policy: Awaited<ReturnType<typeof getCachePolicy>> | null = null;
  let error: unknown = null;
  try {
    [stats, policy] = await Promise.all([getCacheStats('24h'), getCachePolicy()]);
  } catch (err) {
    error = err;
  }

  return (
    <div data-tour="cache-settings">
      <PageHeader
        title="Response cache"
        description="Identical model requests return prior responses without paying the API call again. Sensitive privacy tier SKIPS the cache by default — opt-in is a deliberate safety choice."
        actions={<PurgeCacheButton />}
      />
      {error || stats === null || policy === null ? (
        <ErrorView error={error ?? new Error('cache settings unavailable')} context="cache" />
      ) : (
        <>
          {/* KPI row. */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Kpi
              label="Hit rate"
              value={`${(stats.hitRate * 100).toFixed(1)}%`}
              hint={`${stats.hitCount} hits / ${stats.missCount} misses`}
            />
            <Kpi
              label="Saved (24h)"
              value={`$${stats.totalSavedUsd.toFixed(4)}`}
              hint="cumulative replay savings"
            />
            <Kpi label="Hits" value={String(stats.hitCount)} hint="last 24h" />
            <Kpi label="Misses" value={String(stats.missCount)} hint="last 24h" />
          </div>

          {/* Per-model breakdown. */}
          <section className="mt-8">
            <h3 className="mb-3 text-sm font-semibold text-fg">By model</h3>
            {stats.byModel.length === 0 ? (
              <EmptyState
                title="No cached hits in the last 24 hours."
                hint="Once your agents start replaying identical prompts, you'll see a per-model savings breakdown here."
              />
            ) : (
              <div className="overflow-hidden rounded-md border border-slate-200 bg-white">
                <table className="aldo-table">
                  <thead>
                    <tr>
                      <th>Model</th>
                      <th className="text-right">Hits</th>
                      <th className="text-right">Saved (USD)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.byModel.map((m) => (
                      <tr key={m.model}>
                        <td className="font-mono text-xs">{m.model}</td>
                        <td className="text-right">{m.hits}</td>
                        <td className="text-right">${m.savedUsd.toFixed(4)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* Policy form. */}
          <section className="mt-10">
            <h3 className="mb-3 text-sm font-semibold text-fg">Policy</h3>
            <CachePolicyForm initial={policy.policy} />
          </section>
        </>
      )}
    </div>
  );
}

function Kpi({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-md border border-slate-200 bg-white p-4">
      <div className="text-xs uppercase tracking-wider text-fg-muted">{label}</div>
      <div className="mt-1 font-semibold text-2xl text-fg">{value}</div>
      <div className="mt-1 text-xs text-fg-muted">{hint}</div>
    </div>
  );
}
