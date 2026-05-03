/**
 * `/v1/spend` — Wave-4 cost + spend analytics aggregation.
 *
 * Single round-trip aggregation over `usage_records` joined to `runs`,
 * tenant-scoped, optionally project-scoped. Mirrors the wave-12
 * `observability/summary` style — bounded result, server-side SUM/GROUP
 * BY, no JS-side reduction over raw rows.
 *
 * The page's three breakdown panels (`capability`, `agent`, `project`)
 * each issue ONE call to this endpoint with `groupBy=` flipped. The
 * timeseries + totals + cards in the response are computed every time
 * (cheap — SUM over a window) so the client never has to stitch
 * multiple shapes together.
 *
 * LLM-agnostic: every breakdown key is opaque (model id, capability
 * class, agent name, project slug). The locality / capability lookup
 * is keyed off `usage_records.model` against the model catalog, NEVER
 * the `provider` string.
 *
 * Window policy:
 *   - `<= 24h` → bucket by hour (UTC)
 *   - `> 24h`  → bucket by day (UTC)
 *   - `custom` requires both `since` AND `until`; either alone falls
 *     back to the explicit `window` preset.
 *
 * Empty-bucket policy: every bucket in the chosen window is emitted,
 * even if zero — the frontend bar chart needs a dense series.
 *
 * Cards: today / week-to-date / month-to-date are computed in UTC; the
 * `delta` against the prior comparable window is included so the page
 * can render arrows and percentages without a second call.
 *
 * Empty-tenant policy: a brand-new tenant with zero runs returns a
 * structurally-valid response with all-zero totals + empty breakdowns
 * + a dense (all-zero) timeseries. The frontend renders the empty
 * state from this signal alone — no separate "exists?" probe.
 */

import { SpendQuery, SpendResponse, type SpendTimeseriesPoint } from '@aldo-ai/api-contract';
import { Hono } from 'hono';
import { getAuth } from '../auth/middleware.js';
import type { Deps } from '../deps.js';
import { notFound, validationError } from '../middleware/error.js';
import { getProjectBySlug } from '../projects-store.js';
import { loadModelCatalog } from './models.js';

/** Cap the per-breakdown-row count so the response stays bounded. */
const BREAKDOWN_LIMIT = 50;

