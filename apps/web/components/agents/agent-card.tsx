/**
 * Gallery card for one agent. Server-component-friendly: only the
 * "Try this agent" button is a client island.
 *
 * Cards display:
 *   - deterministic SVG avatar (see agent-avatar.tsx)
 *   - agent name + role.team
 *   - up to 3 tag badges + "(N more)"
 *   - privacy-tier badge
 *   - last-run sparkline (10 dots, oldest first)
 *   - "Try this agent" placeholder dialog (wave-13 plumbing)
 *
 * LLM-agnostic: nothing references a provider id. The capability
 * surface here is the tag set (which agent authors curate); concrete
 * model selection is the gateway's job at runtime.
 */

import { PrivacyBadge } from '@/components/badge';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardFooter, CardHeader } from '@/components/ui/card';
import type { AgentSummary, RunStatus } from '@aldo-ai/api-contract';
import Link from 'next/link';
import { AgentAvatar } from './agent-avatar';
import { RunStatusSparkline } from './run-status-sparkline';
import { TryAgentDialog } from './try-agent-dialog';

const TAG_LIMIT = 3;

export interface AgentCardProps {
  agent: AgentSummary;
  /** Recent run statuses, oldest first. May be empty. */
  recentStatuses?: ReadonlyArray<RunStatus>;
  /** True when the agent's spec declares a `composite` block. */
  hasComposite?: boolean;
}

export function AgentCard({ agent, recentStatuses = [], hasComposite }: AgentCardProps) {
  const visibleTags = agent.tags.slice(0, TAG_LIMIT);
  const hiddenTagCount = Math.max(0, agent.tags.length - TAG_LIMIT);
  return (
    <Card className="flex flex-col">
      <CardHeader className="flex flex-row items-start gap-3 p-4">
        <AgentAvatar name={agent.name} size={44} />
        <div className="min-w-0 flex-1">
          <Link
            href={`/agents/${encodeURIComponent(agent.name)}`}
            className="block truncate text-sm font-semibold text-slate-900 hover:underline"
          >
            {agent.name}
          </Link>
          <div className="mt-0.5 flex items-center gap-2 text-xs text-slate-500">
            <span className="truncate">
              {agent.team}
              {agent.owner ? ` · ${agent.owner}` : ''}
            </span>
            {hasComposite ? (
              <Badge variant="secondary" className="shrink-0">
                composite
              </Badge>
            ) : null}
          </div>
        </div>
        <PrivacyBadge tier={agent.privacyTier} />
      </CardHeader>
      <CardContent className="flex flex-col gap-3 px-4 pb-3 pt-0">
        <p className="line-clamp-3 text-sm text-slate-600">{agent.description}</p>
        <div className="flex flex-wrap items-center gap-1">
          {visibleTags.length === 0 ? (
            <span className="text-[11px] text-slate-400">no tags declared</span>
          ) : (
            visibleTags.map((t) => (
              <Badge key={t} variant="secondary">
                {t}
              </Badge>
            ))
          )}
          {hiddenTagCount > 0 ? (
            <span className="text-[11px] text-slate-500">(+{hiddenTagCount} more)</span>
          ) : null}
        </div>
        <div className="flex items-center justify-between gap-2 pt-1">
          <div className="flex items-center gap-2 text-[11px] text-slate-500">
            <span className="uppercase tracking-wider">recent</span>
            <RunStatusSparkline statuses={recentStatuses} />
          </div>
          <span className="font-mono text-[11px] text-slate-500">{agent.latestVersion}</span>
        </div>
      </CardContent>
      <CardFooter className="flex items-center justify-between border-t border-slate-100 px-4 py-3">
        <Link
          href={`/agents/${encodeURIComponent(agent.name)}`}
          className="text-xs font-medium text-slate-700 hover:text-slate-900 hover:underline"
        >
          View details
        </Link>
        <TryAgentDialog agentName={agent.name} />
      </CardFooter>
    </Card>
  );
}
