/**
 * Design partner — `/design-partner`.
 *
 * Marketing-surface landing for Engineer R's design-partner program.
 * Engineer P framed the copy + perks; Engineer R wired in the
 * application form (the `<DesignPartnerApplicationForm />` client
 * island) and the server action that POSTs to
 * `/v1/design-partners/apply` (PUBLIC, no auth).
 *
 * Auth: this page is in the `(marketing)` route group, so the root
 * layout suppresses sidebar chrome. The `/design-partner` route is
 * also in the public allow-list in `lib/middleware-shared.ts` —
 * unauthenticated visitors land here without being redirected to
 * /login. Same on the API side: the route is in the bearer-token
 * middleware's PUBLIC_PATH_EXACT set.
 */

import { DesignPartnerApplicationForm } from './form';

const PARTNER_PERKS: ReadonlyArray<{ title: string; body: string }> = [
  {
    title: '50% off Team for 12 months',
    body: 'Locked in for the first year, even if list pricing moves.',
  },
  {
    title: 'Direct line to the people building the product',
    body: 'A shared Slack / email channel with founders. We answer same-day.',
  },
  {
    title: 'Roadmap influence',
    body: 'Your needs jump the queue. If a sharp edge is blocking you, we will fix it before we add the next feature.',
  },
  {
    title: 'Replay our internal evals against your tasks',
    body: 'We run our agency on real engineering work; you can see how it generalises to yours.',
  },
];

const WE_ASK: ReadonlyArray<string> = [
  'You are running, or about to run, a non-trivial agent workload (more than a single chatbot).',
  'You are willing to talk to us for ~30 minutes every other week.',
  'You can share what is working and what is not, with enough detail that we can act on it.',
];

export default function DesignPartnerPage() {
  return (
    <article className="mx-auto max-w-3xl px-4 py-16 sm:px-6 sm:py-20">
      <header>
        <p className="text-[11px] uppercase tracking-wider text-blue-600">Design partner</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">
          Build alongside us.
        </h1>
        <p className="mt-3 text-base text-slate-600">
          A small group of teams, hands-on access, real influence on what ships.
        </p>
      </header>

      <section className="mt-10">
        <h2 className="text-xl font-semibold tracking-tight text-slate-900">What you get</h2>
        <ul className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
          {PARTNER_PERKS.map((p) => (
            <li key={p.title} className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
              <h3 className="text-sm font-semibold text-slate-900">{p.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-600">{p.body}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-10">
        <h2 className="text-xl font-semibold tracking-tight text-slate-900">What we ask</h2>
        <ul className="mt-4 flex flex-col gap-2 text-sm text-slate-700">
          {WE_ASK.map((line) => (
            <li key={line} className="flex gap-2">
              <span aria-hidden className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-blue-600" />
              <span>{line}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-10 rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-xl font-semibold tracking-tight text-slate-900">Apply</h2>
        <p className="mt-2 text-sm text-slate-600">
          Tell us a little about you and the workload you have in mind. We read every submission and
          reply within five business days.
        </p>
        <div className="mt-5">
          <DesignPartnerApplicationForm />
        </div>
      </section>
    </article>
  );
}
