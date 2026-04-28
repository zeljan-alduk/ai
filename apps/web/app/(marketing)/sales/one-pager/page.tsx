/**
 * /sales/one-pager — single-page A4-print-ready customer pitch.
 *
 * Designed for "cmd-P, save as PDF, attach to cold email". The print
 * stylesheet hides the marketing nav + footer and sets the document
 * to A4 portrait, fitting on one physical page at 100% zoom.
 *
 * No fake numbers. No unverifiable claims. Last-verified date is
 * baked in and matched against the homepage table.
 */

import Link from 'next/link';

const VERIFIED_ON = '2026-04-27';

export const metadata = {
  title: 'ALDO AI — one-pager',
  description: 'Single-page customer pitch. Privacy-tier-enforced agent platform.',
  robots: { index: false, follow: false },
};

export default function OnePagerPage() {
  return (
    <>
      {/* Print stylesheet — hide chrome, force A4. */}
      <style>{`
        @media print {
          @page { size: A4 portrait; margin: 12mm; }
          html, body { background: #fff !important; }
          header[data-marketing-nav], footer[data-marketing-footer], nav { display: none !important; }
          a { color: inherit !important; text-decoration: none !important; }
          .no-print { display: none !important; }
          .print-shadow-none { box-shadow: none !important; }
          .print-border-none { border: 0 !important; }
        }
      `}</style>

      <div className="no-print mx-auto max-w-3xl px-4 pt-8 sm:px-6">
        <div className="flex items-center justify-between rounded-md border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">
          <span>
            <strong>One-pager.</strong> Press{' '}
            <kbd className="rounded border border-blue-300 bg-white px-1.5 py-0.5 text-xs">⌘ P</kbd>{' '}
            /
            <kbd className="ml-1 rounded border border-blue-300 bg-white px-1.5 py-0.5 text-xs">
              Ctrl P
            </kbd>{' '}
            then "Save as PDF" — A4 portrait, one page.
          </span>
          <Link href="/sales" className="text-blue-700 hover:underline">
            ← back to sales kit
          </Link>
        </div>
      </div>

      <article className="mx-auto my-6 max-w-[800px] bg-white px-10 py-10 text-[12.5px] leading-[1.55] text-slate-800 shadow-sm sm:my-10 print-shadow-none print-border-none border border-slate-200">
        {/* Header */}
        <header className="border-b border-slate-200 pb-4">
          <div className="flex items-baseline justify-between">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-blue-700">
                ALDO TECH LABS
              </p>
              <h1 className="mt-1 text-[22px] font-semibold tracking-tight text-slate-900">
                ALDO&nbsp;AI
              </h1>
              <p className="mt-1 text-[13px] text-slate-600">
                The control plane for agent teams — privacy enforced by the platform.
              </p>
            </div>
            <div className="text-right text-[11px] text-slate-500">
              <p>ai.aldo.tech</p>
              <p>info@aldo.tech</p>
            </div>
          </div>
        </header>

        {/* Pitch */}
        <section className="mt-4">
          <p className="text-[12.5px] leading-[1.55] text-slate-800">
            ALDO AI is the agent platform your security team can sign off on. Run real
            software-engineering teams of LLM agents with{' '}
            <strong>privacy enforced by the router, not the prompt</strong>; local models
            first-class; eval-gated promotion; every run replayable end-to-end.
          </p>
        </section>

        {/* Three columns: problem / solution / proof */}
        <section className="mt-4 grid grid-cols-3 gap-4">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              The problem
            </p>
            <ul className="mt-1.5 space-y-1.5 text-[11.5px] leading-snug text-slate-700">
              <li>
                Agents that touch sensitive data are <strong>one prompt away</strong> from a cloud
                LLM. Privacy is convention, not enforcement.
              </li>
              <li>
                Teams glue together 3+ vendors (runtime + eval + observability) and pay for all of
                them.
              </li>
              <li>
                Local-vs-frontier model choice is impossible to evaluate without rebuilding the
                stack.
              </li>
            </ul>
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              What we ship
            </p>
            <ul className="mt-1.5 space-y-1.5 text-[11.5px] leading-snug text-slate-700">
              <li>
                <strong>Privacy-tier router</strong> — sensitive agents are physically incapable of
                reaching a cloud model. Fails closed.
              </li>
              <li>
                <strong>Local + cloud, same eval.</strong> Auto-discovers Ollama / vLLM / llama.cpp
                / MLX. Same rubric, side-by-side.
              </li>
              <li>
                <strong>Replayable run tree.</strong> Every node, every tool call, swap any model,
                diff the output.
              </li>
              <li>
                <strong>Sandboxed tools (MCP).</strong> Process isolation + prompt-injection +
                output scanner.
              </li>
            </ul>
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              Why us, not them
            </p>
            <ul className="mt-1.5 space-y-1.5 text-[11.5px] leading-snug text-slate-700">
              <li>
                <strong>vs CrewAI</strong> — they ship a framework; we ship the platform around it.
              </li>
              <li>
                <strong>vs LangSmith</strong> — they observe; we enforce + observe + run.
              </li>
              <li>
                <strong>vs Braintrust</strong> — their evals are sharper; ours gate the deploy.
              </li>
              <li>
                Detailed comparisons at <span className="font-mono">ai.aldo.tech/vs/*</span>.
              </li>
            </ul>
          </div>
        </section>

        {/* Pricing strip */}
        <section className="mt-4 grid grid-cols-3 gap-3">
          {[
            {
              name: 'Solo',
              price: '$29 /mo',
              for: 'one builder',
              features: [
                '1 user · 100 runs/mo',
                'BYO provider keys',
                'Local models out of the box',
              ],
            },
            {
              name: 'Team',
              price: '$99 /mo',
              for: 'small team running a real agency',
              features: [
                '5 users · 1,000 runs/mo',
                'Role-based access',
                '$20 cloud credit included',
              ],
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
              className={`rounded-md border p-3 ${p.highlight ? 'border-blue-300 bg-blue-50/40' : 'border-slate-200 bg-slate-50/60'}`}
            >
              <div className="flex items-baseline justify-between">
                <h3 className="text-[12px] font-semibold text-slate-900">{p.name}</h3>
                <span className="text-[12px] font-semibold text-slate-800">{p.price}</span>
              </div>
              <p className="mt-0.5 text-[10.5px] text-slate-600">For {p.for}.</p>
              <ul className="mt-1.5 space-y-0.5 text-[10.5px] leading-snug text-slate-700">
                {p.features.map((f) => (
                  <li key={f}>· {f}</li>
                ))}
              </ul>
            </div>
          ))}
        </section>

        {/* Architecture micro-diagram (text version, prints predictably) */}
        <section className="mt-4 rounded-md border border-slate-200 bg-slate-50/40 p-3">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
            Architecture (one line)
          </p>
          <p className="mt-1 font-mono text-[11px] leading-relaxed text-slate-700">
            web · CLI · SDK &nbsp;→&nbsp; <strong>API gateway</strong> (auth · quotas) &nbsp;→&nbsp;{' '}
            <strong>privacy-tier router</strong> (public · internal · sensitive) &nbsp;→&nbsp; cloud
            capabilities ⊕ local capabilities &nbsp;|&nbsp; eval harness ⊕ replay store
          </p>
        </section>

        {/* CTA + footer */}
        <section className="mt-5 flex items-center justify-between rounded-md border border-blue-200 bg-blue-50 p-3">
          <div>
            <p className="text-[12px] font-semibold text-blue-900">Try it in 14 days, no card.</p>
            <p className="text-[11px] text-blue-800">
              Or apply to be a design partner — NDA + source access available.
            </p>
          </div>
          <p className="text-right text-[11px] text-blue-900">
            <strong>ai.aldo.tech/signup</strong>
            <br />
            info@aldo.tech
          </p>
        </section>

        <footer className="mt-4 border-t border-slate-200 pt-2 text-[9.5px] text-slate-500">
          ALDO TECH LABS · ALDO AI is proprietary. Last verified: {VERIFIED_ON}. All comparison
          claims are limited to what we ship today (no roadmap items).
        </footer>
      </article>
    </>
  );
}