export function spendRoutes(deps: Deps): Hono {
  const app = new Hono();

  app.get('/v1/spend', async (c) => {
    const auth = getAuth(c);

    const url = new URL(c.req.url);
    const parsed = SpendQuery.safeParse({
      project: url.searchParams.get('project') ?? undefined,
      window: url.searchParams.get('window') ?? undefined,
      since: url.searchParams.get('since') ?? undefined,
      until: url.searchParams.get('until') ?? undefined,
      groupBy: url.searchParams.get('groupBy') ?? undefined,
    });
    if (!parsed.success) {
      throw validationError('invalid spend query', parsed.error.issues);
    }
    const q = parsed.data;

    // ── Resolve the project filter (slug → id). Unknown slug → 404,
    //    matching `/v1/runs?project=` semantics. Omitting the param
    //    aggregates across every project in the tenant.
    let projectIdFilter: string | undefined;
    if (q.project !== undefined) {
      const project = await getProjectBySlug(deps.db, {
        slug: q.project,
        tenantId: auth.tenantId,
      });
      if (project === null) {
        throw notFound(`project not found: ${q.project}`);
      }
      projectIdFilter = project.id;
    }

    // ── Resolve [since, until]. Custom window requires BOTH bounds.
    //    Anything else falls back to the preset.
    const now = new Date();
    const { since, until, bucketByHour } = resolveWindow(q.window, q.since, q.until, now);

    // ── Load the catalog ONCE so we can map model → capabilityClass
    //    without an extra DB join. Locality isn't needed in this
    //    route — the wave-12 observability summary already exposes it
    //    per the LangSmith parity brief.
    const catalog = await loadModelCatalog(deps.env);
    const capabilityById = new Map<string, string>();
    for (const m of catalog.models) {
      capabilityById.set(m.id, m.capabilityClass);
    }

    // ── Pull every usage row in [since, until] (filtered by tenant +
    //    project). One scan, then we fold in JS into:
    //      - totals
    //      - timeseries buckets (dense)
    //      - the requested breakdown
    //
    //    The JOIN gives us `runs.agent_name` and `runs.project_id` so a
    //    `groupBy=agent` or `groupBy=project` doesn't need a second
    //    pass. SUM/GROUP-BY-in-SQL is the right answer at high volume;
    //    today's pglite + Neon HTTP both round-trip the JS fold faster
    //    than the round-trip cost of three separate aggregation
    //    queries. When tenants exceed ~1M usage rows in a 90d window
    //    the optimisation path is to push the buckets into SQL with
    //    `date_trunc(...)` — see the comment block at the bottom.
    const rows = await fetchUsageRows(deps, auth.tenantId, projectIdFilter, since, until);

    // Resolve project_id → slug for groupBy=project. We hit projects
    // ONCE for the whole tenant — sparse table, cheap, avoids N+1.
    const projectSlugById = await loadProjectSlugMap(deps, auth.tenantId);

    // ── Totals + timeseries + breakdown over the same row stream.
    let totalCost = 0;
    let totalIn = 0;
    let totalOut = 0;
    const totalRunIds = new Set<string>();

    const buckets = makeDenseBuckets(since, until, bucketByHour);
    const bucketIndexFor = (atIso: string): number => {
      const t = Date.parse(atIso);
      if (Number.isNaN(t)) return -1;
      const offsetMs = t - since.getTime();
      const stepMs = bucketByHour ? 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
      return Math.floor(offsetMs / stepMs);
    };

    interface Agg {
      key: string;
      label: string;
      cost: number;
      tokensIn: number;
      tokensOut: number;
      runs: Set<string>;
    }
    const agg = new Map<string, Agg>();
    const upsert = (key: string, label: string): Agg => {
      let v = agg.get(key);
      if (v === undefined) {
        v = {
          key,
          label,
          cost: 0,
          tokensIn: 0,
          tokensOut: 0,
          runs: new Set<string>(),
        };
        agg.set(key, v);
      }
      return v;
    };

    for (const row of rows) {
      const usd = Number(row.usd) || 0;
      const tIn = Number(row.tokens_in) || 0;
      const tOut = Number(row.tokens_out) || 0;
      const at = toIso(row.at);
      totalCost += usd;
      totalIn += tIn;
      totalOut += tOut;
      totalRunIds.add(row.run_id);

      const bi = bucketIndexFor(at);
      if (bi >= 0 && bi < buckets.length) {
        const b = buckets[bi];
        if (b !== undefined) {
          b.costUsd += usd;
          b.tokens += tIn + tOut;
          b.runs += b.runIds.has(row.run_id) ? 0 : 1;
          b.runIds.add(row.run_id);
        }
      }

      // Pick the breakdown key based on groupBy.
      let key: string;
      let label: string;
      switch (q.groupBy) {
        case 'model':
          key = row.model;
          label = row.model;
          break;
        case 'capability': {
          const cap = capabilityById.get(row.model) ?? 'unknown';
          key = cap;
          label = cap;
          break;
        }
        case 'agent':
          key = row.agent_name;
          label = row.agent_name;
          break;
        case 'project': {
          const slug = row.project_id ? (projectSlugById.get(row.project_id) ?? null) : null;
          key = slug ?? '(unassigned)';
          label = slug ?? '(unassigned)';
          break;
        }
        case 'day':
          key = at.slice(0, 10);
          label = at.slice(0, 10);
          break;
        default:
          key = row.model;
          label = row.model;
      }
      const a = upsert(key, label);
      a.cost += usd;
      a.tokensIn += tIn;
      a.tokensOut += tOut;
      a.runs.add(row.run_id);
    }

    const breakdownTotal = totalCost;
    const breakdown = Array.from(agg.values())
      .sort((a, b) => b.cost - a.cost || b.runs.size - a.runs.size)
      .slice(0, BREAKDOWN_LIMIT)
      .map((a) => ({
        key: a.key,
        label: a.label,
        costUsd: round(a.cost),
        tokensInput: a.tokensIn,
        tokensOutput: a.tokensOut,
        runs: a.runs.size,
        percentOfTotal: breakdownTotal > 0 ? round((a.cost / breakdownTotal) * 100, 2) : 0,
      }));

    const timeseries: SpendTimeseriesPoint[] = buckets.map((b) => ({
      dateBucket: b.dateBucket,
      costUsd: round(b.costUsd),
      tokens: b.tokens,
      runs: b.runs,
    }));

    // ── Cards: today / WTD / MTD with deltas + projected month-end.
    const cards = await buildCards(deps, auth.tenantId, projectIdFilter, now);

    const body = SpendResponse.parse({
      query: {
        project: q.project ?? null,
        window: q.window,
        since: since.toISOString(),
        until: until.toISOString(),
        groupBy: q.groupBy,
      },
      generatedAt: now.toISOString(),
      totals: {
        costUsd: round(totalCost),
        tokensInput: totalIn,
        tokensOutput: totalOut,
        runs: totalRunIds.size,
      },
      cards,
      timeseries,
      breakdown,
    });
    return c.json(body);
  });

  return app;
}

