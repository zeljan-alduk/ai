/**
 * `/billing/success` — Stripe Checkout return URL on success.
 *
 * Stripe substitutes the literal `{CHECKOUT_SESSION_ID}` placeholder
 * we set in `success_url` with the real session id at redirect time.
 * We display it so the user has a verifiable receipt id, but we
 * intentionally do NOT trust it for state mutation — the
 * `checkout.session.completed` webhook is the source of truth and has
 * already (or will shortly) flip the subscription row to `active`.
 *
 * The /billing page does the full subscription read; this page just
 * confirms the handoff and routes the user there.
 *
 * No auth gate here on purpose: the user is mid-Stripe redirect and a
 * stale session shouldn't 401 them on the celebratory page. The
 * /billing link they click next will do the auth check.
 */

import Link from 'next/link';

export const dynamic = 'force-dynamic';

export default async function BillingSuccessPage({
  searchParams,
}: {
  searchParams?: Promise<{ session_id?: string }>;
}) {
  const sp = (await searchParams) ?? {};
  const sessionId = typeof sp.session_id === 'string' ? sp.session_id : null;

  return (
    <main className="mx-auto flex min-h-[60vh] max-w-lg flex-col items-center justify-center px-4 py-16 text-center">
      <div className="rounded-full bg-emerald-100 px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-emerald-900">
        Payment confirmed
      </div>
      <h1 className="mt-4 text-2xl font-semibold tracking-tight text-fg">
        You&apos;re subscribed.
      </h1>
      <p className="mt-3 text-sm text-fg-muted">
        Your Stripe payment cleared. We&apos;re now waiting on Stripe&apos;s webhook to flip your
        workspace to active — that usually takes a few seconds. The /billing page is the source of
        truth for your current plan and renewal date.
      </p>
      {sessionId !== null ? (
        <p className="mt-4 break-all font-mono text-[11px] text-fg-faint">
          Stripe session: {sessionId}
        </p>
      ) : null}
      <div className="mt-8 flex flex-col gap-2 sm:flex-row">
        <Link
          href="/billing"
          className="inline-flex items-center justify-center rounded bg-accent px-4 py-2 text-sm font-medium text-accent-fg hover:bg-accent-hover"
        >
          Go to /billing
        </Link>
        <Link
          href="/agents"
          className="inline-flex items-center justify-center rounded border border-border bg-bg-elevated px-4 py-2 text-sm font-medium text-fg hover:bg-bg-subtle"
        >
          Start an agent
        </Link>
      </div>
    </main>
  );
}
