/**
 * Homepage — `/`.
 *
 * Public, server-rendered, zero JS. Headline + sub + two CTAs, six
 * feature cards reflecting the CLAUDE.md non-negotiables, an "About
 * the agency" paragraph, and a 4-step "How it works" section.
 *
 * Honest copy guard-rails:
 *   - No specific cloud-provider names (LLM-agnostic). The local-models
 *     card lists Ollama / vLLM / llama.cpp / LM Studio / MLX — those
 *     are runtime identifiers, not vendor names.
 *   - No fake testimonials, no fabricated stats, no implied compliance.
 *   - "Demo video coming soon" — we don't have one yet, so we don't
 *     claim one.
 */

import Link from 'next/link';

const FEATURES: ReadonlyArray<{ title: string; body: string }> = [
  {
    title: 'LLM-agnostic',
    body: 'Capability-class routing. Agents declare what they need; the gateway picks the model. Switch providers with config, never code.',
  },
  {
    title: 'Local models, first-class',
    body: 'Ollama, vLLM, llama.cpp, LM Studio, and MLX (Apple Silicon) are auto-discovered. The eval harness compares frontier and local on the same agent spec.',
  },
  {
    title: 'Privacy tiers, enforced',
    body: 'Agents marked sensitive are physically incapable of reaching a cloud model. The router fails closed — not the agent author.',
  },
  {
    title: 'Multi-agent orchestration',
    body: 'Sequential, parallel, debate, and iterative supervisors with deterministic cost rollup at every node of the run tree.',
  },
  {
    title: 'Replayable end-to-end',
    body: 'Every run is checkpointed — full message and tool-call history. Re-execute any step against a different model and diff the output.',
  },
  {
    title: 'Sandbox + guards',
    body: 'Every tool call runs through process isolation, prompt-injection spotlighting, and an output scanner before it touches your data.',
  },
];

const STEPS: ReadonlyArray<{ n: string; title: string; body: string }> = [
  {
    n: '01',
    title: 'Sign up',
    body: 'Create a workspace. No credit card required for the 14-day trial.',
  },
  {
    n: '02',
    title: 'Use the default agency template',
    body: 'A reference organisation (principal, architect, engineers, reviewers) is seeded into your tenant on first login. It is the same template we dogfood with.',
  },
  {
    n: '03',
    title: 'Run an agent',
    body: 'Pick an agent, give it a task. Local models work out of the box; bring your own provider keys for cloud models via Secrets.',
  },
  {
    n: '04',
    title: 'Inspect the run tree',
    body: 'Walk the supervisor tree, see every prompt, every tool call, every cost roll-up. Replay any node against a different model.',
  },
];

export default function HomePage() {
  return (
    <>
      <Hero />
      <Features />
      <Builders />
      <HowItWorks />
      <BottomCta />
    </>
  );
}

function Hero() {
  return (
    <section className="mx-auto max-w-6xl px-4 pt-16 pb-12 sm:px-6 sm:pt-24 sm:pb-16">
      <h1 className="max-w-3xl text-4xl font-semibold tracking-tight text-slate-900 sm:text-5xl">
        Run real software-engineering teams of LLM agents.
      </h1>
      <p className="mt-5 max-w-2xl text-lg text-slate-600">
        Local-first. Privacy-tier-enforced. Replayable end-to-end.
      </p>
      <div className="mt-8 flex flex-wrap items-center gap-3">
        <Link
          href="/signup"
          className="rounded bg-blue-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-700"
        >
          Start free trial
        </Link>
        <Link
          href="/pricing"
          className="rounded border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-100"
        >
          See pricing
        </Link>
      </div>
      <p className="mt-4 text-xs text-slate-500">
        14-day trial, no card required. Honest pricing,{' '}
        <Link className="underline hover:text-slate-700" href="/pricing">
          plans from $29/mo
        </Link>
        .
      </p>
    </section>
  );
}

function Features() {
  return (
    <section className="border-t border-slate-200 bg-white">
      <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6 sm:py-20">
        <div className="mb-10 max-w-2xl">
          <h2 className="text-2xl font-semibold tracking-tight text-slate-900">
            Built like a control plane, not a chat wrapper.
          </h2>
          <p className="mt-2 text-sm text-slate-600">
            The non-negotiables that shape every line of code in the platform.
          </p>
        </div>
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <li key={f.title} className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
              <h3 className="text-sm font-semibold text-slate-900">{f.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-600">{f.body}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function Builders() {
  return (
    <section className="border-t border-slate-200 bg-slate-50">
      <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6 sm:py-16">
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="lg:col-span-1">
            <p className="text-[11px] uppercase tracking-wider text-blue-600">
              Built by ALDO TECH LABS
            </p>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-900">
              Dogfooded by a virtual software agency.
            </h2>
          </div>
          <div className="lg:col-span-2">
            <p className="text-sm leading-relaxed text-slate-700">
              ALDO AI is built by ALDO TECH LABS — a virtualised software agency staffed entirely by
              LLM agents (principal, architect, engineers, reviewers). The same agency spec ships
              with every new tenant as the default template. If a feature does not help that agency
              ship, we do not build it. Everything you see in the product was used by us first to
              build the product.
            </p>
            <p className="mt-3 text-sm leading-relaxed text-slate-700">
              That is also why the orchestrator, the eval harness, and the run tree are not
              afterthoughts — they are the surface area we live in every day.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

function HowItWorks() {
  return (
    <section className="border-t border-slate-200 bg-white">
      <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6 sm:py-20">
        <div className="mb-10 max-w-2xl">
          <h2 className="text-2xl font-semibold tracking-tight text-slate-900">
            How it works in 60 seconds.
          </h2>
          <p className="mt-2 text-sm text-slate-600">
            No demo video yet — we will not stage one. Here is the whole flow in plain text.
          </p>
        </div>
        <ol className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((s) => (
            <li key={s.n} className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
              <div className="text-[11px] font-mono text-blue-600">{s.n}</div>
              <h3 className="mt-1 text-sm font-semibold text-slate-900">{s.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-600">{s.body}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

function BottomCta() {
  return (
    <section className="border-t border-slate-200 bg-slate-900">
      <div className="mx-auto flex max-w-6xl flex-col items-start gap-6 px-4 py-14 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight text-white">
            Ready to run a real agent team?
          </h2>
          <p className="mt-2 text-sm text-slate-300">
            14-day trial, no card required. Local models work out of the box.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Link
            href="/signup"
            className="rounded bg-blue-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-700"
          >
            Start free trial
          </Link>
          <Link
            href="/design-partner"
            className="rounded border border-slate-700 bg-transparent px-4 py-2.5 text-sm font-medium text-slate-200 transition-colors hover:bg-slate-800"
          >
            Apply to be a design partner
          </Link>
        </div>
      </div>
    </section>
  );
}
