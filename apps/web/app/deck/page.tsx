/**
 * /deck — customer-facing pitch deck.
 *
 * Twelve full-screen slides, vertical scroll-snap, arrow-key
 * navigable. Designed to live on a single URL the salesperson
 * shares before / during / after a meeting. Print-to-PDF supported
 * (each slide on its own A4 landscape page) for follow-up email
 * attachments.
 *
 * Server-rendered. The keyboard navigator is the only client island.
 */

import { ArchitectureDiagram } from '@/components/marketing/architecture-diagram';
import { HeroCodeSnippet } from '@/components/marketing/hero-code-snippet';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { KeyboardNav } from './keyboard-nav';

export const metadata = {
  title: 'ALDO AI — pitch deck',
  description: 'Customer-facing pitch deck. 12 slides on the agent control plane.',
  robots: { index: false, follow: false },
};

interface SlideProps {
  readonly index: number;
  readonly label?: string;
  readonly children: ReactNode;
  readonly variant?: 'dark' | 'light';
}

function Slide({ index, label, children, variant = 'light' }: SlideProps) {
  const dark = variant === 'dark';
  return (
    <section
      data-slide
      id={`slide-${index}`}
      className={`relative flex h-screen min-h-[600px] w-full snap-start items-center justify-center overflow-hidden px-6 py-10 sm:px-12 print:h-[210mm] print:break-after-page ${
        dark ? 'bg-slate-950 text-slate-100' : 'bg-white text-slate-900'
      }`}
    >
      <div className="mx-auto w-full max-w-5xl">
        {label ? (
          <p
            className={`mb-4 text-[11px] font-semibold uppercase tracking-[0.22em] ${
              dark ? 'text-blue-400' : 'text-blue-700'
            }`}
          >
            {label}
          </p>
        ) : null}
        {children}
      </div>
    </section>
  );
}

