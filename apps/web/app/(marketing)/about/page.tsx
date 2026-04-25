/**
 * About — `/about`.
 *
 * One page. Honest framing of why ALDO AI exists, who builds it, and
 * how it differs from "build your own LangChain stack". No fake
 * origin story; no implied funding. Links to the GitHub repo, the
 * `agency/` template concept, and the FSL license rationale.
 */

import Link from 'next/link';

const GITHUB_URL = 'https://github.com/zeljan-alduk/ai';
const AGENCY_FOLDER_URL = `${GITHUB_URL}/tree/main/agency`;
const FSL_URL = 'https://fsl.software';

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
          <a href={AGENCY_FOLDER_URL} target="_blank" rel="noreferrer">
            <code>agency/</code>
          </a>{' '}
          folder we use internally — principal, architect, engineers, reviewers. It is the unit test
          for every platform feature: if a feature does not help that agency ship, we do not ship
          it.
        </p>

        <h2 className="mt-10 text-xl font-semibold text-slate-900">License</h2>
        <p>
          ALDO AI is source-available under{' '}
          <a href={FSL_URL} target="_blank" rel="noreferrer">
            FSL-1.1-ALv2
          </a>
          . You can read, fork, run, and modify the code today. After two years each released
          version converts to Apache-2.0. The non-compete window is the only thing standing between
          us and a cloned hosted offering — we think that is a fair trade for shipping the source.
        </p>

        <h2 className="mt-10 text-xl font-semibold text-slate-900">Get involved</h2>
        <p>
          The codebase is{' '}
          <a href={GITHUB_URL} target="_blank" rel="noreferrer">
            on GitHub
          </a>
          . If you want a deeper look before you commit, the{' '}
          <Link href="/design-partner">design-partner program</Link> is the front door — a small
          group of teams getting hands-on access while we shake out the rough edges.
        </p>
      </div>
    </article>
  );
}
