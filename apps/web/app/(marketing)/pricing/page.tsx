/**
 * Pricing — `/pricing`.
 *
 * Three plans. Honest framing — no fake social proof, no fabricated
 * statistics. Each "Start free trial" CTA links to /signup?plan=<slug>
 * so the signup form can pre-select the plan when Engineer Q's
 * Stripe Checkout lands.
 *
 * Billing-not-configured banner: Engineer Q is wiring Stripe in this
 * same wave. Until the secret keys are set in the API environment,
 * the checkout endpoint returns `not_configured`; we render a small
 * inline notice instead of breaking the page. The check is a simple
 * env probe — no network round-trip needed for SSG/ISR.
 */

import Link from 'next/link';

interface Plan {
  readonly slug: 'solo' | 'team' | 'enterprise';
  readonly name: string;
  readonly price: string;
  readonly priceSuffix: string;
  readonly tagline: string;
  readonly cta: { label: string; href: string };
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
    cta: { label: 'Start free trial', href: '/signup?plan=solo' },
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
    cta: { label: 'Start free trial', href: '/signup?plan=team' },
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
    cta: { label: 'Contact sales', href: '/design-partner?plan=enterprise' },
    features: [
      'Unlimited users and runs',
      'SSO / SAML',
      'Dedicated support',
      'On-prem / self-host option',
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
    a: 'Self-host is part of Enterprise. Source-available under FSL-1.1-ALv2 means you can already inspect, fork, and run the code; Enterprise adds a commercial agreement, dedicated support, and the bits that the FSL non-compete restricts.',
  },
];

/**
 * Detect whether Stripe is wired up in this environment. We treat the
 * presence of `STRIPE_SECRET_KEY` as the configured signal — the API
 * needs it to mint Checkout Sessions, so its absence is what Engineer
 * Q's `/v1/billing/checkout` endpoint returns `not_configured` on.
 *
 * This is a server-only read; the value never reaches the client bundle.
 */
function isBillingConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

export default function PricingPage() {
  const billingReady = isBillingConfigured();

  return (
    <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
      <header className="mx-auto max-w-2xl text-center">
        <h1 className="text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">
          Honest pricing.
        </h1>
        <p className="mt-3 text-base text-slate-600">
          14-day free trial on every plan. No card required to start. No surprise per-token markup —
          bring your own provider keys and pay providers directly.
        </p>
      </header>

      {!billingReady ? (
        <output className="mx-auto mt-8 block max-w-3xl rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <strong className="font-semibold">Billing enables next sprint.</strong> Sign up for the
          trial today; we will email you before any charge. Stripe Checkout is being wired in this
          wave — your trial is real, the credit-card step is not yet.
        </output>
      ) : null}

      <ul className="mt-12 grid grid-cols-1 gap-6 lg:grid-cols-3">
        {PLANS.map((plan) => (
          <li
            key={plan.slug}
            className={`flex flex-col rounded-lg border bg-white p-6 shadow-sm ${
              plan.highlight ? 'border-blue-600 ring-1 ring-blue-600' : 'border-slate-200'
            }`}
          >
            <div className="flex items-baseline justify-between">
              <h2 className="text-base font-semibold text-slate-900">{plan.name}</h2>
              {plan.highlight ? (
                <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-blue-700">
                  Most popular
                </span>
              ) : null}
            </div>
            <div className="mt-3 flex items-baseline gap-1">
              <span className="text-3xl font-semibold tracking-tight text-slate-900">
                {plan.price}
              </span>
              {plan.priceSuffix ? (
                <span className="text-sm text-slate-500">{plan.priceSuffix}</span>
              ) : null}
            </div>
            <p className="mt-1 text-sm text-slate-600">{plan.tagline}</p>
            <ul className="mt-5 flex flex-col gap-2 text-sm text-slate-700">
              {plan.features.map((f) => (
                <li key={f} className="flex gap-2">
                  <span
                    aria-hidden
                    className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-blue-600"
                  />
                  <span>{f}</span>
                </li>
              ))}
            </ul>
            <div className="mt-6 flex-1" />
            <Link
              href={plan.cta.href}
              className={`mt-2 inline-flex w-full items-center justify-center rounded px-4 py-2.5 text-sm font-medium transition-colors ${
                plan.highlight
                  ? 'bg-blue-600 text-white hover:bg-blue-700'
                  : 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-100'
              }`}
            >
              {plan.cta.label}
            </Link>
          </li>
        ))}
      </ul>

      <section className="mx-auto mt-20 max-w-3xl">
        <h2 className="text-xl font-semibold tracking-tight text-slate-900">Frequently asked</h2>
        <dl className="mt-6 space-y-5">
          {FAQ.map((item) => (
            <div key={item.q} className="rounded-lg border border-slate-200 bg-white p-5">
              <dt className="text-sm font-semibold text-slate-900">{item.q}</dt>
              <dd className="mt-2 text-sm leading-relaxed text-slate-600">{item.a}</dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  );
}
