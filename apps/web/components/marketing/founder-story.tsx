/**
 * "Why we built ALDO AI" — short narrative section.
 *
 * Single-column prose, max-width 60ch, no graphics. Voice is direct,
 * no hype. The substance is the four convictions that drove the
 * platform's non-negotiables (CLAUDE.md): provider-agnostic, local
 * models first-class, privacy enforced at the platform, agents-as-data.
 *
 * Sign-off is the org name (ALDO TECH LABS), not an individual founder
 * — the brand is the org.
 *
 * Server-rendered, semantic tokens, no JS. The only flourish is a
 * decorative dropcap on the first paragraph and an opening pull-quote
 * margin so the section reads more like an editorial note than a
 * marketing block.
 */

export function FounderStory() {
  return (
    <section id="why-we-built" className="border-t border-border bg-bg">
      <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6 sm:py-24">
        <div className="mb-10 text-center">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-accent">
            Why we built it
          </p>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight text-fg sm:text-[2.1rem]">
            Why we built ALDO AI
          </h2>
          <div
            aria-hidden
            className="mx-auto mt-6 h-px w-16 bg-gradient-to-r from-transparent via-accent to-transparent"
          />
        </div>

        <div className="space-y-6 text-[16px] leading-[1.75] text-fg">
          <p className="dropcap">
            We were tired of every agent framework hardcoding a provider. Pick one off the shelf and
            you're three commits into a re-implementation before the import statement is finished —
            and a year later, when the SOTA shifts to a different lab, you re-write the
            re-implementation. The thing the framework was supposed to make easy was the thing you'd
            quietly built around it.
          </p>

          <p>
            We were tired of stitching observability and evals and routing and privacy together from
            four different vendors that didn't quite agree on what a "run" was. The bills stacked.
            The dashboards drifted. The contractor who set it up left. And the question "did the new
            prompt make us worse on the suite?" still took an afternoon to answer because the eval
            lived somewhere the trace didn't.
          </p>

          <p>
            We were certain — the way you become certain after a few too many production incidents —
            that local models had to be first-class, not toys. Five real engines, probed at boot,
            with per-model context discovery. Not "and Ollama is supported too." A capability the
            agent declares, a router that picks, and the privacy tier deciding the rest.
          </p>

          <p>
            We were certain, the same way, that privacy had to be enforced by the platform, not by
            the agent author. Convention is a fiction the security review writes onto your design
            doc. The router fails closed before a token leaves your tenant boundary. There is no "I
            forgot to set the flag." There is no flag.
          </p>

          <p>
            And we made a wager. Agents-as-data — YAML in git, eval thresholds in the spec,
            promotion gated on the eval — would beat agents-as-code: the Python class hierarchies,
            the decorators, the runtime monkey-patches. Three waves in, the wager has paid. Every
            wave has shipped what we said it would, the moment the YAML changed.
          </p>

          <p>
            That's what's in the product. That's why we wrote the licence to convert to Apache 2.0
            in two years, not "perpetually proprietary with a permissive vibe." That's why the
            comparison table is honest about where the incumbents win. The platform is the argument.
            The repo is the receipt.
          </p>

          <p className="!mt-10 text-right">
            <span className="rounded-md border border-border bg-bg-elevated px-3 py-1 font-mono text-[12px] text-fg-muted">
              — ALDO TECH LABS
            </span>
          </p>
        </div>
      </div>
    </section>
  );
}
