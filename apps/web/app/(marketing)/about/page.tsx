/**
 * About — `/about`.
 *
 * One page. Honest framing of why ALDO AI exists, who builds it, and
 * how it differs from "build your own LangChain stack". No fake
 * origin story; no implied funding. References the `agency/` template
 * concept and the proprietary licensing model.
 */

import Link from 'next/link';

// GitHub link intentionally absent — repository is private.
const AGENCY_DOC_URL = '/docs/concepts/agency';

export default function AboutPage() {
  return (
    <article className="mx-auto max-w-3xl px-4 py-16 sm:px-6 sm:py-20">
      <header>
        <p className="text-[11px] uppercase tracking-wider text-blue-600">About</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">
          We are building the control plane for agent teams.
        </h1>
      </header>

      <div className="prose prose-slate mt-8 max-w-none text-base leading-relaxed text-slate-700">
        <p>
          ALDO AI is a product of <strong>ALDO TECH LABS</strong>, a software studio obsessed with
          one question: what does it look like when a real engineering team is staffed mostly by LLM
          agents, and an actual control plane sits between them and your code? Most "agent
          frameworks" today answer half of that question and stop. We wanted to ship the other half.
        </p>

        <h2 className="mt-10 text-xl font-semibold text-slate-900">Why we built it</h2>
        <p>
          The current generation of agent stacks bakes a single provider into the framework, treats
          local models as a second-class afterthought, and leaves privacy enforcement to whoever is
          writing the agent prompt. That was never going to work for the kind of team we wanted to
          run. So we drew a line at the first commit:
        </p>
        <ul>
          <li>
            <strong>LLM-agnostic by construction.</strong> No code path names a provider. Agents
            declare capabilities; the gateway picks a model. Switching providers is a config change,
            never a code change.
          </li>
          <li>
            <strong>Local models are first-class.</strong> Ollama, vLLM, llama.cpp, LM Studio, MLX —
            auto-discovered, evaluated against frontier models on the same agent spec.
          </li>
          <li>
            <strong>Privacy tiers are enforced by the platform, not the prompt.</strong> An agent
            marked <code>sensitive</code> is physically incapable of reaching a cloud model. The
            router fails closed.
          </li>
          <li>
            <strong>Every run is replayable.</strong> Full message and tool-call history; re-execute
            any step against a different model.
          </li>
        </ul>

        <h2 className="mt-10 text-xl font-semibold text-slate-900">
          Different from "DIY your own framework"
        </h2>
        <p>
          You can wire most of this together yourself with enough glue code. We have done it. The
          cost of that path is: every privacy invariant becomes a code review; every model swap is a
          refactor; every "what did this run actually cost?" becomes a SQL query. ALDO AI is the
          assertion that those things should be platform features, not engineering folklore.
        </p>

        <h2 className="mt-10 text-xl font-semibold text-slate-900">The reference agency</h2>
        <p>
          Every new tenant is seeded with the same{' '}
          <Link href={AGENCY_DOC_URL}>
            <code>agency/</code>
          </Link>{' '}
          folder we use internally — principal, architect, engineers, reviewers. It is the unit test
          for every platform feature: if a feature does not help that agency ship, we do not ship
          it.
        </p>

        <h2 className="mt-10 text-xl font-semibold text-slate-900">License</h2>
        <p>
          ALDO AI is proprietary. Access is granted to paying customers and design partners under
          our standard terms of service. The hosted product, the SDKs, and the integration
          surfaces are all available through the trial — see{' '}
          <Link href="/pricing">Pricing</Link>.
        </p>

        <h2 className="mt-10 text-xl font-semibold text-slate-900">Get involved</h2>
        <p>
          The fastest way to talk to us is the{' '}
          <Link href="/design-partner">design-partner program</Link> — a small group of teams
          getting hands-on access while we shake out the rough edges. Or just{' '}
          <a href="mailto:info@aldo.tech">drop us a line</a>.
        </p>
      </div>
    </article>
  );
}
