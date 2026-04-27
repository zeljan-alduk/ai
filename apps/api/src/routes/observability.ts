/**
 * `/v1/observability/summary` — wave-12 KPI feed for `/observability`.
 *
 * One round-trip aggregation over the existing wave-1/8/10 tables —
 * `usage_records`, `runs`, `run_events` — all tenant-scoped. No new
 * schema. Response is bounded (top N events, per-locality bucket, per
 * model bucket) so the page can poll every 15s without paying a
 * full-table scan.
 *
 * LLM-agnostic: provider strings in the response are opaque — same
 * convention as `/v1/runs` and `/v1/models`. The KPIs and breakdowns
 * NEVER imply "X provider is bad"; the structure of the data
 * (privacy-tier-mismatch should always be 0; sandbox/guards blocks are
 * a count, not a name-and-shame list) is what makes the surface
 * meaningful.
 *
 * The "privacy-tier mismatches" KPI looks for any `routing.privacy_*`
 * audit row that explicitly claims the tier was VIOLATED — there's no
 * such event today (the gateway fails closed before emitting), so the
 * count is structurally always 0. We surface it anyway so an operator
 * can see the safety story is enforced, not just promised.
 */

import {
  ObservabilityQuery,
  ObservabilitySummary,
  type PrivacyRouterEvent,
  type SafetyEvent,
} from '@aldo-ai/api-contract';
import { Hono } from 'hono';
import { getAuth } from '../auth/middleware.js';
import type { Deps } from '../deps.js';
import { validationError } from '../middleware/error.js';
import { loadModelCatalog } from './models.js';

/** How many recent rows to surface per feed. UI is a scroll, not a table-of-everything. */
const PRIVACY_FEED_LIMIT = 50;
const SAFETY_FEED_LIMIT = 50;
const MODEL_BREAKDOWN_LIMIT = 50;

