/**
 * `/billing` — subscription overview, trial countdown, plan-management
 * affordances.
 *
 * Server component. Fetches the caller's subscription via the API; if
 * the API returns `not_configured` (placeholder mode), we render a
 * calm banner instead of an error and skip the upgrade CTAs. The trial
 * keeps running, so the page is never alarming in this state.
 *
 * Layout:
 *
 *   [PageHeader: Billing]
 *   [Banner: "billing isn't enabled in this environment yet" — only when not_configured]
 *   [Card: current plan + status + trial countdown bar]
 *   [Card: "Manage subscription" button — only when stripe customer exists]
 *   [Card: Upgrade pickers — only when trialing AND configured]
 *
 * LLM-agnostic: the page never names a model or provider. All
 * Stripe-specific copy is constrained to the upgrade CTAs.
 */

import '@/lib/api-server-init';

import { PageHeader } from '@/components/page-header';
import { ApiClientError, getSubscription } from '@/lib/api';
import { manageSubscriptionAction, upgradeAction } from './actions';

export const dynamic = 'force-dynamic';

export default async function BillingPage({
  searchParams,
}: {
  searchParams?: Promise<{ notice?: string }>;
}) {
  const sp = (await searchParams) ?? {};
  const notice = sp.notice;

  let subscription: Awaited<ReturnType<typeof getSubscription>>['subscription'] | null = null;
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

  // The /v1/billing/checkout endpoint surfaces not_configured even when
  // /v1/billing/subscription returned a row (the subscription endpoint
  // is permissive — it returns the trial row regardless). We probe the
  // checkout-disabled state through the search-param the upgrade
  // action sets when it bounces back.
  const upgradeDisabled = notConfigured || notice === 'not_configured';

  return (
    <>
      <PageHeader
        title="Billing"
        description="Your subscription, trial countdown, and plan management. Tenant-scoped — every member of this workspace sees the same state."
      />

      {notConfigured ? <NotConfiguredBanner /> : null}
      {notice === 'needs_checkout' ? <NeedsCheckoutBanner /> : null}
      {fetchError !== null ? <ErrorBanner message={fetchError} /> : null}

      <section className="mt-4 rounded-lg border border-slate-200 bg-white p-5">
        <h2 className="text-sm font-semibold text-slate-900">Current plan</h2>
        {subscription ? (
          <>
            <div className="mt-2 flex items-baseline gap-3">
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
          </>
        ) : (
          <p className="mt-2 text-sm text-slate-500">No subscription information available.</p>
        )}
      </section>

      {/* Manage subscription — only shown when there's something to manage.
          Disabled in not_configured mode (no Stripe customer to portal into). */}
      {!notConfigured && subscription && subscription.plan !== 'trial' ? (
        <section className="mt-4 rounded-lg border border-slate-200 bg-white p-5">
          <h2 className="text-sm font-semibold text-slate-900">Manage subscription</h2>
          <p className="mt-1 text-sm text-slate-600">
            Update your card, change plan, download invoices, or cancel through Stripe&apos;s
            billing portal.
          </p>
          <form action={manageSubscriptionAction} className="mt-4">
            <button
              type="submit"
              className="rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800"
            >
              {subscription.status === 'cancelled'
                ? 'Reactivate subscription'
                : 'Manage subscription'}
            </button>
          </form>
        </section>
      ) : null}

      {/* Upgrade CTAs — visible when trialing, hidden in not_configured mode. */}
      {!upgradeDisabled && subscription?.status === 'trialing' ? (
        <section className="mt-4 grid gap-4 md:grid-cols-2">
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

function NotConfiguredBanner() {
  return (
    <div className="mt-4 rounded-md border border-amber-300 bg-amber-50 px-4 py-3">
      <p className="text-sm font-medium text-amber-900">
        Billing isn&apos;t enabled in this environment yet.
      </p>
      <p className="mt-1 text-xs text-amber-800">
        Your trial keeps running; we&apos;ll email you before any charge. The control plane is fully
        functional in the meantime.
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
    <section className="rounded-lg border border-slate-200 bg-white p-5">
      <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
      <p className="mt-1 text-sm text-slate-600">{description}</p>
      <form action={upgradeAction} className="mt-4">
        <input type="hidden" name="plan" value={plan} />
        <button
          type="submit"
          className="rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800"
        >
          Upgrade to {title}
        </button>
      </form>
    </section>
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
