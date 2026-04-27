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

import { ArchitectureDiagram } from '@/components/marketing/architecture-diagram';
import { DemoVideoPlaceholder } from '@/components/marketing/demo-video-placeholder';
import { HeroCodeSnippet } from '@/components/marketing/hero-code-snippet';
import { TrustStrip } from '@/components/marketing/trust-strip';
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
      <TrustStrip />
      <Architecture />
      <Features />
      <Builders />
      <HowItWorks />
      <Comparison />
      <BottomCta />
    </>
  );
}

function Architecture() {
  return (
    <section className="border-t border-slate-200 bg-white">
      <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6 sm:py-20">
        <div className="mb-10 max-w-2xl">
          <p className="text-[11px] uppercase tracking-wider text-blue-600">Architecture</p>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-900">
            One picture. Privacy enforced by the platform, not the prompt.
          </h2>
          <p className="mt-2 text-sm text-slate-600">
            Every request passes through the privacy-tier router. Sensitive agents are
            <em> physically</em> incapable of reaching a cloud model — the router fails closed
            before a token leaves your tenant boundary.
          </p>
        </div>
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-slate-50 p-4 sm:p-6">
          <ArchitectureDiagram />
        </div>
        <p className="mt-3 text-[11px] text-slate-500">
          Cloud-vs-local is decided by the agent&rsquo;s declared capability class and privacy
          tier. No code path names a provider.
        </p>
      </div>
    </section>
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
        <div className="mt-6 flex flex-wrap gap-2 text-sm">
          <span className="text-slate-500">Side-by-side with named tools:</span>
          <Link
            href="/vs/crewai"
            className="rounded-full border border-slate-300 bg-white px-3 py-1 font-medium text-slate-700 transition-colors hover:border-blue-300 hover:text-blue-700"
          >
            vs CrewAI
          </Link>
          <Link
            href="/vs/langsmith"
            className="rounded-full border border-slate-300 bg-white px-3 py-1 font-medium text-slate-700 transition-colors hover:border-blue-300 hover:text-blue-700"
          >
            vs LangSmith
          </Link>
          <Link
            href="/vs/braintrust"
            className="rounded-full border border-slate-300 bg-white px-3 py-1 font-medium text-slate-700 transition-colors hover:border-blue-300 hover:text-blue-700"
          >
            vs Braintrust
          </Link>
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
    <section className="relative overflow-hidden">
      {/* Wave-14C — animated gradient blob behind the headline.
          Pure CSS keyframes; no JS. `prefers-reduced-motion` aware. */}
      <div aria-hidden className="aldo-hero-blob" />
      <div className="relative mx-auto max-w-6xl px-4 pt-16 pb-12 sm:px-6 sm:pt-24 sm:pb-16">
        <div className="grid grid-cols-1 items-start gap-10 lg:grid-cols-12 lg:gap-12">
          {/* Left — pitch + CTAs. */}
          <div className="lg:col-span-6">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-blue-600">
              The control plane for agent teams
            </p>
            <h1 className="mt-3 text-4xl font-semibold tracking-tight text-slate-900 sm:text-[2.85rem] lg:text-[3.1rem] lg:leading-[1.05]">
              Run real software-engineering teams of LLM agents.
            </h1>
            <p className="mt-5 max-w-xl text-lg leading-relaxed text-slate-600">
              Privacy enforced by the platform, not the prompt. Local models first-class. Every
              run replayable. The control plane the agent stack has been missing.
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
            <div className="mt-10 rounded-xl border border-blue-200 bg-blue-50/60 p-5">
              <p className="text-sm text-blue-900">
                <strong>Be one of our design partners.</strong> A small cohort of early teams
                shaping the roadmap. NDA + source access available.
              </p>
              <Link
                href="/design-partner"
                className="mt-3 inline-flex rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-blue-700"
              >
                Apply to be a design partner →
              </Link>
            </div>
          </div>

          {/* Right — code snippet + 60s demo. */}
          <div className="lg:col-span-6">
            <HeroCodeSnippet />
            <p className="mt-3 text-center text-[11px] text-slate-500">
              An agent is a YAML file — versioned, eval-gated, privacy-tagged. No Python class
              hierarchies. No vendor names.
            </p>
            {/* The launch demo video lives below the snippet so it isn't the first
                thing a visitor sees — code-first reads as a platform, not a video. */}
            <div className="mt-8">
              <DemoVideoPlaceholder />
            </div>
          </div>
        </div>
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
