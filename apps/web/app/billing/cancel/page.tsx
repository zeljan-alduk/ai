/**
 * `/billing/cancel` — Stripe Checkout return URL on cancellation.
 *
 * Reached when the user closes the Stripe Checkout tab or hits the
 * Stripe-side "Back" button. Their trial keeps running unchanged —
 * cancellation here is "did not proceed", not "cancelled subscription".
 *
 * No mutations happen on this page. The Checkout Session expires on
 * the Stripe side automatically; we don't need to reach back to clean
 * anything up.
 */

import Link from 'next/link';

export const dynamic = 'force-dynamic';

export default function BillingCancelPage() {
  return (
    <main className="mx-auto flex min-h-[60vh] max-w-lg flex-col items-center justify-center px-4 py-16 text-center">
      <div className="rounded-full bg-slate-100 px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-slate-700">
        Checkout cancelled
      </div>
      <h1 className="mt-4 text-2xl font-semibold tracking-tight text-fg">No charge, no problem.</h1>
      <p className="mt-3 text-sm text-fg-muted">
        You closed the Stripe checkout before finishing. Your free trial keeps running and nothing
        changed on your workspace. You can come back any time from the /pricing page or the upgrade
        card on /billing.
      </p>
      <div className="mt-8 flex flex-col gap-2 sm:flex-row">
        <Link
          href="/pricing"
          className="inline-flex items-center justify-center rounded bg-accent px-4 py-2 text-sm font-medium text-accent-fg hover:bg-accent-hover"
        >
          Back to /pricing
        </Link>
        <Link
          href="/billing"
          className="inline-flex items-center justify-center rounded border border-border bg-bg-elevated px-4 py-2 text-sm font-medium text-fg hover:bg-bg-subtle"
        >
          Manage workspace
        </Link>
      </div>
    </main>
  );
}
