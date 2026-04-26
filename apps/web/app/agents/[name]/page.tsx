/**
 * /agents/[name] — agent detail (wave-12 redesign).
 *
 * Header card carries avatar + identity + version + privacy. Below it,
 * a Tabs surface (S's primitive) splits the page into:
 *   - Spec      : pretty-printed YAML (js-yaml.dump on the JSON spec)
 *   - Safety    : the existing wave-7.5 sandbox/guards panels
 *   - Composite : visual diagram (composite-diagram.tsx) or "leaf" hint
 *   - Eval      : per-suite + per-model Recharts pulls (eval-analytics)
 *   - Runs      : last-20 runs of THIS agent in a tight table
 *
 * LLM-agnostic: model strings render verbatim; capability badges are
 * the agent's tags.
 */

import { PolicyPanels } from '@/components/agent/policy-panels';
import { RoutingDryRunCard } from '@/components/agent/routing-dry-run-card';
import { AgentAvatar } from '@/components/agents/agent-avatar';
import { AgentDetailTabs } from '@/components/agents/agent-detail-tabs';
import { AgentRunsPanel } from '@/components/agents/agent-runs-panel';
import { CompositeDiagram } from '@/components/agents/composite-diagram';
import { EvalAnalytics } from '@/components/agents/eval-analytics';
import { CommentsThread } from '@/components/annotations/comments-thread';
import { NeutralBadge, PrivacyBadge } from '@/components/badge';
import { ErrorView } from '@/components/error-boundary';
import { PageHeader } from '@/components/page-header';
import { ShareDialog } from '@/components/shares/share-dialog';
import { Card } from '@/components/ui/card';
import { getAgent, getAuthMe, listAgents, listAnnotationsApi } from '@/lib/api';
import type { Annotation } from '@aldo-ai/api-contract';
import yaml from 'js-yaml';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

export default async function AgentDetailPage({
  params,
}: {
  params: Promise<{ name: string }>;
}) {
  const { name } = await params;
  const decoded = decodeURIComponent(name);

  let data: Awaited<ReturnType<typeof getAgent>> | null = null;
  let knownAgents: ReadonlyArray<string> = [];
  let error: unknown = null;
  try {
    const [d, list] = await Promise.all([getAgent(decoded), listAgents({ limit: 200 })]);
    data = d;
    knownAgents = list.agents.map((a) => a.name);
  } catch (err) {
    error = err;
  }

  // Wave-14 (Engineer 14D): annotations + auth-me prefetch.
  let initialAnnotations: readonly Annotation[] = [];
  let currentUserId = '';
  let currentUserEmail = '';
  if (data !== null) {
    try {
      const [annResp, me] = await Promise.all([
        listAnnotationsApi({ targetKind: 'agent', targetId: decoded }),
        getAuthMe(),
      ]);
      initialAnnotations = annResp.annotations;
      currentUserId = me.user.id;
      currentUserEmail = me.user.email;
    } catch {
      // ignore
    }
  }

  return (
    <>
      <PageHeader
        title={decoded}
        description="Agent identity, spec, safety policy, composite diagram, eval analytics, and recent runs."
        actions={
          <>
            <ShareDialog targetKind="agent" targetId={decoded} />
            <Link
              href="/agents"
              className="rounded border border-slate-300 bg-white px-3 py-1 text-sm hover:bg-slate-50"
            >
              Back to agents
            </Link>
            <Link
              href={`/agents/${encodeURIComponent(decoded)}/promote`}
              className="rounded bg-slate-900 px-3 py-1 text-sm font-medium text-white hover:bg-slate-800"
            >
              Promote
            </Link>
          </>
        }
      />
      {error ? (
        <ErrorView error={error} context="this agent" />
      ) : data ? (
        <>
          <AgentBody agent={data.agent} knownAgents={knownAgents} />
          {currentUserId.length > 0 && (
            <div className="mt-6">
              <CommentsThread
                targetKind="agent"
                targetId={decoded}
                currentUserId={currentUserId}
                currentUserEmail={currentUserEmail}
                initialAnnotations={initialAnnotations}
              />
            </div>
          )}
        </>
      ) : null}
    </>
  );
}