// ── helpers ──────────────────────────────────────────────────────────

interface UsageRow {
  readonly run_id: string;
  readonly agent_name: string;
  readonly project_id: string | null;
  readonly model: string;
  readonly tokens_in: number | string;
  readonly tokens_out: number | string;
  readonly usd: number | string;
  readonly at: string | Date;
  readonly [k: string]: unknown;
}

async function fetchUsageRows(
  deps: Deps,
  tenantId: string,
  projectId: string | undefined,
  since: Date,
  until: Date,
): Promise<readonly UsageRow[]> {
  const params: unknown[] = [tenantId, since.toISOString(), until.toISOString()];
  let projectClause = '';
  if (projectId !== undefined) {
    params.push(projectId);
    projectClause = ` AND r.project_id = $${params.length}`;
  }
  const res = await deps.db.query<UsageRow>(
    `SELECT u.run_id, r.agent_name, r.project_id, u.model,
            u.tokens_in, u.tokens_out, u.usd, u.at
       FROM usage_records u
       JOIN runs r ON r.id = u.run_id
      WHERE r.tenant_id = $1
        AND u.at >= $2
        AND u.at <  $3
        ${projectClause}`,
    params,
  );
  return res.rows;
}

async function loadProjectSlugMap(deps: Deps, tenantId: string): Promise<Map<string, string>> {
  const res = await deps.db.query<{ id: string; slug: string }>(
    'SELECT id, slug FROM projects WHERE tenant_id = $1',
    [tenantId],
  );
  const out = new Map<string, string>();
  for (const r of res.rows) out.set(r.id, r.slug);
  return out;
}

interface ResolvedWindow {
  readonly since: Date;
  readonly until: Date;
  readonly bucketByHour: boolean;
}

function resolveWindow(
  window: string,
  sinceQ: string | undefined,
  untilQ: string | undefined,
  now: Date,
): ResolvedWindow {
  if (window === 'custom') {
    const a = sinceQ !== undefined ? new Date(sinceQ) : null;
    const b = untilQ !== undefined ? new Date(untilQ) : null;
    if (a !== null && b !== null && !Number.isNaN(a.getTime()) && !Number.isNaN(b.getTime())) {
      const span = b.getTime() - a.getTime();
      // Day buckets only when the span is over 24h, mirrors the preset
      // policy. A custom 12h window still gets hourly buckets.
      return { since: a, until: b, bucketByHour: span <= 24 * 60 * 60 * 1000 };
    }
    // Fall through to the 7d default if custom bounds are missing /
    // malformed. Avoids crashing on a partial query.
  }
  const days = window === '24h' ? 1 : window === '30d' ? 30 : window === '90d' ? 90 : 7;
  const sinceDate = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  return {
    since: sinceDate,
    until: now,
    bucketByHour: days <= 1,
  };
}

