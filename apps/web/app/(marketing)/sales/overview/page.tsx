/**
 * /sales/overview — long-form overview document.
 *
 * For prospects who want to understand the platform before booking a
 * call. Designed to be read on screen OR printed to PDF (multi-page).
 * Uses prose typography for legibility; sections are anchor-linked
 * so customers can deep-link a specific section in a follow-up email.
 */

import { ArchitectureDiagram } from '@/components/marketing/architecture-diagram';
import Link from 'next/link';

const VERIFIED_ON = '2026-04-27';

export const metadata = {
  title: 'ALDO AI — overview',
  description: 'Long-form customer overview: problem, architecture, comparison, deployment.',
  robots: { index: false, follow: false },
};

const TOC = [
  { id: 'summary', label: '1. Executive summary' },
  { id: 'problem', label: '2. The problem' },
  { id: 'approach', label: '3. Our approach' },
  { id: 'architecture', label: '4. Architecture' },
  { id: 'comparison', label: '5. Cross-compare' },
  { id: 'pricing', label: '6. Pricing & deployment' },
  { id: 'security', label: '7. Security posture' },
  { id: 'next', label: '8. Getting started' },
];

const VIGNETTES = [
  {
    sector: 'Healthcare',
    pain: 'A patient-triage agent leaks PHI to a cloud LLM via a sub-agent the team forgot to lock down.',
    aldo: 'The triage agent is tagged privacy_tier: sensitive at the spec layer. The router refuses to dispatch any of its tool calls or sub-agents to a non-local model. Audit log captures every blocked attempt.',
  },
  {
    sector: 'Finance',
    pain: 'A fraud-classifier crew quietly switches its underlying model between dev and prod. Compliance has no replayable record of which model produced which decision.',
    aldo: 'Every run is checkpointed with the model identity at every node. Replay any decision, swap the model, diff the outcome. Audit log is the source of truth.',
  },
  {
    sector: 'EU SME under GDPR',
    pain: 'You want to use agents but your DPA forbids data leaving the EU, and US-flavoured platforms require trust + a long DPA review.',
    aldo: 'Self-host the packaged build inside your own VPC or on a Hetzner box in Frankfurt. Same product as the cloud tenants. Local models cover most workloads; cloud only for the public tier.',
  },
];

const PILLARS = [
  {
    title: 'LLM-agnostic by construction',
    body: 'No code path names a provider. Agents declare capability classes (reasoning-strong, vision, embed-fast). The gateway picks the model. Switching providers is a config change, never a code change.',
  },
  {
    title: 'Local models are first-class',
    body: 'Ollama, vLLM, llama.cpp, LM Studio, and MLX (Apple Silicon) are auto-discovered on boot. The eval harness compares frontier and local on the same agent spec, so model choice is data-driven.',
  },
  {
    title: 'Privacy tiers enforced by the platform',
    body: 'public / internal / sensitive. Sensitive agents are physically incapable of dispatching to a cloud-class model — the router fails closed before any token leaves the tenant boundary.',
  },
  {
    title: 'Agents are data',
    body: 'Defined in YAML. Versioned in git. Promoted via eval threshold, not via review-as-vibes. No Python class hierarchy to learn.',
  },
  {
    title: 'Every run is replayable',
    body: 'Full message and tool-call history is checkpointed at every node of the supervisor tree. Re-execute any step against a different model and diff the output.',
  },
  {
    title: 'MCP-first tools',
    body: 'We prefer MCP (Model Context Protocol) servers over bespoke tool code so your tool surface is portable across runtimes. Process isolation, prompt-injection scanner, output scanner all default-on.',
  },
];

const COMPARE = [
  { feature: 'LLM-agnostic capability routing',     aldo: 'Yes', framework: 'Per-call', wrapper: 'No' },
  { feature: 'Local-model first-class',             aldo: 'Yes', framework: 'Possible', wrapper: 'No' },
  { feature: 'Privacy tier — fail-closed router',   aldo: 'Yes', framework: 'No',       wrapper: 'No' },
  { feature: 'Replayable run tree',                 aldo: 'Yes', framework: 'Logs',     wrapper: 'No' },
  { feature: 'Sandboxed tool execution',            aldo: 'Yes', framework: 'BYO',      wrapper: 'No' },
  { feature: 'Eval-gated promotion',                aldo: 'Yes', framework: 'BYO',      wrapper: 'No' },
];

