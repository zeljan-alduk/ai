'use server';

/**
 * Server actions for the marketing `/pricing` page.
 *
 * `startCheckoutAction` is the single entry the Solo/Team CTAs POST to.
 * It branches on whether the visitor already has a session cookie:
 *
 *   - **Authenticated**: mint a Stripe Checkout URL for their tenant
 *     and `redirect()` straight to Stripe.
 *   - **Unauthenticated**: bounce them through `/signup?plan=<slug>`
 *     with `next=/billing/checkout?plan=<slug>` so the checkout handoff
 *     fires automatically once their workspace is provisioned.
 *
 * Both paths converge on `/billing/checkout` (the post-signup handoff
 * page) so we have one code path that mints the Stripe URL — no
 * duplicated branching inside this action.
 *
 * `not_configured` (HTTP 503) bounces back to /pricing with a banner so
 * the visitor sees a calm explanation instead of a stack trace; any
 * other ApiClientError surfaces the same way (no Stripe-internal IDs
 * are ever leaked).
 */

import '@/lib/api-server-init';

import { ApiClientError, createCheckoutSession } from '@/lib/api';
import { getSession } from '@/lib/session';
import { redirect } from 'next/navigation';

const VALID_PLANS = new Set(['solo', 'team']);

export async function startCheckoutAction(formData: FormData): Promise<void> {
  const planRaw = formData.get('plan');
  const plan = typeof planRaw === 'string' && VALID_PLANS.has(planRaw) ? planRaw : 'solo';

  const session = await getSession();

  // Unauthenticated path — bounce through signup. The checkout handoff
  // page reads `?plan=` and POSTS to /v1/billing/checkout once the
  // user's session cookie is in place.
  if (session === null) {
    const next = `/billing/checkout?plan=${encodeURIComponent(plan)}`;
    redirect(`/signup?plan=${encodeURIComponent(plan)}&next=${encodeURIComponent(next)}`);
  }

  // Authenticated path — mint Stripe URL inline.
  try {
    const { url } = await createCheckoutSession({
      plan: plan as 'solo' | 'team',
      returnTo: '/billing/success?session_id={CHECKOUT_SESSION_ID}',
    });
    redirect(url);
  } catch (err) {
    if (err instanceof ApiClientError && err.code === 'not_configured') {
      // Stripe isn't wired in this environment — the disabled-button
      // fallback should have prevented this, but a stale tab might
      // still POST. Send them back to /pricing with a banner.
      redirect('/pricing?notice=not_configured');
    }
    throw err;
  }
}
