/**
 * /vs/braintrust — comparison with Braintrust (eval-first platform).
 *
 * Braintrust is sharper than LangSmith on eval ergonomics — strong
 * playground, fast experiment loop, public scorers. The honest delta:
 * if eval is your single biggest pain, they win on that axis. If you
 * want eval embedded in a runtime that also enforces privacy and
 * orchestrates agents, that is us.
 */

import { VsPage, type VsRow } from '@/components/marketing/vs-page';

export const metadata = {
  title: 'ALDO AI vs Braintrust — agent platform vs eval platform',
  description:
    'Braintrust is the best dedicated eval platform on the market. ALDO AI bundles eval into a full agent runtime with privacy tiers, replay, and local-model support. Honest comparison.',
};

const ROWS: ReadonlyArray<VsRow> = [
  {
    feature: 'Eval ergonomics',
    ours: 'Per-agent threshold + rubric; gated promotion',
    theirs: 'Best-in-class — playground, experiments, scorer SDK',
    verdict: 'them',
  },
  {
    feature: 'Agent runtime',
    ours: 'Yes — gateway, orchestrator, sandbox',
    theirs: 'Not in scope (eval-only)',
    verdict: 'us',
  },
  {
    feature: 'Replayable run tree',
    ours: 'First-class; per-node model swap',
    theirs: 'Trace replay against the eval set',
    verdict: 'tie',
  },
  {
    feature: 'Privacy tier — fail-closed routing',
    ours: 'Yes',
    theirs: 'Out of scope',
    verdict: 'us',
  },
  {
    feature: 'Local models',
    ours: 'Auto-discovered + compared on the same agent spec',
    theirs: 'Supported via OpenAI-compatible endpoints',
    verdict: 'us',
  },
  {
    feature: 'Dataset curation',
    ours: 'Datasets page + import/export',
    theirs: 'Mature dataset + feedback workflows',
    verdict: 'them',
  },
  {
    feature: 'Multi-agent supervisors',
    ours: 'Sequential, parallel, debate, iterative',
    theirs: 'Out of scope',
    verdict: 'us',
  },
  {
    feature: 'Tool execution + sandbox',
    ours: 'Process isolation + scanners',
    theirs: 'Out of scope',
    verdict: 'us',
  },
  {
    feature: 'Self-host',
    ours: 'Enterprise tier — packaged build + SLA',
    theirs: 'Hybrid (data-plane in your VPC) on Enterprise',
    verdict: 'tie',
  },
  {
    feature: 'Pricing transparency',
    ours: 'Public — $29 / $99 / Enterprise',
    theirs: 'Free tier + Pro contact-sales',
    verdict: 'us',
  },
];

export default function VsBraintrustPage() {
  return (
    <VsPage
      competitor="Braintrust"
      competitorTagline="Evaluation, prompt playground, and observability for LLM applications."
      competitorUrl="https://www.braintrust.dev"
      summary="Braintrust is the best dedicated eval product on the market — sharper playground, faster experiment loop, more polished scorer SDK. ALDO AI is not trying to outdo them on eval-as-a-product; it bundles eval into an agent runtime where the eval threshold is what gates promotion. If eval is your only problem, pick Braintrust. If you want eval embedded in a platform that also runs the agents and enforces privacy, pick ALDO AI."
      rows={ROWS}
      whenToPickUs={
        <>
          <p>
            You want eval results to <strong>directly gate promotion</strong> in the runtime, not be
            a parallel signal you have to act on manually.
          </p>
          <p>
            You need privacy tiers, sandboxed tool execution, and multi-agent supervisors in the
            same product as your evals.
          </p>
          <p>
            You're comparing local vs frontier models on the same agent spec — our eval harness does
            this on every run.
          </p>
        </>
      }
      whenToPickThem={
        <>
          <p>
            Eval ergonomics is your single biggest pain — Braintrust&rsquo;s playground and scorer
            SDK genuinely lead the field.
          </p>
          <p>You already have a stable agent runtime and just need world-class evals around it.</p>
          <p>
            Your team treats evals as a product surface (prompt engineers, eval reviewers) rather
            than a CI gate.
          </p>
        </>
      }
      verifiedOn="2026-04-27"
    />
  );
}
