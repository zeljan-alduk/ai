/**
 * Pricing — `/pricing`.
 *
 * Three plans. Honest framing — no fake social proof, no fabricated
 * statistics. The Solo + Team CTAs post a server action that:
 *
 *   1. If the visitor already has a session, mints a Stripe Checkout
 *      session for their tenant and redirects to the Stripe-hosted
 *      payment page.
 *   2. Otherwise, sends them to `/signup?plan=<slug>&next=/billing/checkout?plan=<slug>`
 *      so the same plan is preselected after signup and they land back
 *      in the checkout handoff page that auto-mints a Stripe URL with
 *      their freshly-issued session token.
 *
 * The Enterprise CTA is a `mailto:` — no checkout flow, the buyer
 * needs an MSA conversation first.
 *
 * Billing-not-configured: when the host has no `STRIPE_SECRET_KEY` set,
 * the pricing page still renders. The Solo + Team CTAs disable with a
 * "Billing setup pending" tooltip so we don't promise a checkout the
 * platform can't deliver. The /v1/billing/checkout endpoint also
 * surfaces the typed `not_configured` envelope as a backstop.
 *
 * LLM-agnostic by construction.
 */

import Link from 'next/link';
import { startCheckoutAction } from './actions';

interface Plan {
  readonly slug: 'solo' | 'team' | 'enterprise';
  readonly name: string;
  readonly price: string;
  readonly priceSuffix: string;
  readonly tagline: string;
  readonly features: ReadonlyArray<string>;
  readonly highlight?: boolean;
}

const PLANS: ReadonlyArray<Plan> = [
  {
    slug: 'solo',
    name: 'Solo',
    price: '$29',
    priceSuffix: '/mo',
    tagline: 'For one builder running their own agency.',
    features: [
      '1 user, 1 tenant',
      '100 runs / month',
      'Bring your own provider keys',
      'All privacy tiers (public, internal, sensitive)',
      'Full eval harness',
      'Local models out of the box',
    ],
  },
  {
    slug: 'team',
    name: 'Team',
    price: '$99',
    priceSuffix: '/mo',
    tagline: 'For a small team running a real agency.',
    highlight: true,
    features: [
      '5 users, 1 tenant',
      '1,000 runs / month',
      'Bring your own provider keys + $20 cloud-model credit included',
      'Role-based access',
      'Design-partner priority',
      'Everything in Solo',
    ],
  },
  {
    slug: 'enterprise',
    name: 'Enterprise',
    price: 'Contact',
    priceSuffix: '',
    tagline: 'For organisations with compliance, SSO, or self-host needs.',
    features: [
      'Unlimited users and runs',
      'SSO / SAML',
      'Dedicated support',
      'Self-host via Helm chart + Terraform module',
      'Custom MSA',
      'Everything in Team',
    ],
  },
];

const FAQ: ReadonlyArray<{ q: string; a: string }> = [
  {
    q: 'What counts as a run?',
    a: 'A "run" is one top-level agent invocation, even if that agent invokes sub-agents under a supervisor. The whole tree counts as one run; the cost rollup at the root tells you what it actually consumed.',
  },
  {
    q: 'Can I cancel anytime?',
    a: 'Yes. Cancel any time before the 14-day trial ends and you will not be charged. After the trial, plans are month-to-month — cancel and you keep access until the period ends.',
  },
  {
    q: 'Do you offer education or non-profit discounts?',
    a: 'Yes — 50% off Solo and Team for verified students, educators, and registered non-profits. Email us from your institutional address and we will set it up.',
  },
  {
    q: 'Can I self-host?',
    a: 'Yes. The repo ships a Helm chart (`charts/aldo-ai`) and per-cloud Terraform modules (`terraform/aws-eks`, `gcp-gke`, `azure-aks`) so you can run the stack in your own VPC. Enterprise wraps that with a commercial agreement, dedicated support, and an SLA. Email info@aldo.tech to start the conversation.',
  },
];

/**
 * Detect whether Stripe is wired up in this environment. We treat the
 * presence of `STRIPE_SECRET_KEY` as the configured signal — the API
 * needs it to mint Checkout Sessions, so its absence is what the
 * `/v1/billing/checkout` endpoint returns `not_configured` on.
 *
 * This is a server-only read; the value never reaches the client bundle.
 */
function isBillingConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

export const dynamic = 'force-dynamic';