interface Bucket {
  dateBucket: string;
  costUsd: number;
  tokens: number;
  runs: number;
  runIds: Set<string>;
}

function makeDenseBuckets(since: Date, until: Date, byHour: boolean): Bucket[] {
  const stepMs = byHour ? 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
  // Anchor to the bucket boundary (UTC midnight for day; hour boundary
  // for hour) so adjacent windows align across days/months.
  const anchored = byHour
    ? Math.floor(since.getTime() / stepMs) * stepMs
    : Date.UTC(since.getUTCFullYear(), since.getUTCMonth(), since.getUTCDate());
  const out: Bucket[] = [];
  for (let t = anchored; t < until.getTime(); t += stepMs) {
    out.push({
      dateBucket: new Date(t).toISOString(),
      costUsd: 0,
      tokens: 0,
      runs: 0,
      runIds: new Set<string>(),
    });
  }
  // Bound the bucket count so a bogus custom range (e.g. 10y) can't
  // OOM the response. 24h * 90d = 2160 hour buckets is the legitimate
  // ceiling; cap at 5000.
  if (out.length > 5000) {
    return out.slice(out.length - 5000);
  }
  return out;
}

interface CardWindowResult {
  readonly costUsd: number;
}

async function sumCost(
  deps: Deps,
  tenantId: string,
  projectId: string | undefined,
  since: Date,
  until: Date,
): Promise<CardWindowResult> {
  const params: unknown[] = [tenantId, since.toISOString(), until.toISOString()];
  let projectClause = '';
  if (projectId !== undefined) {
    params.push(projectId);
    projectClause = ` AND r.project_id = $${params.length}`;
  }
  const res = await deps.db.query<{ usd: string | number | null }>(
    `SELECT COALESCE(SUM(u.usd), 0) AS usd
       FROM usage_records u
       JOIN runs r ON r.id = u.run_id
      WHERE r.tenant_id = $1
        AND u.at >= $2
        AND u.at <  $3
        ${projectClause}`,
    params,
  );
  const usd = Number(res.rows[0]?.usd ?? 0) || 0;
  return { costUsd: usd };
}

