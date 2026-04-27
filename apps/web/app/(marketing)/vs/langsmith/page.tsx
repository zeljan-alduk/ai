/**
 * /vs/langsmith — comparison with LangSmith (LangChain's eval +
 * observability product).
 *
 * The honest framing: LangSmith is "eval + observability for whatever
 * agent stack you have"; ALDO AI is "the agent stack with eval +
 * observability already wired in". You can use both — the question is
 * whether you want one tool or three.
 */

import { VsPage, type VsRow } from '@/components/marketing/vs-page';

export const metadata = {
  title: 'ALDO AI vs LangSmith — agent platform vs eval-only',
  description:
    'LangSmith is observability and eval bolted onto whatever agent stack you have. ALDO AI is the agent stack with both built in. Honest cross-compare.',
};

const ROWS: ReadonlyArray<VsRow> = [
  {
    feature: 'Agent runtime',
    ours: 'Yes — orchestrator, supervisors, sandbox, gateway',
    theirs: 'No — bring your own (LangChain / LangGraph)',
    verdict: 'us',
  },
  {
    feature: 'Replayable run tree',
    ours: 'First-class; per-node model swap',
    theirs: 'Trace replay; ties to LangChain runnables',
    verdict: 'tie',
  },
  {
    feature: 'Eval harness',
    ours: 'Bundled — rubric, threshold, gated promotion',
    theirs: 'First-class — datasets, evaluators, experiments',
    verdict: 'tie',
  },
  {
    feature: 'Privacy tier — fail-closed routing',
    ours: 'Yes — router drops sensitive → cloud',
    theirs: 'Not in scope (observability layer)',
    verdict: 'us',
  },
  {
    feature: 'Local models first-class',
    ours: 'Auto-discovered + compared in eval',
    theirs: 'Whatever your runtime supports',
    verdict: 'us',
  },
  {
    feature: 'LLM-agnostic',
    ours: 'Capability-class routing; no vendor in code',
    theirs: 'Vendor-agnostic ingestion; LangChain-shaped',
    verdict: 'us',
  },
  {
    feature: 'Tool execution + sandbox',
    ours: 'Process isolation + scanners',
    theirs: 'Out of scope',
    verdict: 'us',
  },
  {
    feature: 'Production tracing / observability',
    ours: 'Built in; cost rollup at every supervisor node',
    theirs: 'Best-in-class — long-tail of integrations',
    verdict: 'them',
  },
  {
    feature: 'Dataset capture & curation UI',
    ours: 'Datasets + evals page',
    theirs: 'Mature dataset/feedback UI',
    verdict: 'them',
  },
  {
    feature: 'Self-host',
    ours: 'Enterprise tier — packaged build + SLA',
    theirs: 'Self-hosted Smith (paid plan)',
    verdict: 'tie',
  },
  {
    feature: 'Pricing transparency',
    ours: 'Public — $29 / $99 / Enterprise',
    theirs: 'Public per-trace + per-seat tiers',
    verdict: 'tie',
  },
];

export default function VsLangsmithPage() {
  return (
    <VsPage
      competitor="LangSmith"
      competitorTagline="Observability, evals, and dataset curation for LLM apps from the LangChain team."
      competitorUrl="https://smith.langchain.com"
      summary="LangSmith is an eval + observability product that sits next to whatever agent stack you have. ALDO AI is the agent stack itself, with eval + observability built in. They are not the same shape — LangSmith is broader at observability; ALDO AI is broader at runtime. The honest question is whether you want to glue three vendors together or one platform end-to-end."
      rows={ROWS}
      whenToPickUs={
        <>
          <p>
            You want one platform, not three (runtime + eval + observability stitched together).
          </p>
          <p>
            You need <strong>privacy tiers enforced at the router</strong> — LangSmith only
            <em> sees</em> the traffic, it cannot block it.
          </p>
          <p>
            You're starting fresh and don't already have a LangChain-shaped codebase to plug into.
          </p>
        </>
      }
      whenToPickThem={
        <>
          <p>
            You already have a meaningful LangChain / LangGraph deployment and need eval +
            observability around it without rewriting.
          </p>
          <p>
            Your eval and observability needs are heavier than your agent runtime needs.
          </p>
          <p>
            You need the long tail of LangChain ecosystem integrations.
          </p>
        </>
      }
      verifiedOn="2026-04-27"
    />
  );
}
