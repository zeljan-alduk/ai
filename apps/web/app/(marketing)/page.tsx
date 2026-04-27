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

import { DemoVideoPlaceholder } from '@/components/marketing/demo-video-placeholder';
import Link from 'next/link';

/**
 * Wave-14C — last verification of the comparison table below.
 *
 * LAUNCH REQUIREMENT: the comparison numbers and capability claims
 * must be re-verified at least quarterly. The footnote on the table
 * shows this date verbatim — update both this constant AND the table
 * footer when you re-verify. Do NOT compute the date dynamically; an
 * always-now string would be a lie.
 */
const COMPARISON_TABLE_VERIFIED = '2026-04-26';

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
      <Comparison />
      <BottomCta />
    </>
  );
}

/**
 * Honest comparison table. Three columns: ALDO AI, "general AI
 * frameworks" (LangChain / LlamaIndex / etc.), "chat wrappers" (the
 * cohort of UIs around a single API key). No vendor names — we
 * describe categories so the comparison is durable across model
 * launches.
 *
 * LAUNCH REQUIREMENT: re-verify the rows quarterly. Update both
 * `COMPARISON_TABLE_VERIFIED` at the top of the file AND the footnote
 * at the bottom of this section.
 */
function Comparison() {
  const rows: ReadonlyArray<{ feature: string; aldo: string; framework: string; wrapper: string }> =
    [
      {
        feature: 'LLM-agnostic capability routing',
        aldo: 'Yes',
        framework: 'Partial (per-call)',
        wrapper: 'No',
      },
      {
        feature: 'Local-model first-class',
        aldo: 'Yes (Ollama / vLLM / llama.cpp / MLX)',
        framework: 'Possible',
        wrapper: 'No',
      },
      {
        feature: 'Privacy tier fail-closed',
        aldo: 'Yes (router drops sensitive → cloud)',
        framework: 'No',
        wrapper: 'No',
      },
      {
        feature: 'Replayable run tree',
        aldo: 'Yes (per-node model swap)',
        framework: 'Logs',
        wrapper: 'No',
      },
      {
        feature: 'Sandboxed tool execution',
        aldo: 'Yes (process isolation + scanner)',
        framework: 'BYO',
        wrapper: 'No',
      },
      {
        feature: 'Eval gating before promotion',
        aldo: 'Yes',
        framework: 'BYO',
        wrapper: 'No',
      },
    ];
  return (
    <section className="border-t border-slate-200 bg-slate-50">
      <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6 sm:py-20">
        <div className="mb-8 max-w-2xl">
          <h2 className="text-2xl font-semibold tracking-tight text-slate-900">
            Honest comparison.
          </h2>
          <p className="mt-2 text-sm text-slate-600">
            Three categories of incumbents: general-purpose agent frameworks, chat-wrapper apps, and
            us. We&rsquo;re only comparing what we ship today — no roadmap items in the table.
          </p>
        </div>
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-4 py-3">Capability</th>
                <th className="px-4 py-3">ALDO AI</th>
                <th className="px-4 py-3">Agent framework</th>
                <th className="px-4 py-3">Chat wrapper</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.feature} className="border-t border-slate-100">
                  <td className="px-4 py-3 font-medium text-slate-900">{r.feature}</td>
                  <td className="px-4 py-3 text-slate-700">{r.aldo}</td>
                  <td className="px-4 py-3 text-slate-500">{r.framework}</td>
                  <td className="px-4 py-3 text-slate-500">{r.wrapper}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-[11px] text-slate-500">
          Last verified: {COMPARISON_TABLE_VERIFIED}. We re-verify these claims quarterly; if one is
          out of date,{' '}
          <Link className="underline hover:text-slate-700" href="/security">
            email us
          </Link>{' '}
          and we&rsquo;ll fix the row in the next deploy.
        </p>
      </div>
    </section>
  );
}

function Hero() {
  return (
    <section className="relative mx-auto max-w-6xl overflow-hidden px-4 pt-16 pb-12 sm:px-6 sm:pt-24 sm:pb-16">
      {/* Wave-14C — animated gradient blob behind the headline.
          Pure CSS keyframes; no JS. The animation is `prefers-reduced-
          motion` aware via the global stylesheet so users who opt out
          see a static gradient (defined in globals.css under
          `.aldo-hero-blob`). */}
      <div aria-hidden className="aldo-hero-blob" />
      <h1 className="relative max-w-3xl text-4xl font-semibold tracking-tight text-slate-900 sm:text-5xl">
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
      {/* Wave-14C — demo video placeholder above the fold. Modal
          dialog opens with a YouTube embed; thumbnail is a static
          gradient. Real recording lands at launch (TODO marker
          in the component). */}
      <DemoVideoPlaceholder />
      {/* Wave-14C — design-partner CTA in place of the wave-12
          "Trusted by" placeholder. We don't have logos yet, and we
          will not stage logos we don't have. */}
      <div className="mt-12 rounded-xl border border-blue-200 bg-blue-50/60 p-5 text-center sm:flex sm:items-center sm:justify-between sm:text-left">
        <p className="text-sm text-blue-900">
          <strong>Be one of our design partners.</strong> We&rsquo;re working with a small cohort of
          early teams to shape the roadmap.
        </p>
        <Link
          href="/design-partner"
          className="mt-3 inline-flex rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-blue-700 sm:mt-0"
        >
          Apply to be a design partner →
        </Link>
      </div>
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