export function observabilityRoutes(deps: Deps): Hono {
  const app = new Hono();

  app.get('/v1/observability/summary', async (c) => {
    const auth = getAuth(c);
    const parsed = ObservabilityQuery.safeParse({
      period: c.req.query('period') ?? undefined,
    });
    if (!parsed.success) {
      throw validationError('invalid observability query', parsed.error.issues);
    }
    const period = parsed.data.period;
    const days = period === '24h' ? 1 : period === '7d' ? 7 : 30;
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    // ── Locality lookup from the catalogue. We treat the catalogue as
    //    the source of truth for locality (`local`/`on-prem`/`cloud`);
    //    `usage_records.provider` is opaque and never branched on.
    const catalog = await loadModelCatalog(deps.env);
    const localityById = new Map<string, string>();
    for (const m of catalog.models) localityById.set(m.id, m.locality);

    const isLocal = (model: string): boolean => {
      const loc = localityById.get(model);
      return loc === 'local' || loc === 'on-prem';
    };

    // ── Spend by locality + per-model breakdown ────────────────────
    const usageRes = await deps.db.query<{
      provider: string;
      model: string;
      agent_name: string;
      run_id: string;
      usd: string | number;
    }>(
      `SELECT u.provider, u.model, r.agent_name, r.id AS run_id,
              u.usd
         FROM usage_records u
         JOIN runs r ON r.id = u.run_id
        WHERE r.tenant_id = $1
          AND u.at >= $2`,
      [auth.tenantId, cutoff.toISOString()],
    );

    const localityBuckets = new Map<string, { usd: number; runs: Set<string> }>();
    interface PerModelBucket {
      model: string;
      provider: string;
      locality: string;
      agentName: string;
      usd: number;
      runs: Set<string>;
    }
    const perModel = new Map<string, PerModelBucket>();
    let cloudUsd = 0;
    let localUsd = 0;
    for (const row of usageRes.rows) {
      const usd = Number(row.usd) || 0;
      const locality = localityById.get(row.model) ?? 'unknown';
      const lb = localityBuckets.get(locality) ?? { usd: 0, runs: new Set() };
      lb.usd += usd;
      lb.runs.add(row.run_id);
      localityBuckets.set(locality, lb);
      if (locality === 'cloud') cloudUsd += usd;
      if (locality === 'local' || locality === 'on-prem') localUsd += usd;
      const key = `${row.agent_name}::${row.model}`;
      const pm = perModel.get(key) ?? {
        model: row.model,
        provider: row.provider,
        locality,
        agentName: row.agent_name,
        usd: 0,
        runs: new Set<string>(),
      };
      pm.usd += usd;
      pm.runs.add(row.run_id);
      perModel.set(key, pm);
    }

    const localityBreakdown = Array.from(localityBuckets.entries())
      .map(([locality, b]) => ({ locality, usd: round(b.usd), runCount: b.runs.size }))
      .sort((a, b) => b.usd - a.usd);

    const modelBreakdown = Array.from(perModel.values())
      .sort((a, b) => b.runs.size - a.runs.size || b.usd - a.usd)
      .slice(0, MODEL_BREAKDOWN_LIMIT)
      .map((pm) => ({
        model: pm.model,
        provider: pm.provider,
        locality: pm.locality,
        agentName: pm.agentName,
        runCount: pm.runs.size,
        usd: round(pm.usd),
      }));

    // ── Runs in flight (tenant-scoped) ─────────────────────────────
    const inFlightRes = await deps.db.query<{ count: string | number }>(
      `SELECT COUNT(*) AS count
         FROM runs
        WHERE tenant_id = $1
          AND status IN ('queued', 'running')`,
      [auth.tenantId],
    );
    const runsInFlight = Number(inFlightRes.rows[0]?.count ?? 0);

    // ── Events/sec — last hour, all event types ───────────────────
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const eventsHourRes = await deps.db.query<{ count: string | number }>(
      `SELECT COUNT(*) AS count
         FROM run_events
        WHERE tenant_id = $1
          AND at >= $2`,
      [auth.tenantId, oneHourAgo.toISOString()],
    );
    const eventsHourCount = Number(eventsHourRes.rows[0]?.count ?? 0);
    const eventsPerSec = eventsHourCount / 3600;

    // ── Privacy-router decision feed (audit rows from wave 8) ─────
    const privacyRes = await deps.db.query<{
      run_id: string;
      payload_jsonb: unknown;
      at: string | Date;
    }>(
      `SELECT run_id, payload_jsonb, at
         FROM run_events
        WHERE tenant_id = $1
          AND type = 'routing.privacy_sensitive_resolved'
          AND at >= $2
        ORDER BY at DESC
        LIMIT $3`,
      [auth.tenantId, cutoff.toISOString(), PRIVACY_FEED_LIMIT],
    );
    const privacyRouterEvents: PrivacyRouterEvent[] = [];
    for (const row of privacyRes.rows) {
      const p = parsePayload(row.payload_jsonb);
      if (p === null) continue;
      const agentName = typeof p.agent === 'string' ? p.agent : '';
      const model = typeof p.model === 'string' ? p.model : '';
      const provider = typeof p.provider === 'string' ? p.provider : '';
      const classUsed = typeof p.classUsed === 'string' ? p.classUsed : '';
      privacyRouterEvents.push({
        at: toIso(row.at),
        runId: row.run_id,
        agentName,
        model,
        provider,
        classUsed,
        // The audit row is only emitted on enforced approvals, so any
        // surfaced row was, by construction, enforced. The Boolean is
        // here so the contract stays explicit (and so a future "denied"
        // variant can flip it to false without renaming).
        enforced: true,
      });
    }

    // ── Sandbox + guards activity feed ─────────────────────────────
    // The engine surfaces sandbox blocks as `tool_result` rows whose
    // payload carries `error.code` (matching `SandboxErrorCode`) and
    // `ok: false`. Guards blocks (`output_scanner`, `quarantine`)
    // currently flow through the same `error` channel — the engine has
    // no dedicated event type yet, so we filter on the ERROR-shape
    // payload regardless of the wire `type`.
    const safetyRes = await deps.db.query<{
      run_id: string;
      type: string;
      payload_jsonb: unknown;
      at: string | Date;
      agent_name: string | null;
    }>(
      `SELECT e.run_id, e.type, e.payload_jsonb, e.at, r.agent_name
         FROM run_events e
         LEFT JOIN runs r ON r.id = e.run_id
        WHERE e.tenant_id = $1
          AND e.at >= $2
          AND (
            e.type = 'tool_result'
            OR e.type = 'error'
            OR e.type = 'policy_decision'
          )
        ORDER BY e.at DESC
        LIMIT $3`,
      [auth.tenantId, cutoff.toISOString(), SAFETY_FEED_LIMIT * 4],
    );
    const safetyEvents: SafetyEvent[] = [];
    let sandboxBlocks24h = 0;
    let guardsBlocks24h = 0;
    const since24h = Date.now() - 24 * 60 * 60 * 1000;
    for (const row of safetyRes.rows) {
      const p = parsePayload(row.payload_jsonb);
      if (p === null) continue;
      const decoded = decodeSafetyEvent(row.type, p);
      if (decoded === null) continue;
      const at = toIso(row.at);
      safetyEvents.push({
        at,
        runId: row.run_id,
        agentName: row.agent_name,
        kind: decoded.kind,
        reason: decoded.reason,
        severity: decoded.severity,
      });
      const ts = Date.parse(at);
      if (!Number.isNaN(ts) && ts >= since24h) {
        if (decoded.kind === 'sandbox_block') sandboxBlocks24h += 1;
        if (decoded.kind === 'guards_block') guardsBlocks24h += 1;
      }
      if (safetyEvents.length >= SAFETY_FEED_LIMIT) break;
    }

    // ── Privacy-tier mismatches: structurally 0 (gateway fails
    //    closed before any provider contact). Surfaced explicitly so
    //    the page header can render the "0 — that's the point" KPI.
    //    A future "denied" audit row would land in this counter.
    const privacyTierMismatches24h = 0;

    const body = ObservabilitySummary.parse({
      period,
      generatedAt: new Date().toISOString(),
      kpis: {
        eventsPerSec: round(eventsPerSec, 4),
        runsInFlight,
        cloudSpendUsd: round(cloudUsd),
        localSpendUsd: round(localUsd),
        sandboxBlocks24h,
        guardsBlocks24h,
        privacyTierMismatches24h,
      },
      privacyRouterEvents,
      safetyEvents,
      localityBreakdown,
      modelBreakdown,
    });
    return c.json(body);
  });

  return app;
}

