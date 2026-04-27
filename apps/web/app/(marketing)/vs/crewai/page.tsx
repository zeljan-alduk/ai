/**
 * /vs/crewai — comparison with CrewAI.
 *
 * CrewAI is the closest in framing ("teams of agents" + YAML specs).
 * The honest delta is mostly enforcement: privacy tiers, fail-closed
 * routing, eval-gated promotion are platform-level in ours; in CrewAI
 * they are conventions on top of the framework.
 */

import { VsPage, type VsRow } from '@/components/marketing/vs-page';

export const metadata = {
  title: 'ALDO AI vs CrewAI — control plane vs framework',
  description:
    'Honest, side-by-side comparison: CrewAI is a great agent framework. ALDO AI adds the platform layer — privacy tiers enforced by the router, eval gating, replayable runs, and self-host.',
};

const ROWS: ReadonlyArray<VsRow> = [
  {
    feature: 'Agents-as-data (YAML specs)',
    ours: 'Yes — versioned, promoted via eval gate',
    theirs: 'Yes — Python or YAML',
    verdict: 'tie',
  },
  {
    feature: 'LLM-agnostic routing',
    ours: 'Capability-class routing in the gateway; no provider in code',
    theirs: 'Per-call provider config (LiteLLM)',
    verdict: 'us',
  },
  {
    feature: 'Local models first-class',
    ours: 'Auto-discovered (Ollama, vLLM, llama.cpp, MLX); compared in eval',
    theirs: 'Possible via LiteLLM but not first-class',
    verdict: 'us',
  },
  {
    feature: 'Privacy tier — fail-closed router',
    ours: 'Sensitive agents physically cannot reach a cloud model',
    theirs: 'Author convention, not enforced',
    verdict: 'us',
  },
  {
    feature: 'Eval-gated promotion',
    ours: 'Threshold + rubric per agent; promotion blocked on regression',
    theirs: 'Eval lib exists; not gated by the runtime',
    verdict: 'us',
  },
  {
    feature: 'Replayable run tree',
    ours: 'Every node, every tool call; per-node model swap',
    theirs: 'Logs + telemetry; no canonical replay primitive',
    verdict: 'us',
  },
  {
    feature: 'Multi-agent supervisors',
    ours: 'Sequential, parallel, debate, iterative — built-in',
    theirs: 'Sequential + hierarchical processes built-in',
    verdict: 'tie',
  },
  {
    feature: 'Tool standard',
    ours: 'MCP-first; bespoke tools allowed but discouraged',
    theirs: 'Custom tools + LangChain tools',
    verdict: 'us',
  },
  {
    feature: 'Sandboxed tool execution',
    ours: 'Process isolation + prompt-injection scanner + output scanner',
    theirs: 'BYO',
    verdict: 'us',
  },
  {
    feature: 'Hosted UI / dashboards',
    ours: 'Yes — runs, datasets, evals, observability',
    theirs: 'Crew Enterprise (separate product)',
    verdict: 'tie',
  },
  {
    feature: 'Self-host',
    ours: 'Enterprise tier — packaged build + SLA',
    theirs: 'OSS framework; Crew Enterprise on request',
    verdict: 'tie',
  },
  {
    feature: 'License',
    ours: 'Proprietary (source-available to design partners + Enterprise)',
    theirs: 'MIT (framework) + commercial (Enterprise)',
    verdict: 'them',
  },
  {
    feature: 'Pricing transparency',
    ours: 'Public — $29 Solo / $99 Team / Enterprise contact',
    theirs: 'Cloud free + Enterprise contact-sales',
    verdict: 'us',
  },
];

export default function VsCrewaiPage() {
  return (
    <VsPage
      competitor="CrewAI"
      competitorTagline="Open-source framework for orchestrating role-playing autonomous AI agents."
      competitorUrl="https://www.crewai.com"
      summary="CrewAI is a great agent framework. ALDO AI sits one layer up: it is the platform around your agents — privacy tiers enforced by the router, eval gating, replayable runs, sandboxed tools, all on the same primitive. If you want a library, pick CrewAI. If you want a control plane your security team can sign off on, pick ALDO AI."
      rows={ROWS}
      whenToPickUs={
        <>
          <p>
            Your agents touch sensitive data and a single accidental cloud call is unacceptable —
            you need <strong>fail-closed routing</strong>, not author discipline.
          </p>
          <p>
            You want every agent change to be eval-gated automatically before it ships, not on a
            best-effort CI step.
          </p>
          <p>
            You want self-host on Enterprise, with the same product the cloud tenants use, not a
            separate "enterprise" SKU.
          </p>
        </>
      }
      whenToPickThem={
        <>
          <p>
            You want a fully open-source dependency you can fork and modify in-place.
          </p>
          <p>
            Your team is mostly Python and you want the agent layer in the same codebase as the
            rest of your stack.
          </p>
          <p>
            Privacy tier and eval-gating are nice-to-haves, not non-negotiables.
          </p>
        </>
      }
      verifiedOn="2026-04-27"
    />
  );
}