export default function DeckPage() {
  const slideCount = 12;
  return (
    <div className="snap-y snap-mandatory overflow-y-scroll bg-slate-100">
      <style>{`
        html, body { height: 100%; overflow: hidden; }
        @media print {
          html, body { overflow: visible !important; height: auto !important; }
          @page { size: A4 landscape; margin: 0; }
          [data-slide] { box-shadow: none !important; }
        }
      `}</style>

      <KeyboardNav slideCount={slideCount} />

      {/* 1 — Title */}
      <Slide index={0} variant="dark">
        <div className="text-center">
          <p className="text-[12px] font-semibold uppercase tracking-[0.32em] text-blue-400">
            ALDO TECH LABS
          </p>
          <h1 className="mt-6 text-5xl font-semibold tracking-tight text-white sm:text-6xl">
            ALDO&nbsp;AI
          </h1>
          <p className="mt-4 text-xl text-slate-300 sm:text-2xl">
            The control plane for agent teams.
          </p>
          <p className="mt-1 text-sm text-slate-500">
            Privacy enforced by the platform — not the prompt.
          </p>
          <p className="mt-12 font-mono text-[12px] text-slate-500">
            ai.aldo.tech · 2026
          </p>
        </div>
      </Slide>

      {/* 2 — The problem */}
      <Slide index={1} label="The problem">
        <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">
          Your agents are <span className="text-rose-600">one prompt away</span> from a cloud LLM.
        </h2>
        <ul className="mt-8 space-y-4 text-lg text-slate-700">
          <li className="flex gap-3">
            <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-rose-500" />
            <span>
              Privacy is convention, not enforcement. A single careless tool call leaks PHI, PII,
              or trade secrets to a third-party model you don&rsquo;t control.
            </span>
          </li>
          <li className="flex gap-3">
            <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-rose-500" />
            <span>
              Teams glue together <strong>three vendors</strong> — runtime, eval, observability —
              and pay for all of them. The seams leak data and money.
            </span>
          </li>
          <li className="flex gap-3">
            <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-rose-500" />
            <span>
              <strong>Local vs frontier</strong> is impossible to evaluate without rebuilding the
              stack. So you default to cloud — and pay 100× more than you needed to.
            </span>
          </li>
        </ul>
      </Slide>

      {/* 3 — Three real situations */}
      <Slide index={2} label="Three real situations">
        <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">
          We hear the same story across regulated industries.
        </h2>
        <div className="mt-8 grid grid-cols-1 gap-5 lg:grid-cols-3">
          {[
            {
              v: 'Healthcare',
              p: 'Triage agent quietly forwards a patient summary to a cloud LLM via a sub-agent the team forgot to lock down.',
            },
            {
              v: 'Finance',
              p: 'Fraud-classifier crew swaps its underlying model between dev and prod. Compliance has no replayable record.',
            },
            {
              v: 'EU SME',
              p: 'Wants agents but DPA forbids data leaving the EU. US-flavoured platforms need a 6-week DPA review.',
            },
          ].map((c) => (
            <div
              key={c.v}
              className="rounded-xl border border-slate-200 bg-slate-50 p-5"
            >
              <p className="text-[11px] font-semibold uppercase tracking-wider text-blue-700">
                {c.v}
              </p>
              <p className="mt-2 text-base text-slate-700">{c.p}</p>
            </div>
          ))}
        </div>
      </Slide>

      {/* 4 — Our wedge */}
      <Slide index={3} label="The wedge" variant="dark">
        <h2 className="text-3xl font-semibold tracking-tight text-white sm:text-5xl">
          One sentence:{' '}
          <span className="text-blue-400">privacy is enforced by the router</span>, not the prompt.
        </h2>
        <p className="mt-8 text-lg text-slate-300">
          An agent tagged <span className="font-mono text-blue-300">privacy_tier: sensitive</span>{' '}
          is <em>physically</em> incapable of reaching a cloud-class model. The router fails
          closed before any token leaves the tenant boundary.
        </p>
        <p className="mt-4 text-base text-slate-400">
          Nobody else in this category does this. They all leave it to the agent author.
        </p>
      </Slide>

      {/* 5 — Architecture */}
      <Slide index={4} label="How it works">
        <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          One picture. Six moving parts.
        </h2>
        <div className="mt-6 overflow-x-auto rounded-xl border border-slate-200 bg-slate-50 p-4">
          <ArchitectureDiagram />
        </div>
        <p className="mt-3 text-sm text-slate-500">
          Cloud-vs-local is decided by the agent&rsquo;s declared capability class and privacy
          tier. No code path names a provider.
        </p>
      </Slide>

      {/* 6 — Agents are data */}
      <Slide index={5} label="Agents are data">
        <div className="grid grid-cols-1 items-center gap-8 lg:grid-cols-2">
          <div>
            <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">
              An agent is a <span className="text-blue-700">YAML file.</span>
            </h2>
            <p className="mt-5 text-lg text-slate-700">
              Versioned in git. Promoted via eval threshold, not via review-as-vibes. No Python
              class hierarchy to learn.
            </p>
            <ul className="mt-6 space-y-2 text-base text-slate-700">
              <li>· <strong>privacy_tier</strong> — router enforces it</li>
              <li>· <strong>capabilities</strong> — gateway routes on them</li>
              <li>· <strong>tools</strong> — MCP servers, sandboxed</li>
              <li>· <strong>eval</strong> — threshold + rubric, gated promote</li>
            </ul>
          </div>
          <div>
            <HeroCodeSnippet />
          </div>
        </div>
      </Slide>

      {/* 7 — Eval gate */}
      <Slide index={6} label="Eval gate">
        <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">
          The eval threshold <span className="text-blue-700">is the deploy gate.</span>
        </h2>
        <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div className="rounded-xl border border-emerald-300 bg-emerald-50 p-5">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-emerald-700">
              Promote
            </p>
            <p className="mt-2 font-mono text-sm text-emerald-900">
              security-auditor v17 → score 0.91 (≥ 0.85)
            </p>
            <p className="mt-1 text-sm text-emerald-800">Shipped to prod.</p>
          </div>
          <div className="rounded-xl border border-rose-300 bg-rose-50 p-5">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-rose-700">
              Block
            </p>
            <p className="mt-2 font-mono text-sm text-rose-900">
              security-auditor v18 → score 0.78 (&lt; 0.85)
            </p>
            <p className="mt-1 text-sm text-rose-800">Rolled back automatically.</p>
          </div>
        </div>
        <p className="mt-6 text-base text-slate-600">
          No human in the loop for the regression. The same rubric runs in CI and in production —
          one source of truth.
        </p>
      </Slide>

      {/* 8 — Local + cloud, same shape */}
      <Slide index={7} label="Local + cloud, same shape" variant="dark">
        <h2 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl">
          Local models are <span className="text-emerald-400">first-class citizens.</span>
        </h2>
        <p className="mt-6 text-lg text-slate-300">
          Ollama, vLLM, llama.cpp, LM Studio, and MLX (Apple Silicon) are auto-discovered on boot.
          The eval harness compares them against frontier models on the same agent spec.
        </p>
        <p className="mt-3 text-base text-slate-400">
          For most workloads, a tuned 30B-param local model beats a frontier model on cost-per-task
          by <strong>50–200×</strong>. We help you find out which workloads.
        </p>
      </Slide>

      {/* 9 — Replay & audit */}
      <Slide index={8} label="Replay & audit">
        <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">
          Every run is <span className="text-blue-700">replayable</span>. Every blocked dispatch is{' '}
          <span className="text-blue-700">audited.</span>
        </h2>
        <ul className="mt-8 space-y-3 text-base text-slate-700">
          <li>· Full message + tool-call history checkpointed at every supervisor node.</li>
          <li>· Re-execute any step against a different model; diff the output.</li>
          <li>· Every privacy-tier block is a row in the audit log with the reason.</li>
          <li>· Cost rollup at every node — answer "what did this run cost?" in SQL.</li>
        </ul>
        <p className="mt-6 text-base text-slate-600">
          This is what your security and compliance team will ask for. We built it before they
          asked.
        </p>
      </Slide>

      {/* 10 — Comparison */}
      <Slide index={9} label="Cross-compare">
        <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">
          Honest about what we ship.
        </h2>
        <div className="mt-6 overflow-hidden rounded-xl border border-slate-200">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-[11px] uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-3 py-2.5">Capability</th>
                <th className="px-3 py-2.5">ALDO AI</th>
                <th className="px-3 py-2.5">Agent framework</th>
                <th className="px-3 py-2.5">Eval-only</th>
                <th className="px-3 py-2.5">Chat wrapper</th>
              </tr>
            </thead>
            <tbody>
              {[
                ['LLM-agnostic capability routing', 'Yes', 'Per-call', 'n/a', 'No'],
                ['Local-model first-class',         'Yes', 'Possible', 'Limited', 'No'],
                ['Privacy-tier fail-closed',       'Yes', 'No', 'No', 'No'],
                ['Replayable run tree',            'Yes', 'Logs', 'Trace', 'No'],
                ['Eval-gated promotion',           'Yes', 'BYO', 'Yes', 'No'],
                ['Sandboxed tool execution',       'Yes', 'BYO', 'n/a', 'No'],
              ].map((row) => (
                <tr key={row[0]} className="border-t border-slate-100">
                  {row.map((cell, i) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: small static table
                    <td
                      key={i}
                      className={`px-3 py-2.5 ${i === 0 ? 'font-medium text-slate-900' : i === 1 ? 'text-slate-700' : 'text-slate-500'}`}
                    >
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-sm text-slate-500">
          Per-vendor breakdowns at <span className="font-mono">ai.aldo.tech/vs/{'{'}crewai,langsmith,braintrust{'}'}</span>.
        </p>
      </Slide>

      {/* 11 — Pricing & deployment */}
      <Slide index={10} label="Pricing & deployment">
        <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">
          Three plans. Three deployment shapes.
        </h2>
        <div className="mt-8 grid grid-cols-1 gap-4 lg:grid-cols-3">
          {[
            { n: 'Solo',       p: '$29 /mo',  d: '1 user · 100 runs/mo' },
            { n: 'Team',       p: '$99 /mo',  d: '5 users · 1,000 runs/mo · $20 cloud credit', highlight: true },
            { n: 'Enterprise', p: 'Contact', d: 'Unlimited · SSO · self-host · MSA + SLA' },
          ].map((p) => (
            <div
              key={p.n}
              className={`rounded-xl border p-5 ${p.highlight ? 'border-blue-300 bg-blue-50' : 'border-slate-200 bg-white'}`}
            >
              <div className="flex items-baseline justify-between">
                <h3 className="text-lg font-semibold text-slate-900">{p.n}</h3>
                <span className="text-base font-semibold text-slate-800">{p.p}</span>
              </div>
              <p className="mt-2 text-sm text-slate-700">{p.d}</p>
            </div>
          ))}
        </div>
        <p className="mt-6 text-sm text-slate-600">
          Deploy as <strong>cloud</strong> (hosted by us, EU region), <strong>hybrid</strong>{' '}
          (control plane in our cloud, data plane in your VPC), or <strong>self-host</strong>{' '}
          (Enterprise — packaged build, SLA, named owner).
        </p>
      </Slide>

      {/* 12 — Next step */}
      <Slide index={11} variant="dark">
        <div className="text-center">
          <p className="text-[12px] font-semibold uppercase tracking-[0.32em] text-blue-400">
            Next step
          </p>
          <h2 className="mt-6 text-4xl font-semibold tracking-tight text-white sm:text-5xl">
            Try it in 14 days. No card.
          </h2>
          <p className="mt-4 text-lg text-slate-300">
            Or apply to be a design partner — NDA + source access available.
          </p>
          <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
            <Link
              href="/signup"
              className="rounded bg-blue-600 px-5 py-3 text-base font-medium text-white transition-colors hover:bg-blue-700"
            >
              Start free trial
            </Link>
            <Link
              href="/design-partner"
              className="rounded border border-slate-600 bg-transparent px-5 py-3 text-base font-medium text-slate-200 transition-colors hover:bg-slate-800"
            >
              Apply as design partner
            </Link>
          </div>
          <p className="mt-12 font-mono text-[12px] text-slate-500">
            ai.aldo.tech · info@aldo.tech
          </p>
        </div>
      </Slide>
    </div>
  );
}
