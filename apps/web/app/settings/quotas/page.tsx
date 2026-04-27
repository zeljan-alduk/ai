/**
 * /settings/quotas — Wave-16D per-tenant monthly quota dashboard.
 *
 * Read-only. Shows current usage vs cap with a progress bar. Calls
 * `GET /v1/quotas/me` server-side; the page IS a server component
 * because there are no interactions on the page.
 *
 * Next-step CTA points at /billing for an upgrade — the brief
 * doesn't ship a quota-edit surface in this wave; operators raise
 * caps via the wave-11 subscription plan upgrade path.
 */

import { ErrorView } from '@/components/error-boundary';
import { PageHeader } from '@/components/page-header';
import { getMyQuota } from '@/lib/api-admin';

export const dynamic = 'force-dynamic';

export default async function QuotasPage() {
  let snap: Awaited<ReturnType<typeof getMyQuota>> | null = null;
  let error: unknown = null;
  try {
    snap = await getMyQuota();
  } catch (err) {
    error = err;
  }

  if (error || snap === null) {
    return (
      <>
        <PageHeader title="Quotas" description="Your monthly run + cost allowance." />
        <ErrorView error={error} context="quotas" />
      </>
    );
  }

  const q = snap.quota;
  const runsPct = computePct(q.monthlyRunsUsed, q.monthlyRunsMax);
  const costPct = computePct(q.monthlyCostUsdUsed, q.monthlyCostUsdMax);
  const resetIso = new Date(q.resetAt).toLocaleString();

  return (
    <>
      <PageHeader
        title="Quotas"
        description={`Monthly allowance for the ${q.plan} plan. Resets on ${resetIso}.`}
      />
      <div className="grid gap-6 md:grid-cols-2">
        <QuotaCard
          label="Runs this month"
          used={q.monthlyRunsUsed}
          cap={q.monthlyRunsMax}
          pct={runsPct}
          unit="runs"
        />
        <QuotaCard
          label="Spend this month"
          used={q.monthlyCostUsdUsed}
          cap={q.monthlyCostUsdMax}
          pct={costPct}
          unit="USD"
          format={(n) => `$${n.toFixed(2)}`}
        />
      </div>
      <p className="mt-6 text-sm text-slate-500">
        Need more headroom? Upgrade your plan in{' '}
        <a className="underline" href="/billing">
          Billing
        </a>
        .
      </p>
    </>
  );
}

function computePct(used: number, cap: number | null): number {
  if (cap === null || cap === 0) return 0;
  return Math.min(100, Math.round((used / cap) * 100));
}

function QuotaCard(props: {
  label: string;
  used: number;
  cap: number | null;
  pct: number;
  unit: string;
  format?: (n: number) => string;
}) {
  const fmt = props.format ?? ((n) => String(n));
  const isUnlimited = props.cap === null;
  const barColor =
    props.pct >= 90 ? 'bg-red-500' : props.pct >= 75 ? 'bg-amber-500' : 'bg-emerald-500';
  return (
    <div className="rounded-md border border-slate-200 bg-white p-4">
      <div className="text-sm text-slate-500">{props.label}</div>
      <div className="mt-1 text-2xl font-semibold text-slate-900">
        {fmt(props.used)}
        {!isUnlimited && (
          <span className="text-base font-normal text-slate-500">
            {' '}
            / {fmt(props.cap as number)}
          </span>
        )}
        {isUnlimited && <span className="text-base font-normal text-slate-500"> (unlimited)</span>}
      </div>
      {!isUnlimited && (
        <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-slate-100">
          <div
            className={`h-2 ${barColor}`}
            style={{ width: `${Math.max(2, props.pct)}%` }}
            aria-label={`${props.pct}% used`}
          />
        </div>
      )}
      <div className="mt-2 text-xs text-slate-400">
        {isUnlimited ? 'Enterprise plan' : `${props.pct}% of monthly allowance`}
      </div>
    </div>
  );
}