export default function OverviewPage() {
  return (
    <>
      <style>{`
        @media print {
          @page { size: A4 portrait; margin: 14mm; }
          html, body { background: #fff !important; }
          .no-print { display: none !important; }
          .print-shadow-none { box-shadow: none !important; }
          a { color: inherit !important; text-decoration: none !important; }
          h2 { break-after: avoid; }
          section { break-inside: avoid-page; }
        }
      `}</style>

      <div className="no-print mx-auto max-w-3xl px-4 pt-8 sm:px-6">
        <div className="flex items-center justify-between rounded-md border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">
          <span>
            <strong>Overview.</strong> Long-form for deeper research. ⌘ P / Ctrl P to save as PDF.
          </span>
          <Link href="/sales" className="text-blue-700 hover:underline">
            ← back to sales kit
          </Link>
        </div>
      </div>

      <article className="mx-auto my-8 max-w-3xl bg-white px-6 py-8 text-[14px] leading-relaxed text-slate-800 shadow-sm sm:my-12 sm:px-10 sm:py-12 print-shadow-none">
        {/* Title block */}
        <header>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-blue-700">
            ALDO TECH LABS — Customer overview
          </p>
          <h1 className="mt-2 text-[34px] font-semibold leading-tight tracking-tight text-slate-900">
            ALDO&nbsp;AI
          </h1>
          <p className="mt-1 text-[16px] text-slate-600">
            The control plane for agent teams — privacy enforced by the platform.
          </p>
        </header>

        {/* TOC */}
        <nav className="mt-8 rounded-lg border border-slate-200 bg-slate-50/60 p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
            Contents
          </p>
          <ol className="mt-2 grid grid-cols-1 gap-y-1 text-[13px] sm:grid-cols-2">
            {TOC.map((t) => (
              <li key={t.id}>
                <a href={`#${t.id}`} className="text-slate-700 hover:text-blue-700">
                  {t.label}
                </a>
              </li>
            ))}
          </ol>
        </nav>

        {/* 1. Executive summary */}
        <section id="summary" className="mt-12">
          <h2 className="text-[22px] font-semibold tracking-tight text-slate-900">
            1. Executive summary
          </h2>
          <p className="mt-3">
            ALDO AI is the agent platform privacy and compliance teams can sign off on. We run real
            software-engineering teams of LLM agents — principal, architect, engineers, reviewers —
            and the platform is what we built to make that practical at production scale: a
            privacy-tier router that fails closed, an eval harness that gates promotion,
            replayable run trees for audit, and local-model parity with frontier models on the
            same agent spec.
          </p>
          <p className="mt-3">
            The closest competitors ship one half of this — either an agent framework (CrewAI,
            LangGraph) or an eval / observability product (LangSmith, Braintrust). ALDO AI ships
            the whole control plane on the same primitive, so privacy invariants are
            platform-level, not author discipline.
          </p>
        </section>

        {/* 2. Problem */}
        <section id="problem" className="mt-12">
          <h2 className="text-[22px] font-semibold tracking-tight text-slate-900">
            2. The problem
          </h2>
          <p className="mt-3">
            Three vignettes, drawn from conversations with prospects in regulated industries. Names
            anonymised; the patterns are real and recurring.
          </p>
          <div className="mt-5 space-y-4">
            {VIGNETTES.map((v) => (
              <div
                key={v.sector}
                className="rounded-lg border border-slate-200 bg-white p-4"
              >
                <p className="text-[11px] font-semibold uppercase tracking-wider text-blue-700">
                  {v.sector}
                </p>
                <p className="mt-1.5 text-[13.5px]">
                  <strong>The pain.</strong> {v.pain}
                </p>
                <p className="mt-2 text-[13.5px] text-slate-700">
                  <strong>How ALDO AI handles it.</strong> {v.aldo}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* 3. Approach */}
        <section id="approach" className="mt-12">
          <h2 className="text-[22px] font-semibold tracking-tight text-slate-900">
            3. Our approach — six non-negotiables
          </h2>
          <p className="mt-3">
            These shape every line of code in the platform. They&rsquo;re also the reason most
            features in our roadmap are short:&nbsp;the constraints do most of the work.
          </p>
          <ul className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
            {PILLARS.map((p) => (
              <li
                key={p.title}
                className="rounded-lg border border-slate-200 bg-white p-4"
              >
                <h3 className="text-[14px] font-semibold text-slate-900">{p.title}</h3>
                <p className="mt-1.5 text-[13px] leading-relaxed text-slate-700">{p.body}</p>
              </li>
            ))}
          </ul>
        </section>

        {/* 4. Architecture */}
        <section id="architecture" className="mt-12">
          <h2 className="text-[22px] font-semibold tracking-tight text-slate-900">
            4. Architecture
          </h2>
          <p className="mt-3">
            Three client surfaces — web, CLI, SDK — all hit the same gateway. The gateway
            authenticates, enforces quotas and rate-limits, then hands the request to the
            privacy-tier router. The router is the single chokepoint that decides whether a
            request can dispatch to a cloud-class model. Eval harness and replay store hang off
            the gateway; nothing bypasses them.
          </p>
          <div className="mt-5 overflow-x-auto rounded-lg border border-slate-200 bg-slate-50 p-4">
            <ArchitectureDiagram />
          </div>
          <p className="mt-3 text-[12px] text-slate-500">
            Cloud-vs-local is decided by the agent&rsquo;s declared capability class and privacy
            tier. No code path names a provider.
          </p>
        </section>

        {/* 5. Comparison */}
        <section id="comparison" className="mt-12">
          <h2 className="text-[22px] font-semibold tracking-tight text-slate-900">
            5. Cross-compare
          </h2>
          <p className="mt-3">
            Three categories of incumbent: general-purpose agent frameworks (CrewAI, LangGraph,
            LlamaIndex), eval/obs products (LangSmith, Braintrust), and chat-wrapper apps. We
            compare only what we ship today.
          </p>
          <div className="mt-5 overflow-x-auto rounded-lg border border-slate-200 bg-white">
            <table className="w-full text-left text-[13px]">
              <thead className="bg-slate-50 text-[11px] uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-3 py-2.5">Capability</th>
                  <th className="px-3 py-2.5">ALDO AI</th>
                  <th className="px-3 py-2.5">Agent framework</th>
                  <th className="px-3 py-2.5">Chat wrapper</th>
                </tr>
              </thead>
              <tbody>
                {COMPARE.map((r) => (
                  <tr key={r.feature} className="border-t border-slate-100">
                    <td className="px-3 py-2.5 font-medium text-slate-900">{r.feature}</td>
                    <td className="px-3 py-2.5 text-slate-700">{r.aldo}</td>
                    <td className="px-3 py-2.5 text-slate-500">{r.framework}</td>
                    <td className="px-3 py-2.5 text-slate-500">{r.wrapper}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-[12px] text-slate-500">
            Per-vendor breakdowns at{' '}
            <Link href="/vs/crewai" className="underline hover:text-blue-700">
              /vs/crewai
            </Link>
            ,{' '}
            <Link href="/vs/langsmith" className="underline hover:text-blue-700">
              /vs/langsmith
            </Link>
            , and{' '}
            <Link href="/vs/braintrust" className="underline hover:text-blue-700">
              /vs/braintrust
            </Link>
            . Each names a category where the competitor wins.
          </p>
        </section>

        {/* 6. Pricing & deployment */}
        <section id="pricing" className="mt-12">
          <h2 className="text-[22px] font-semibold tracking-tight text-slate-900">
            6. Pricing & deployment
          </h2>
          <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
            {[
              {
                name: 'Solo',
                price: '$29 / mo',
                for: 'one builder',
                features: ['1 user · 100 runs/mo', 'BYO provider keys', 'All privacy tiers'],
              },
              {
                name: 'Team',
                price: '$99 / mo',
                for: 'small team running a real agency',
                features: ['5 users · 1,000 runs/mo', 'Role-based access', '$20 cloud credit'],
                highlight: true,
              },
              {
                name: 'Enterprise',
                price: 'Contact',
                for: 'compliance, SSO, self-host',
                features: ['Unlimited · SSO/SAML', 'Self-host packaged build', 'Custom MSA + SLA'],
              },
            ].map((p) => (
              <div
                key={p.name}
                className={`rounded-lg border p-4 ${p.highlight ? 'border-blue-300 bg-blue-50/40' : 'border-slate-200 bg-white'}`}
              >
                <div className="flex items-baseline justify-between">
                  <h3 className="text-[14px] font-semibold text-slate-900">{p.name}</h3>
                  <span className="text-[14px] font-semibold text-slate-800">{p.price}</span>
                </div>
                <p className="mt-1 text-[12px] text-slate-600">For {p.for}.</p>
                <ul className="mt-2 space-y-1 text-[12.5px] leading-snug text-slate-700">
                  {p.features.map((f) => (
                    <li key={f}>· {f}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <p className="mt-4 text-[13px]">
            Three deployment shapes:
          </p>
          <ul className="mt-2 space-y-1.5 text-[13px] text-slate-700">
            <li>
              <strong>Cloud (default).</strong> Hosted by us at{' '}
              <span className="font-mono">ai.aldo.tech</span>. EU region.
            </li>
            <li>
              <strong>Hybrid.</strong> Control plane in our cloud; data plane in your VPC. Private
              traffic never leaves your boundary.
            </li>
            <li>
              <strong>Self-host (Enterprise).</strong> Packaged build to your infrastructure,
              dedicated support, SLA. Same product as the cloud tenants.
            </li>
          </ul>
        </section>

        {/* 7. Security */}
        <section id="security" className="mt-12">
          <h2 className="text-[22px] font-semibold tracking-tight text-slate-900">
            7. Security posture
          </h2>
          <p className="mt-3 text-[13.5px]">
            What we offer today, what&rsquo;s on the near roadmap, and what we won&rsquo;t claim.
          </p>
          <ul className="mt-3 space-y-2 text-[13.5px] text-slate-700">
            <li>
              <strong>Today:</strong> per-tenant encryption at rest; TLS in transit; secrets
              encrypted with a per-tenant key; sandboxed tool execution; audit log of every run +
              every blocked privacy-tier dispatch.
            </li>
            <li>
              <strong>On request:</strong> SAML SSO; SCIM provisioning; data-residency lock to a
              named region; signed DPAs; self-host build with a customer-controlled key.
            </li>
            <li>
              <strong>In progress:</strong> SOC 2 Type 1 (first audit window opens this year). We
              will not put a SOC 2 logo on a slide before the report is in hand.
            </li>
            <li>
              <strong>What we won&rsquo;t claim:</strong> HIPAA-covered, FedRAMP, ISO 27001 today.
              If your procurement requires those, talk to us — design partners get a path.
            </li>
          </ul>
        </section>

        {/* 8. Next */}
        <section id="next" className="mt-12">
          <h2 className="text-[22px] font-semibold tracking-tight text-slate-900">
            8. Getting started
          </h2>
          <ol className="mt-3 space-y-2 text-[13.5px] text-slate-700">
            <li>
              <strong>1. Trial.</strong> 14 days, no card. Spin up a tenant at{' '}
              <span className="font-mono">ai.aldo.tech/signup</span>. The default agency template
              ships seeded — try a real agent on real local models in under five minutes.
            </li>
            <li>
              <strong>2. Design partner.</strong> If your team needs to influence the roadmap or
              wants source access under NDA, apply at{' '}
              <span className="font-mono">ai.aldo.tech/design-partner</span>.
            </li>
            <li>
              <strong>3. Enterprise pilot.</strong> 60-day paid pilot with named owner on our side,
              your security questionnaire, your DPA. Email{' '}
              <span className="font-mono">info@aldo.tech</span>.
            </li>
          </ol>
        </section>

        <footer className="mt-12 border-t border-slate-200 pt-4 text-[11px] text-slate-500">
          Last verified: {VERIFIED_ON}. ALDO TECH LABS · ai.aldo.tech · info@aldo.tech ·
          Comparison rows re-verified quarterly; if a row is out of date, email us and we&rsquo;ll
          fix it in the next deploy.
        </footer>
      </article>
    </>
  );
}