function AgentBody({
  agent,
  knownAgents,
}: {
  agent: Awaited<ReturnType<typeof getAgent>>['agent'];
  knownAgents: ReadonlyArray<string>;
}) {
  return (
    <div className="flex flex-col gap-5">
      <Card className="flex flex-col gap-4 p-5 sm:flex-row sm:items-start">
        <AgentAvatar name={agent.name} size={56} />
        <div className="flex flex-1 flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold text-slate-900">{agent.name}</h2>
            <span className="font-mono text-xs text-slate-500">{agent.latestVersion}</span>
            {agent.promoted ? (
              <span className="text-[10px] uppercase tracking-wider text-emerald-700">
                promoted
              </span>
            ) : (
              <span className="text-[10px] uppercase tracking-wider text-slate-400">
                unpromoted
              </span>
            )}
            <PrivacyBadge tier={agent.privacyTier} />
          </div>
          <p className="text-sm text-slate-700">{agent.description}</p>
          <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500">
            <span>
              <span className="uppercase tracking-wider">team</span>{' '}
              <span className="font-medium text-slate-700">{agent.team}</span>
            </span>
            <span>
              <span className="uppercase tracking-wider">owner</span>{' '}
              <span className="font-medium text-slate-700">{agent.owner}</span>
            </span>
            {agent.tags.length > 0 ? (
              <span className="flex flex-wrap items-center gap-1">
                {agent.tags.map((t) => (
                  <NeutralBadge key={t}>{t}</NeutralBadge>
                ))}
              </span>
            ) : null}
          </div>
        </div>
      </Card>

      <AgentDetailTabs
        spec={<SpecTab spec={agent.spec} />}
        safety={
          <div className="flex flex-col gap-5">
            <PolicyPanels agent={agent} />
            <section>
              <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
                Routing dry-run
              </h3>
              <RoutingDryRunCard agentName={agent.name} />
            </section>
          </div>
        }
        composite={<CompositeTab agent={agent} knownAgents={knownAgents} />}
        evalView={<EvalAnalytics agentName={agent.name} />}
        runs={<AgentRunsPanel agentName={agent.name} />}
      />
    </div>
  );
}

function SpecTab({ spec }: { spec: unknown }) {
  let serialized = '';
  try {
    serialized = yaml.dump(spec, { lineWidth: 100, noRefs: true, quotingType: '"' });
  } catch {
    serialized = JSON.stringify(spec, null, 2);
  }
  return (
    <div className="overflow-hidden rounded-md border border-slate-200 bg-slate-950 p-4">
      <pre className="overflow-x-auto whitespace-pre-wrap break-words text-xs text-slate-100">
        {serialized}
      </pre>
    </div>
  );
}

function CompositeTab({
  agent,
  knownAgents,
}: {
  agent: Awaited<ReturnType<typeof getAgent>>['agent'];
  knownAgents: ReadonlyArray<string>;
}) {
  if (!agent.composite) {
    return (
      <div className="rounded-md border border-dashed border-slate-300 bg-white p-6 text-sm text-slate-500">
        This agent is a leaf — it doesn&apos;t orchestrate sub-agents.
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      <div className="text-xs text-slate-500">
        Strategy: <span className="font-mono text-slate-700">{agent.composite.strategy}</span>
        {agent.composite.aggregator ? (
          <>
            {' · '}aggregator:{' '}
            <span className="font-mono text-slate-700">{agent.composite.aggregator}</span>
          </>
        ) : null}
        {agent.composite.iteration ? (
          <>
            {' · '}max rounds:{' '}
            <span className="font-mono text-slate-700">{agent.composite.iteration.maxRounds}</span>{' '}
            · terminate:{' '}
            <span className="font-mono text-slate-700">{agent.composite.iteration.terminate}</span>
          </>
        ) : null}
      </div>
      <CompositeDiagram
        supervisorName={agent.name}
        composite={agent.composite}
        knownAgents={knownAgents}
      />
    </div>
  );
}