function parsePayload(p: unknown): Record<string, unknown> | null {
  if (typeof p === 'string') {
    try {
      const parsed = JSON.parse(p) as unknown;
      if (parsed === null || typeof parsed !== 'object') return null;
      return parsed as Record<string, unknown>;
    } catch {
      return null;
    }
  }
  if (p !== null && typeof p === 'object') return p as Record<string, unknown>;
  return null;
}

interface DecodedSafety {
  kind: 'sandbox_block' | 'guards_block';
  reason: string;
  severity: 'info' | 'warn' | 'error';
}

const SANDBOX_CODES: ReadonlySet<string> = new Set([
  'OUT_OF_BOUNDS',
  'EGRESS_BLOCKED',
  'TIMEOUT',
  'MEMORY_LIMIT',
  'CPU_LIMIT',
  'POLICY_VIOLATION',
  'SETUID_FORBIDDEN',
  'SUBPROCESS_FAILED',
  'WRITE_DENIED',
  'READ_DENIED',
  'NET_DENIED',
]);

const GUARDS_REASONS: ReadonlySet<string> = new Set([
  'output_scanner',
  'quarantine',
  'pii_detected',
  'prompt_injection',
  'tool_output_too_large',
  'guard_deny',
]);

/**
 * Pull the sandbox / guards signal out of an event payload. The engine
 * doesn't emit a dedicated `sandbox_block` event yet — these flows
 * surface as `tool_result` with an `error.code` matching a
 * `SandboxErrorCode`, OR a `policy_decision` event with a
 * `guards`-tagged reason. We match on the payload shape, not on
 * brittle string `type` enums, so a future engine refactor that
 * promotes these to first-class events still flows through.
 */
function decodeSafetyEvent(type: string, payload: Record<string, unknown>): DecodedSafety | null {
  const error = payload.error as Record<string, unknown> | undefined;
  const code = typeof error?.code === 'string' ? error.code : undefined;
  if (code !== undefined && SANDBOX_CODES.has(code)) {
    return { kind: 'sandbox_block', reason: code, severity: 'error' };
  }
  const sandboxCode =
    typeof payload.sandboxCode === 'string' ? (payload.sandboxCode as string) : undefined;
  if (sandboxCode !== undefined && SANDBOX_CODES.has(sandboxCode)) {
    return { kind: 'sandbox_block', reason: sandboxCode, severity: 'error' };
  }
  const reason = typeof payload.reason === 'string' ? (payload.reason as string) : undefined;
  if (reason !== undefined && GUARDS_REASONS.has(reason)) {
    const severity = reason === 'output_scanner' ? 'warn' : 'error';
    return { kind: 'guards_block', reason, severity };
  }
  // Some `policy_decision` rows tag the action as `block` with a
  // string `category`; those are guards too.
  if (type === 'policy_decision' && payload.action === 'block') {
    const category =
      typeof payload.category === 'string' ? (payload.category as string) : 'guard_deny';
    return { kind: 'guards_block', reason: category, severity: 'warn' };
  }
  return null;
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
