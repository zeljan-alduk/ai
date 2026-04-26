/**
 * /billing — wave-12 redesign.
 *
 * Layout:
 *   - Trial countdown card (top-most)
 *   - Usage trend area chart
 *   - Side-by-side: model pie + agent bar
 *   - Monthly projection summary text
 *   - Subscription / portal cards (collapse to a banner when not_configured)
 *
 * Subscription state and analytics are ORTHOGONAL — the analytics
 * charts render even when Stripe isn't configured. The platform tracks
 * usage either way; subscription state just decides whether we charge
 * for it.
 *
 * LLM-agnostic: charts identify models by the opaque `model` string
 * the API emitted. Colours are assigned by ordering, never by provider
 * name.
 */

import '@/lib/api-server-init';

import { AgentBreakdown, ModelBreakdown, TrendChart } from '@/components/billing/usage-charts';
import { PageHeader } from '@/components/page-header';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ApiClientError, getBillingUsage, getSubscription } from '@/lib/api';
import type { BillingUsagePeriod, BillingUsageResponse, Subscription } from '@aldo-ai/api-contract';
import { manageSubscriptionAction, upgradeAction } from './actions';

export const dynamic = 'force-dynamic';

const PERIOD_LABELS: Record<BillingUsagePeriod, string> = {
  '24h': 'last 24h',
  '7d': 'last 7 days',
  '30d': 'last 30 days',
};

function coercePeriod(v: string | undefined): BillingUsagePeriod {
  if (v === '24h' || v === '7d' || v === '30d') return v;
  return '7d';
}

