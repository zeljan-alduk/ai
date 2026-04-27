/**
 * Security — `/security`.
 *
 * Honest writeup. What we have built, what we have NOT built. No
 * implied SOC2, no fabricated audit. Responsible-disclosure address
 * is a placeholder — the inbox MUST exist before public launch.
 *
 * Address is the canonical contact inbox; for ALDO TECH LABS pre-launch
 * the founders' info@aldo.tech doubles as the responsible-disclosure
 * channel. Split into a dedicated security@aldo.tech inbox once volume
 * warrants.
 */

const SECURITY_EMAIL = 'info@aldo.tech';

interface Section {
  readonly title: string;
  readonly body: ReadonlyArray<string>;
}

const SHIPPED: ReadonlyArray<Section> = [
  {
    title: 'Process-isolated tool sandbox',
    body: [
      'Every tool call runs out-of-process under a constrained worker. The supervising agent never executes user-supplied code or shell commands directly.',
    ],
  },
  {
    title: 'Prompt-injection guards',
    body: [
      'External content (web pages, files, retrieved documents) is wrapped with spotlight markers before it reaches a model, and post-call output is run through a scanner that flags exfiltration patterns and policy-violating tool calls.',
    ],
  },
  {
    title: 'Privacy-tier enforcement at the router',
    body: [
      'Agents marked privacy_tier: sensitive are physically incapable of reaching a cloud model. The model gateway drops the call before it leaves the trust boundary; this is enforced by the platform, not by agent authors.',
    ],
  },
  {
    title: 'Secrets at rest with NaCl secretbox',
    body: [
      'Provider keys are encrypted with libsodium secretbox under a per-tenant key, which is itself wrapped by a master key bootstrapped from the deploy environment. The plaintext never lands in the database; rotation is supported.',
    ],
  },
  {
    title: 'Auth and session model',
    body: [
      'Sessions are HTTP-only cookies; bearer tokens never reach the browser bundle. Passwords use argon2id with conservative memory and time costs. JWT signing keys are rotated per environment.',
    ],
  },
  {
    title: 'Replayable, auditable runs',
    body: [
      'Every run is checkpointed end-to-end: every prompt, every tool call, every model response. If something goes wrong you can replay the exact sequence; you do not have to reconstruct from logs.',
    ],
  },
];

const NOT_YET: ReadonlyArray<Section> = [
  {
    title: 'No SOC2',
    body: [
      'We are an MVP product. We have not pursued SOC2 Type I or Type II yet. If you need a formal compliance posture today, we are not the right vendor today — talk to us about Enterprise / self-host instead, where the trust boundary lives in your infrastructure.',
    ],
  },
  {
    title: 'No external pen test',
    body: [
      'We have done internal review and threat-modelling, and the codebase is source-available so external researchers can audit it. We have not commissioned a third-party pen test yet; that is on the roadmap before we leave MVP.',
    ],
  },
  {
    title: 'No bug-bounty programme yet',
    body: [
      'We will respond to responsible disclosure (see below) and credit researchers, but we cannot offer monetary rewards at this stage.',
    ],
  },
];

export default function SecurityPage() {
  return (
    <article className="mx-auto max-w-3xl px-4 py-16 sm:px-6 sm:py-20">
      <header>
        <p className="text-[11px] uppercase tracking-wider text-blue-600">Security</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">
          What we have built, and what we have not.
        </h1>
        <p className="mt-3 text-base text-slate-600">
          The honest version. No implied compliance, no fabricated audit posture.
        </p>
      </header>

      <section className="mt-12">
        <h2 className="text-xl font-semibold tracking-tight text-slate-900">Shipped</h2>
        <ul className="mt-5 flex flex-col gap-4">
          {SHIPPED.map((s) => (
            <li key={s.title} className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
              <h3 className="text-sm font-semibold text-slate-900">{s.title}</h3>
              {s.body.map((p) => (
                <p key={p} className="mt-2 text-sm leading-relaxed text-slate-600">
                  {p}
                </p>
              ))}
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-12">
        <h2 className="text-xl font-semibold tracking-tight text-slate-900">Not yet shipped</h2>
        <p className="mt-2 text-sm text-slate-600">
          Stating these honestly costs us a few enterprise conversations. Hiding them would cost us
          all of them, eventually.
        </p>
        <ul className="mt-5 flex flex-col gap-4">
          {NOT_YET.map((s) => (
            <li key={s.title} className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
              <h3 className="text-sm font-semibold text-slate-900">{s.title}</h3>
              {s.body.map((p) => (
                <p key={p} className="mt-2 text-sm leading-relaxed text-slate-600">
                  {p}
                </p>
              ))}
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-12 rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-xl font-semibold tracking-tight text-slate-900">
          Responsible disclosure
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-slate-600">
          Found something? Email{' '}
          <a
            className="font-medium text-slate-900 hover:underline"
            href={`mailto:${SECURITY_EMAIL}`}
          >
            {SECURITY_EMAIL}
          </a>
          . We will acknowledge within two business days. Please give us a reasonable window to fix
          before public disclosure; we will credit you in the release notes.
        </p>
        <p className="mt-2 text-sm leading-relaxed text-slate-600">
          ALDO AI is a proprietary hosted product; reserve the email address above for
          security-impacting reports. For non-sensitive questions, reach us at{' '}
          <a className="underline hover:text-slate-900" href="mailto:info@aldo.tech">
            info@aldo.tech
          </a>
          .
        </p>
      </section>
    </article>
  );
}