export default async function PricingPage({
  searchParams,
}: {
  searchParams?: Promise<{ notice?: string }>;
}) {
  const billingReady = isBillingConfigured();
  const sp = (await searchParams) ?? {};
  const showNotConfiguredNotice = sp.notice === 'not_configured' || !billingReady;

  return (
    <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
      <header className="mx-auto max-w-2xl text-center">
        <h1 className="text-3xl font-semibold tracking-tight text-fg sm:text-4xl">
          Honest pricing.
        </h1>
        <p className="mt-3 text-base text-fg-muted">
          14-day free trial on every plan. No card required to start. No surprise per-token markup —
          bring your own provider keys and pay providers directly.
        </p>
      </header>

      {showNotConfiguredNotice ? <BillingSetupPendingNotice /> : null}

      <ul className="mt-12 grid grid-cols-1 gap-6 lg:grid-cols-3">
        {PLANS.map((plan) => (
          <li
            key={plan.slug}
            className={`flex flex-col rounded-lg border bg-bg-elevated p-6 shadow-sm ${
              plan.highlight ? 'border-accent ring-1 ring-accent' : 'border-border'
            }`}
          >
            <div className="flex items-baseline justify-between">
              <h2 className="text-base font-semibold text-fg">{plan.name}</h2>
              {plan.highlight ? (
                <span className="rounded-full bg-accent/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-accent">
                  Most popular
                </span>
              ) : null}
            </div>
            <div className="mt-3 flex items-baseline gap-1">
              <span className="text-3xl font-semibold tracking-tight text-fg">{plan.price}</span>
              {plan.priceSuffix ? (
                <span className="text-sm text-fg-muted">{plan.priceSuffix}</span>
              ) : null}
            </div>
            <p className="mt-1 text-sm text-fg-muted">{plan.tagline}</p>
            <ul className="mt-5 flex flex-col gap-2 text-sm text-fg">
              {plan.features.map((f) => (
                <li key={f} className="flex gap-2">
                  <span aria-hidden className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
                  <span>{f}</span>
                </li>
              ))}
            </ul>
            <div className="mt-6 flex-1" />
            <PlanCta plan={plan} billingReady={billingReady} />
          </li>
        ))}
      </ul>

      <section className="mx-auto mt-20 max-w-3xl">
        <h2 className="text-xl font-semibold tracking-tight text-fg">Frequently asked</h2>
        <dl className="mt-6 space-y-5">
          {FAQ.map((item) => (
            <div key={item.q} className="rounded-lg border border-border bg-bg-elevated p-5">
              <dt className="text-sm font-semibold text-fg">{item.q}</dt>
              <dd className="mt-2 text-sm leading-relaxed text-fg-muted">{item.a}</dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  );
}

/**
 * Per-plan CTA. Enterprise stays a `mailto:` link; Solo + Team are a
 * server-action form that branches on auth state inside the action.
 *
 * In `not_configured` mode, the priced-plan buttons render disabled
 * with a `title=` tooltip explaining why instead of pretending to work
 * and 503ing on submit.
 */
function PlanCta({ plan, billingReady }: { plan: Plan; billingReady: boolean }) {
  if (plan.slug === 'enterprise') {
    return (
      <Link
        href="mailto:info@aldo.tech?subject=ALDO%20AI%20%E2%80%94%20Enterprise%20inquiry"
        className="mt-2 inline-flex w-full items-center justify-center rounded border border-border bg-bg-elevated px-4 py-2.5 text-sm font-medium text-fg transition-colors hover:bg-bg-subtle"
      >
        Contact sales
      </Link>
    );
  }

  const buttonLabel = `Start free trial — ${plan.name}`;
  const buttonClass = `mt-2 inline-flex w-full items-center justify-center rounded px-4 py-2.5 text-sm font-medium transition-colors ${
    plan.highlight
      ? 'bg-accent text-accent-fg hover:bg-accent-hover'
      : 'border border-border bg-bg-elevated text-fg hover:bg-bg-subtle'
  } disabled:cursor-not-allowed disabled:opacity-60`;

  if (!billingReady) {
    return (
      <button
        type="button"
        disabled
        title="Billing setup pending — Stripe keys are not configured in this environment."
        aria-label={`${buttonLabel} (disabled — billing setup pending)`}
        className={buttonClass}
      >
        Billing setup pending
      </button>
    );
  }

  return (
    <form action={startCheckoutAction}>
      <input type="hidden" name="plan" value={plan.slug} />
      <button type="submit" className={buttonClass}>
        {buttonLabel}
      </button>
    </form>
  );
}

/**
 * Replaces the pre-wave-18 "Billing enables next sprint" placeholder.
 * The wording is now operationally honest: the trial works, the
 * checkout buttons are intentionally disabled until Stripe credentials
 * land in this environment.
 */
function BillingSetupPendingNotice() {
  return (
    <output className="mx-auto mt-8 block max-w-3xl rounded-md border border-warning/40 bg-warning/10 p-4 text-sm text-fg">
      <strong className="font-semibold">Billing setup pending.</strong> The 14-day trial works today
      — sign up and start building. The Solo and Team checkout buttons turn on once Stripe
      credentials are wired in this deployment; no action needed on your side.
    </output>
  );
}