export default async function BillingPage({
  searchParams,
}: {
  searchParams?: Promise<{ notice?: string; period?: string }>;
}) {
  const sp = (await searchParams) ?? {};
  const notice = sp.notice;
  const period = coercePeriod(sp.period);

  let subscription: Subscription | null = null;
  let notConfigured = false;
  let fetchError: string | null = null;

  try {
    const res = await getSubscription();
    subscription = res.subscription;
  } catch (err) {
    if (err instanceof ApiClientError && err.code === 'not_configured') {
      notConfigured = true;
    } else if (err instanceof ApiClientError) {
      fetchError = err.message;
    } else {
      fetchError = 'Could not load your subscription.';
    }
  }

  // Usage analytics — always rendered, orthogonal to subscription state.
  let usage: BillingUsageResponse | null = null;
  let usageError: string | null = null;
  try {
    usage = await getBillingUsage({ period });
  } catch (err) {
    if (err instanceof ApiClientError) {
      usageError = err.message;
    } else {
      usageError = 'Could not load usage analytics.';
    }
  }

  const upgradeDisabled = notConfigured || notice === 'not_configured';

  return (
    <>
      <PageHeader
        title="Billing"
        description="Subscription status, trial countdown, and tenant-wide cost analytics."
      />

      {notConfigured ? <NotConfiguredBanner /> : null}
      {notice === 'needs_checkout' ? <NeedsCheckoutBanner /> : null}
      {fetchError !== null ? <ErrorBanner message={fetchError} /> : null}

      {/* Trial countdown card (top of fold) */}
      {subscription !== null ? (
        <Card className="mt-4">
          <CardHeader>
            <CardTitle>Current plan</CardTitle>
            <CardDescription>The same status every member of this workspace sees.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-baseline gap-3">
              <span className="text-2xl font-semibold capitalize text-slate-900">
                {subscription.plan}
              </span>
              <span
                className={`rounded-full px-2 py-0.5 text-[11px] font-medium uppercase tracking-wider ${statusBadge(
                  subscription.status,
                )}`}
              >
                {subscription.status}
              </span>
            </div>
            {subscription.status === 'trialing' && subscription.trialDaysRemaining !== null ? (
              <TrialCountdown days={subscription.trialDaysRemaining} />
            ) : null}
            {subscription.status === 'active' && subscription.currentPeriodEnd !== null ? (
              <p className="mt-2 text-xs text-slate-500">
                Renews on {formatDate(subscription.currentPeriodEnd)}.
              </p>
            ) : null}
            {subscription.status === 'cancelled' && subscription.cancelledAt !== null ? (
              <p className="mt-2 text-xs text-slate-500">
                Cancelled on {formatDate(subscription.cancelledAt)}.
              </p>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {/* Usage analytics */}
      <section className="mt-6">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold text-slate-900">Cost analytics</h2>
          <PeriodSwitcher current={period} />
        </div>

        {usageError !== null ? (
          <ErrorBanner message={usageError} />
        ) : usage !== null ? (
          <>
            <TotalsRow usage={usage} period={period} />
            <Card className="mt-4">
              <CardHeader>
                <CardTitle>Spend trend ({PERIOD_LABELS[period]})</CardTitle>
                <CardDescription>
                  Aggregated daily USD spend across every agent in this workspace.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <TrendChart byDay={usage.byDay} />
              </CardContent>
            </Card>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle>By model</CardTitle>
                  <CardDescription>
                    Share of spend by model id. Colour is assigned by rank — never by provider.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <ModelBreakdown byModel={usage.byModel} />
                  <ModelLegend byModel={usage.byModel} />
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle>By agent</CardTitle>
                  <CardDescription>Top 8 agents by USD spend.</CardDescription>
                </CardHeader>
                <CardContent>
                  <AgentBreakdown byAgent={usage.byAgent} />
                </CardContent>
              </Card>
            </div>
          </>
        ) : null}
      </section>

      {/* Subscription / portal — only when configured */}
      {!notConfigured && subscription && subscription.plan !== 'trial' ? (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle>Manage subscription</CardTitle>
            <CardDescription>
              Update your card, change plan, download invoices, or cancel through Stripe&apos;s
              billing portal.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form action={manageSubscriptionAction}>
              <button
                type="submit"
                className="rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800"
              >
                {subscription.status === 'cancelled'
                  ? 'Reactivate subscription'
                  : 'Manage subscription'}
              </button>
            </form>
          </CardContent>
        </Card>
      ) : null}

      {/* Upgrade CTAs — visible when trialing AND configured */}
      {!upgradeDisabled && subscription?.status === 'trialing' ? (
        <section className="mt-6 grid gap-4 md:grid-cols-2">
          <PlanCard
            plan="solo"
            title="Solo"
            description="One operator, the full control plane, 100 runs / month."
          />
          <PlanCard
            plan="team"
            title="Team"
            description="Up to 5 seats, 1,000 runs / month, priority support."
          />
        </section>
      ) : null}
    </>
  );
}

// ─────────────────────────────────────────────── presentational

function TotalsRow({
  usage,
  period,
}: {
  usage: BillingUsageResponse;
  period: BillingUsagePeriod;
}) {
  return (
    <div className="grid grid-cols-1 gap-4 xs:grid-cols-2 sm:grid-cols-3">
      <Card>
        <CardContent>
          <div className="text-[11px] uppercase tracking-wider text-slate-500">
            Total ({PERIOD_LABELS[period]})
          </div>
          <div className="mt-1 font-mono text-2xl font-semibold tabular-nums text-slate-900">
            {formatUsd(usage.totalUsd)}
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardContent>
          <div className="text-[11px] uppercase tracking-wider text-slate-500">Distinct models</div>
          <div className="mt-1 font-mono text-2xl font-semibold tabular-nums text-slate-900">
            {usage.byModel.length}
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardContent>
          <div className="text-[11px] uppercase tracking-wider text-slate-500">
            Monthly projection
          </div>
          {usage.monthlyProjectionUsd !== null ? (
            <>
              <div className="mt-1 font-mono text-2xl font-semibold tabular-nums text-slate-900">
                {formatUsd(usage.monthlyProjectionUsd)}
              </div>
              <p className="mt-1 text-xs text-slate-500">
                On track to spend {formatUsd(usage.monthlyProjectionUsd)} this month.
              </p>
            </>
          ) : (
            <>
              <div className="mt-1 font-mono text-2xl font-semibold tabular-nums text-slate-400">
                —
              </div>
              <p className="mt-1 text-xs text-slate-500">
                Not enough history to project a monthly figure yet.
              </p>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function ModelLegend({
  byModel,
}: {
  byModel: BillingUsageResponse['byModel'];
}) {
  if (byModel.length === 0) return null;
  const PALETTE = [
    '#0f172a',
    '#1e3a8a',
    '#0f766e',
    '#7c3aed',
    '#be123c',
    '#a16207',
    '#475569',
    '#0891b2',
  ];
  return (
    <ul className="mt-2 grid grid-cols-1 gap-1 text-xs">
      {byModel.map((m, i) => (
        <li key={m.model} className="flex items-center justify-between gap-3">
          <span className="flex items-center gap-2">
            <span
              className="inline-block h-2 w-2 rounded-full"
              style={{ backgroundColor: PALETTE[i % PALETTE.length] }}
              aria-hidden="true"
            />
            <span className="font-mono text-[11px] text-slate-700">{m.model}</span>
          </span>
          <span className="font-mono tabular-nums text-slate-600">{formatUsd(m.usd)}</span>
        </li>
      ))}
    </ul>
  );
}

function PeriodSwitcher({ current }: { current: BillingUsagePeriod }) {
  const periods: BillingUsagePeriod[] = ['24h', '7d', '30d'];
  return (
    <div className="inline-flex rounded-md border border-slate-200 bg-white p-0.5 text-xs">
      {periods.map((p) => (
        <a
          key={p}
          href={`/billing?period=${p}`}
          className={`rounded px-2.5 py-1 font-medium ${
            p === current ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          {p}
        </a>
      ))}
    </div>
  );
}

function NotConfiguredBanner() {
  return (
    <div className="mt-4 rounded-md border border-amber-300 bg-amber-50 px-4 py-3">
      <p className="text-sm font-medium text-amber-900">
        Billing isn&apos;t enabled in this environment yet.
      </p>
      <p className="mt-1 text-xs text-amber-800">
        Your trial keeps running; we&apos;ll email you before any charge. The cost analytics below
        keep working — they only depend on usage records, not subscription state.
      </p>
    </div>
  );
}

function NeedsCheckoutBanner() {
  return (
    <div className="mt-4 rounded-md border border-slate-300 bg-slate-50 px-4 py-3">
      <p className="text-sm text-slate-800">
        You need to complete checkout before opening the billing portal.
      </p>
    </div>
  );
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="mt-4 rounded-md border border-rose-300 bg-rose-50 px-4 py-3">
      <p className="text-sm text-rose-900">{message}</p>
    </div>
  );
}

function TrialCountdown({ days }: { days: number }) {
  const total = 14;
  const used = Math.max(0, Math.min(total, total - days));
  const percent = Math.round((used / total) * 100);
  return (
    <div className="mt-3">
      <div className="flex items-baseline justify-between">
        <span className="text-xs text-slate-600">
          {days === 0 ? 'Trial expired' : `${days} day${days === 1 ? '' : 's'} left in trial`}
        </span>
        <span className="text-[11px] uppercase tracking-wider text-slate-400">
          {used}/{total} used
        </span>
      </div>
      <div className="mt-1 h-1.5 w-full overflow-hidden rounded bg-slate-200">
        <div className="h-full bg-slate-900" style={{ width: `${percent}%` }} aria-hidden="true" />
      </div>
    </div>
  );
}

function PlanCard({
  plan,
  title,
  description,
}: {
  plan: 'solo' | 'team';
  title: string;
  description: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <form action={upgradeAction}>
          <input type="hidden" name="plan" value={plan} />
          <button
            type="submit"
            className="rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800"
          >
            Upgrade to {title}
          </button>
        </form>
      </CardContent>
    </Card>
  );
}

function statusBadge(status: string): string {
  switch (status) {
    case 'trialing':
      return 'bg-sky-100 text-sky-900';
    case 'active':
      return 'bg-emerald-100 text-emerald-900';
    case 'past_due':
    case 'unpaid':
    case 'incomplete':
      return 'bg-amber-100 text-amber-900';
    case 'cancelled':
      return 'bg-slate-200 text-slate-700';
    default:
      return 'bg-slate-100 text-slate-700';
  }
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString();
  } catch {
    return iso;
  }
}

function formatUsd(usd: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(usd);
}