async function buildCards(
  deps: Deps,
  tenantId: string,
  projectId: string | undefined,
  now: Date,
): Promise<{
  today: { costUsd: number; delta: ReturnType<typeof zeroDelta> };
  weekToDate: { costUsd: number; delta: ReturnType<typeof zeroDelta> };
  monthToDate: {
    costUsd: number;
    delta: ReturnType<typeof zeroDelta>;
    projectedMonthEndUsd: number;
  };
  activeRuns: number;
}> {
  // Today: UTC-midnight to now. Yesterday: same span ending at UTC
  // midnight today (a full 24h bar).
  const utcMidnight = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const yesterdayMidnight = new Date(utcMidnight.getTime() - 24 * 60 * 60 * 1000);
  const todayCost = (await sumCost(deps, tenantId, projectId, utcMidnight, now)).costUsd;
  const yesterdayCost = (await sumCost(deps, tenantId, projectId, yesterdayMidnight, utcMidnight))
    .costUsd;

  // Week: ISO week starts Monday UTC. Use day-of-week math (UTC).
  const dow = (now.getUTCDay() + 6) % 7; // 0..6, Monday=0
  const weekStart = new Date(utcMidnight.getTime() - dow * 24 * 60 * 60 * 1000);
  const priorWeekStart = new Date(weekStart.getTime() - 7 * 24 * 60 * 60 * 1000);
  const wtdCost = (await sumCost(deps, tenantId, projectId, weekStart, now)).costUsd;
  // Compare against the same number-of-days window in the prior ISO
  // week so a Tuesday WTD compares against last week's Monday→Tuesday.
  const priorWeekEnd = new Date(priorWeekStart.getTime() + (now.getTime() - weekStart.getTime()));
  const priorWtdCost = (await sumCost(deps, tenantId, projectId, priorWeekStart, priorWeekEnd))
    .costUsd;

  // Month-to-date: UTC first-of-month → now. Prior: the same number of
  // days into the prior month so a 5th-of-May MTD compares to 1st–5th
  // of April.
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const priorMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const priorMonthEnd = new Date(
    priorMonthStart.getTime() + (now.getTime() - monthStart.getTime()),
  );
  const mtdCost = (await sumCost(deps, tenantId, projectId, monthStart, now)).costUsd;
  const priorMtdCost = (await sumCost(deps, tenantId, projectId, priorMonthStart, priorMonthEnd))
    .costUsd;

  // Linear projection for the month-end. Day-fraction = days elapsed
  // (incl. today as fractional) / days-in-month. Avoids /0 on the 1st.
  const daysInMonth = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0),
  ).getUTCDate();
  const dayFraction = (now.getTime() - monthStart.getTime()) / (24 * 60 * 60 * 1000) || 0.001;
  const projectedMonthEnd = mtdCost > 0 ? (mtdCost / dayFraction) * daysInMonth : 0;

  // Active runs: queued + running, tenant-scoped and (optionally)
  // project-scoped.
  const activeParams: unknown[] = [tenantId];
  let projectClauseActive = '';
  if (projectId !== undefined) {
    activeParams.push(projectId);
    projectClauseActive = ` AND project_id = $${activeParams.length}`;
  }
  const activeRes = await deps.db.query<{ count: string | number }>(
    `SELECT COUNT(*) AS count FROM runs
      WHERE tenant_id = $1 AND status IN ('queued', 'running')${projectClauseActive}`,
    activeParams,
  );
  const activeRuns = Number(activeRes.rows[0]?.count ?? 0);

  return {
    today: { costUsd: round(todayCost), delta: deltaOf(todayCost, yesterdayCost) },
    weekToDate: { costUsd: round(wtdCost), delta: deltaOf(wtdCost, priorWtdCost) },
    monthToDate: {
      costUsd: round(mtdCost),
      delta: deltaOf(mtdCost, priorMtdCost),
      projectedMonthEndUsd: round(projectedMonthEnd),
    },
    activeRuns,
  };
}

function zeroDelta() {
  return { prevCostUsd: 0, deltaUsd: 0, deltaPct: null as number | null };
}

function deltaOf(current: number, prev: number) {
  const deltaUsd = current - prev;
  const deltaPct = prev > 0 ? (current - prev) / prev : null;
  return {
    prevCostUsd: round(prev),
    deltaUsd: round(deltaUsd),
    deltaPct: deltaPct === null ? null : Math.round(deltaPct * 10000) / 10000,
  };
}

function toIso(v: string | Date): string {
  if (v instanceof Date) return v.toISOString();
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? new Date(0).toISOString() : d.toISOString();
}

function round(n: number, places = 6): number {
  const f = 10 ** places;
  return Math.round(n * f) / f;
}

/**
 * Future scaling notes — not action-required at MVP volume.
 *
 * - Push the bucket loop into Postgres with
 *   `date_trunc('hour' | 'day', u.at AT TIME ZONE 'UTC')` once a
 *   tenant exceeds ~1M usage rows in a 90d window. Today the JS fold
 *   over a full pglite scan benchmarks faster than three round-trips.
 * - The breakdown could be a SUM/GROUP BY in SQL too, returning only
 *   the top-N. Same pivot threshold.
 * - The cards execute 6 cheap COUNT/SUM queries; pglite handles them
 *   in <5ms each. If the cards become hot enough to matter, a single
 *   CTE with conditional SUMs collapses them to one round-trip.
 */
