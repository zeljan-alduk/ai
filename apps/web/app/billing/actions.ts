'use server';

/**
 * Server actions for /billing.
 *
 *   * `manageSubscriptionAction` — POSTs to /v1/billing/portal and
 *     redirects the caller to the Stripe-hosted billing portal URL.
 *
 *   * `upgradeAction` — POSTs to /v1/billing/checkout for the chosen
 *     plan and redirects the caller to the Stripe Checkout URL.
 *
 * Both actions return null on `not_configured` (placeholder mode) so
 * the calling form can re-render with a banner; on any other error
 * they redirect back to /billing with `?error=…` so the page can
 * surface a transient message. We never echo Stripe-internal IDs.
 */

import '@/lib/api-server-init';

import { ApiClientError, createCheckoutSession, createPortalSession } from '@/lib/api';
import { redirect } from 'next/navigation';

export async function manageSubscriptionAction(): Promise<void> {
  try {
    const { url } = await createPortalSession({});
    redirect(url);
  } catch (err) {
    if (err instanceof ApiClientError && err.code === 'not_configured') {
      // Calmly redirect back to /billing — the page already renders
      // the placeholder banner explaining why this can't run.
      redirect('/billing?notice=not_configured');
    }
    if (err instanceof ApiClientError && err.code === 'payment_required') {
      // Tenant never completed checkout; bounce them to the upgrade UI
      // on the same page.
      redirect('/billing?notice=needs_checkout');
    }
    throw err;
  }
}

export async function upgradeAction(formData: FormData): Promise<void> {
  const planRaw = formData.get('plan');
  const plan = planRaw === 'team' ? 'team' : 'solo';
  try {
    const { url } = await createCheckoutSession({ plan });
    redirect(url);
  } catch (err) {
    if (err instanceof ApiClientError && err.code === 'not_configured') {
      redirect('/billing?notice=not_configured');
    }
    throw err;
  }
}
