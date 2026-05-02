/**
 * `/billing/checkout` — post-signup Stripe handoff.
 *
 * The marketing pricing page bounces unauthenticated visitors through
 * `/signup?plan=<slug>&next=/billing/checkout?plan=<slug>`. After the
 * signup form completes, the auth layer redirects to `next` — landing
 * here. This page mints the Stripe Checkout URL using the freshly-set
 * session cookie and forwards the browser to the Stripe-hosted payment
 * page.
 *
 * The handoff is server-rendered + redirect-only — there is no UI to
 * paint because we never block on the user. If checkout creation
 * fails (`not_configured`, network error, etc.) we render a small
 * error card with a "back to billing" link instead of a stack trace.
 *
 * Why a dedicated page instead of inlining into the signup action:
 * the signup action returns a session cookie via `setSession()`, which
 * Next requires happen in a route handler / server action — NOT in a
 * server component. Putting checkout creation here keeps that boundary
 * clean and makes the auth flow one-step-at-a-time.
 *
 * LLM-agnostic by construction.
 */

import '@/lib/api-server-init';

import { ApiClientError, createCheckoutSession } from '@/lib/api';
import { getSession } from '@/lib/session';
import Link from 'next/link';
import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

const VALID_PLANS = new Set(['solo', 'team']);

export default async function CheckoutHandoffPage({
  searchParams,
}: {
  searchParams?: Promise<{ plan?: string }>;
}) {
  const sp = (await searchParams) ?? {};
  const planRaw = sp.plan ?? 'solo';
  const plan = VALID_PLANS.has(planRaw) ? (planRaw as 'solo' | 'team') : 'solo';

  // No session means the visitor landed here without going through
  // signup/login. Bounce to login carrying the same `next=` so they
  // come back here once authenticated.
  const session = await getSession();
  if (session === null) {
    const next = `/billing/checkout?plan=${encodeURIComponent(plan)}`;
    redirect(`/login?next=${encodeURIComponent(next)}`);
  }

  let url: string | null = null;
  let errorMessage: string | null = null;
  try {
    const result = await createCheckoutSession({
      plan,
      // {CHECKOUT_SESSION_ID} is Stripe's substitution placeholder so
      // the success page can render the Stripe session id without us
      // ever holding it in our DB.
      returnTo: '/billing/success?session_id={CHECKOUT_SESSION_ID}',
    });
    url = result.url;
  } catch (err) {
    if (err instanceof ApiClientError && err.code === 'not_configured') {
      // Stripe not configured here — let the user know without dumping
      // an internal error. They can still use their trial.
      errorMessage =
        'Checkout is not enabled in this environment yet. Your trial is active — head to /billing to manage your workspace.';
    } else if (err instanceof ApiClientError) {
      errorMessage = err.message;
    } else {
      errorMessage = 'Could not start the Stripe checkout flow.';
    }
  }

  if (url !== null) {
    redirect(url);
  }

  return (
    <main className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center px-4 py-16 text-center">
      <h1 className="text-xl font-semibold tracking-tight text-fg">Checkout unavailable</h1>
      <p className="mt-3 text-sm text-fg-muted">
        {errorMessage ?? 'Could not redirect to Stripe.'}
      </p>
      <Link
        href="/billing"
        className="mt-6 inline-flex rounded border border-border bg-bg-elevated px-4 py-2 text-sm font-medium text-fg hover:bg-bg-subtle"
      >
        Go to /billing
      </Link>
    </main>
  );
}
