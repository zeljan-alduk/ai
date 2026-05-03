/**
 * Pricing teaser — three-card preview pulled from /pricing.
 *
 * Don't duplicate the full table; surface enough to qualify the lead
 * and link out. Solo + Team route to /signup pre-flagged with the
 * plan slug (the same flow the /pricing page kicks into when the
 * visitor isn't authed). Enterprise is a `mailto:` — no checkout
 * flow until the MSA conversation has happened.
 *
 * Bullets are pulled from the canonical PLANS array on the pricing
 * page; trim to 4-6 per card, prefer the items that differentiate.
 *
 * Server component, semantic tokens throughout.
 */

import Link from 'next/link';

interface PlanTeaser {
  readonly slug: 'solo' | 'team' | 'enterprise';
  readonly name: string;
  readonly price: string;
  readonly priceSuffix: string;
  readonly tagline: string;
  readonly features: ReadonlyArray<string>;
  readonly highlight?: boolean;
  readonly cta: { readonly label: string; readonly href: string };
}

const PLANS: ReadonlyArray<PlanTeaser> = [
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
      'All privacy tiers',
      'Local models out of the box',
    ],
    cta: { label: 'Start free trial', href: '/signup?plan=solo&next=/billing/checkout?plan=solo' },
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
      '$20 cloud-model credit included',
      'Role-based access',
      'Everything in Solo',
    ],
    cta: { label: 'Start free trial', href: '/signup?plan=team&next=/billing/checkout?plan=team' },
  },
  {
    slug: 'enterprise',
    name: 'Enterprise',
    price: 'Contact',
    priceSuffix: '',
    tagline: 'For organisations with compliance, SSO, or self-host needs.',
    features: [
      'Unlimited users + runs',
      'SSO / SAML',
      'Self-host via Helm + Terraform',
      'Custom MSA + SLA',
      'Dedicated support',
    ],
    cta: {
      label: 'Talk to us',
      href: 'mailto:info@aldo.tech?subject=ALDO%20AI%20%E2%80%94%20Enterprise%20inquiry',
    },
  },
];

export function PricingTeaser() {
  return (
    <section id="pricing" className="border-t border-border bg-bg">
      <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-24">
        <div className="mb-12 max-w-3xl">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-accent">
            Simple pricing. Self-host or hosted.
          </p>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight text-fg sm:text-[2.1rem]">
            Public prices. No-card 14-day trial. No per-token markup.
          </h2>
          <p className="mt-3 text-base leading-relaxed text-fg-muted">
            Bring your own provider keys and pay providers directly. The cards below are a teaser —
            the full table, the FAQ, and the run-counting rules live on{' '}
            <Link href="/pricing" className="text-accent hover:text-accent-hover hover:underline">
              the pricing page
            </Link>
            .
          </p>
        </div>

        <ul className="grid grid-cols-1 gap-5 lg:grid-cols-3">
          {PLANS.map((p) => {
            const isEnterprise = p.slug === 'enterprise';
            const isMailto = p.cta.href.startsWith('mailto:');
            return (
              <li
                key={p.slug}
                className={`flex flex-col rounded-xl border bg-bg-elevated p-6 shadow-sm transition-shadow hover:shadow-md ${
                  p.highlight ? 'border-accent ring-1 ring-accent' : 'border-border'
                }`}
              >
                <div className="flex items-baseline justify-between">
                  <h3 className="text-[16px] font-semibold tracking-tight text-fg">{p.name}</h3>
                  {p.highlight ? (
                    <span className="rounded-full bg-accent/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-accent">
                      Most popular
                    </span>
                  ) : null}
                </div>
                <div className="mt-3 flex items-baseline gap-1">
                  <span className="text-[28px] font-semibold tracking-tight tabular-nums text-fg">
                    {p.price}
                  </span>
                  {p.priceSuffix ? (
                    <span className="text-sm text-fg-muted">{p.priceSuffix}</span>
                  ) : null}
                </div>
                <p className="mt-1 text-[13.5px] text-fg-muted">{p.tagline}</p>

                <ul className="mt-5 flex flex-col gap-2 text-[13.5px] text-fg">
                  {p.features.map((f) => (
                    <li key={f} className="flex items-start gap-2">
                      <span
                        aria-hidden
                        className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${
                          isEnterprise ? 'bg-fg-muted' : 'bg-accent'
                        }`}
                      />
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>

                <div className="mt-6 flex-1" />

                {isMailto ? (
                  <a
                    href={p.cta.href}
                    className="inline-flex w-full items-center justify-center rounded border border-border bg-bg px-4 py-2.5 text-sm font-medium text-fg transition-colors hover:bg-bg-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  >
                    {p.cta.label} →
                  </a>
                ) : (
                  <Link
                    href={p.cta.href}
                    className={`inline-flex w-full items-center justify-center rounded px-4 py-2.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
                      p.highlight
                        ? 'bg-accent text-accent-fg hover:bg-accent-hover'
                        : 'border border-border bg-bg text-fg hover:bg-bg-subtle'
                    }`}
                  >
                    {p.cta.label} →
                  </Link>
                )}
              </li>
            );
          })}
        </ul>

        <div className="mt-8 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-bg-elevated p-5 text-sm text-fg-muted">
          <span>
            Every plan: <strong className="text-fg">14-day free trial</strong>, no card required.
            Cancel inside the trial and you&rsquo;re never charged.
          </span>
          <Link
            href="/pricing"
            className="rounded border border-border bg-bg px-3 py-1.5 text-sm font-medium text-fg transition-colors hover:bg-bg-subtle"
          >
            See the full pricing page →
          </Link>
        </div>
      </div>
    </section>
  );
}
