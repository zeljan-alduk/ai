/**
 * /agents — agent gallery (rebuilt for wave 12).
 *
 * Server component. Fetches the registry list and (best-effort) the
 * recent runs for sparklines + the per-agent spec for "has composite"
 * filter affinity. Cards render through `<AgentCard>`.
 *
 * Filter state lives in URL query params:
 *   ?team=<team>&tier=<privacy>&composite=<has|leaf|any>&q=<search>
 *
 * Empty registry state offers a CTA to seed the default agency template.
 *
 * LLM-agnostic: nothing references a provider. Capability badges are
 * tag chips; concrete model selection is the gateway's job.
 */

import { seedDefaultAgencyAction } from '@/app/welcome/actions';
import { AgentCard } from '@/components/agents/agent-card';
import {
  type CompositeFilter,
  type GalleryFilterState,
  type TeamFilter,
  applyGalleryFilters,
} from '@/components/agents/gallery-filters';
import { GalleryFiltersUi } from '@/components/agents/gallery-filters-ui';
import { ErrorView } from '@/components/error-boundary';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { getAgent, listAgents, listRuns } from '@/lib/api';
import type { AgentSummary, PrivacyTier, RunStatus } from '@aldo-ai/api-contract';

export const dynamic = 'force-dynamic';

interface SearchParams {
  team?: string;
  tier?: string;
  composite?: string;
  q?: string;
  cursor?: string;
}

const PRIVACY_TIERS: ReadonlyArray<PrivacyTier> = ['public', 'internal', 'sensitive'];

function coerceTeam(v: string | undefined): TeamFilter | undefined {
  if (!v || v === 'all') return undefined;
  if (v === 'direction' || v === 'delivery' || v === 'support' || v === 'meta') return v;
  return undefined;
}
function coerceTier(v: string | undefined): PrivacyTier | undefined {
  if (!v || v === 'all') return undefined;
  return PRIVACY_TIERS.includes(v as PrivacyTier) ? (v as PrivacyTier) : undefined;
}
function coerceComposite(v: string | undefined): CompositeFilter | undefined {
  if (!v || v === 'any') return undefined;
  return v === 'has' || v === 'leaf' ? v : undefined;
}

export default async function AgentsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;

  let listed: Awaited<ReturnType<typeof listAgents>> | null = null;
  let error: unknown = null;
  try {
    listed = await listAgents({ limit: 200 });
  } catch (err) {
    error = err;
  }

  if (error) {
    return (
      <>
        <PageHeader
          title="Agents"
          description="Versioned, eval-gated agent specs. Privacy tier controls model routing."
        />
        <ErrorView error={error} context="agents" />
      </>
    );
  }
  if (!listed) return null;

  // Resolve hasComposite per-agent in parallel; missing/erroring agents
  // simply show as leaf. Empty registry skips the round-trip entirely.
  const detailPromises = listed.agents.map(async (a) => {
    try {
      const detail = await getAgent(a.name);
      return { name: a.name, hasComposite: detail.agent.composite != null };
    } catch {
      return { name: a.name, hasComposite: false };
    }
  });
  const compositeMap = new Map<string, boolean>();
  for (const r of await Promise.all(detailPromises)) {
    compositeMap.set(r.name, r.hasComposite);
  }

  // Best-effort recent runs lookup — short-circuit on error so the
  // gallery still renders.
  const runsPromises = listed.agents.map(async (a) => {
    try {
      const runs = await listRuns({ agentName: a.name, limit: 10 });
      // Oldest first for the sparkline.
      const statuses = runs.runs.map((r) => r.status).reverse();
      return { name: a.name, statuses };
    } catch {
      return { name: a.name, statuses: [] as RunStatus[] };
    }
  });
  const runsMap = new Map<string, RunStatus[]>();
  for (const r of await Promise.all(runsPromises)) {
    runsMap.set(r.name, r.statuses);
  }

  const filters: GalleryFilterState = {};
  const team = coerceTeam(sp.team);
  if (team) filters.team = team;
  const tier = coerceTier(sp.tier);
  if (tier) filters.tier = tier;
  const composite = coerceComposite(sp.composite);
  if (composite) filters.composite = composite;
  if (sp.q) filters.search = sp.q;

  const enriched = listed.agents.map((a) => ({
    ...a,
    hasComposite: compositeMap.get(a.name) ?? false,
  }));
  const filtered = applyGalleryFilters(enriched, filters);

  return (
    <>
      <PageHeader
        title="Agents"
        description="Versioned, eval-gated agent specs. Cards show team, privacy tier, recent runs, and composite affinity."
      />
      {listed.agents.length === 0 ? (
        <EmptyState
          title="No agents in this tenant yet"
          description="Seed the default agency template to get the principal -> architect -> tech-lead -> reviewer mesh and start exploring."
          illustration={<EmptyAgentsIllustration />}
          action={
            <form action={seedDefaultAgencyAction}>
              <Button type="submit">Use the default agency template</Button>
            </form>
          }
        />
      ) : (
        <div className="flex flex-col gap-5">
          <GalleryFiltersUi />
          <p className="text-xs text-slate-500">
            {filtered.length} of {listed.agents.length} agent
            {listed.agents.length === 1 ? '' : 's'} match these filters
          </p>
          {filtered.length === 0 ? (
            <EmptyState
              title="No agents match these filters"
              description="Relax the team, tier, or composite filter — or clear the search box."
            />
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {filtered.map((a: AgentSummary & { hasComposite: boolean }) => (
                <AgentCard
                  key={a.name}
                  agent={a}
                  hasComposite={a.hasComposite}
                  recentStatuses={runsMap.get(a.name) ?? []}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </>
  );
}

function EmptyAgentsIllustration() {
  return (
    <svg width="84" height="84" viewBox="0 0 84 84" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id="agents-empty-grad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#0ea5e9" />
          <stop offset="100%" stopColor="#1e3a8a" />
        </linearGradient>
      </defs>
      <rect
        x="10"
        y="14"
        width="64"
        height="56"
        rx="10"
        fill="url(#agents-empty-grad)"
        opacity="0.15"
      />
      <circle cx="28" cy="38" r="9" fill="url(#agents-empty-grad)" />
      <circle cx="56" cy="38" r="9" fill="url(#agents-empty-grad)" opacity="0.7" />
      <rect
        x="20"
        y="52"
        width="44"
        height="6"
        rx="3"
        fill="url(#agents-empty-grad)"
        opacity="0.5"
      />
    </svg>
  );
}
