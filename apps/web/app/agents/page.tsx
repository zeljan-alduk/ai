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
import { ProjectFilterBanner } from '@/components/layout/project-filter-banner';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { boundedAll, getAgent, listAgents, listProjects, listRuns } from '@/lib/api';
import type { AgentSummary, PrivacyTier, RunStatus } from '@aldo-ai/api-contract';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

interface SearchParams {
  team?: string;
  tier?: string;
  composite?: string;
  q?: string;
  cursor?: string;
  /**
   * Wave-17 (Tier 2.5) — when present, server filters agents to one
   * project. The slug is opaque on the client; the API resolves it to
   * the row's `project_id`. Falls back to "all projects in this
   * tenant" when omitted.
   */
  project?: string;
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

  // Wave-17 — `?project=<slug>` scopes the registry list to a single
  // project. Pre-retrofit clients (no project param) get the legacy
  // tenant-wide list, unchanged.
  const projectSlug = sp.project?.trim() ? sp.project.trim() : undefined;

  let listed: Awaited<ReturnType<typeof listAgents>> | null = null;
  let projectName: string | undefined;
  let error: unknown = null;
  try {
    const [agentsResp, projectsResp] = await Promise.all([
      listAgents({
        limit: 200,
        ...(projectSlug !== undefined ? { project: projectSlug } : {}),
      }),
      // Best-effort — only used for the banner display name. A 4xx/5xx
      // here just means the banner shows the slug instead of the name.
      projectSlug !== undefined ? listProjects().catch(() => null) : Promise.resolve(null),
    ]);
    listed = agentsResp;
    if (projectsResp && projectSlug !== undefined) {
      projectName = projectsResp.projects.find((p) => p.slug === projectSlug)?.name;
    }
  } catch (err) {
    error = err;
  }

  // Build the "show all" link by stripping the project param while
  // preserving every other filter the user set.
  const clearHref = (() => {
    const next = new URLSearchParams();
    if (sp.team) next.set('team', sp.team);
    if (sp.tier) next.set('tier', sp.tier);
    if (sp.composite) next.set('composite', sp.composite);
    if (sp.q) next.set('q', sp.q);
    const qs = next.toString();
    return qs.length === 0 ? '/agents' : `/agents?${qs}`;
  })();

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

  // Resolve hasComposite per-agent in BATCHES of 6 to keep Vercel's
  // serverless DNS resolver happy. Past ~30 concurrent fetches, the
  // resolver returns "DNS cache overflow" and the page 503s.
  // boundedAll preserves order; missing/erroring agents show as leaf.
  const compositeResults = await boundedAll(listed.agents, 6, async (a) => {
    try {
      const detail = await getAgent(a.name);
      return { name: a.name, hasComposite: detail.agent.composite != null };
    } catch {
      return { name: a.name, hasComposite: false };
    }
  });
  const compositeMap = new Map<string, boolean>();
  for (const r of compositeResults) compositeMap.set(r.name, r.hasComposite);

  // Best-effort recent runs lookup, same concurrency cap.
  const runsResults = await boundedAll(listed.agents, 6, async (a) => {
    try {
      const runs = await listRuns({ agentName: a.name, limit: 10 });
      const statuses = runs.runs.map((r) => r.status).reverse();
      return { name: a.name, statuses };
    } catch {
      return { name: a.name, statuses: [] as RunStatus[] };
    }
  });
  const runsMap = new Map<string, RunStatus[]>();
  for (const r of runsResults) runsMap.set(r.name, r.statuses);

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
      {projectSlug !== undefined ? (
        <ProjectFilterBanner
          projectSlug={projectSlug}
          projectName={projectName}
          clearHref={clearHref}
          entityNoun="agents"
        />
      ) : null}
      {listed.agents.length === 0 ? (
        <EmptyState
          title="No agents yet"
          description="Two ways to populate the registry: seed the default agency template, or connect a GitHub/GitLab repo to sync your specs in."
          illustration={<EmptyAgentsIllustration />}
          action={
            <div className="flex flex-wrap items-center justify-center gap-2">
              <form action={seedDefaultAgencyAction}>
                <Button type="submit">Use the default agency template</Button>
              </form>
              <Link href="/integrations/git/connect">
                <Button variant="secondary">Connect a repo</Button>
              </Link>
            </div>
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
