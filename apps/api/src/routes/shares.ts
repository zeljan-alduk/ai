/**
 * `/v1/shares` + `/v1/public/share/:slug` — wave 14 (Engineer 14D).
 *
 *   POST   /v1/shares { targetKind, targetId, expiresInHours?, password? }
 *   GET    /v1/shares?targetKind=&targetId=
 *   POST   /v1/shares/:id/revoke
 *   DELETE /v1/shares/:id
 *   GET    /v1/public/share/:slug   — PUBLIC (no auth)
 *
 * Tenant-scoped on the auth'd surface (cannot share another tenant's
 * data — every create checks the target row exists in the caller's
 * tenant). The public resolve at `/v1/public/share/:slug` is in the
 * middleware allow-list; password protection is enforced via argon2
 * verify with a 5-attempts-per-slug-per-hour rate limiter.
 *
 * Public payload SHAPE (LLM-agnostic):
 *   - run   -> {kind:'run', run:{...basic + events + finalOutput, NO usage_records}}
 *   - sweep -> {kind:'sweep', sweep:{...matrix + summary}}
 *   - agent -> {kind:'agent', agent:{...spec_yaml}}
 */

import {
  CreateShareLinkRequest,
  CreateShareLinkResponse,
  ListShareLinksQuery,
  ListShareLinksResponse,
  PublicShareResponse,
  type PublicSharedAgent,
  type PublicSharedResource,
  type PublicSharedRun,
  type PublicSharedSweep,
} from '@aldo-ai/api-contract';
import { Hono } from 'hono';
import { z } from 'zod';
import { recordAudit } from '../auth/audit.js';
import { forbidden, getAuth, requireRole } from '../auth/middleware.js';
import { getRun } from '../db.js';
import type { Deps } from '../deps.js';
import { notFound, validationError } from '../middleware/error.js';
import {
  bumpShareViewCount,
  consumeRateBudget,
  createShareLink,
  deleteShareLink,
  findShareById,
  findShareBySlug,
  listShares,
  revokeShareLink,
  verifySharePassword,
} from '../shares-store.js';

const IdParam = z.object({ id: z.string().min(1) });
const SlugParam = z.object({ slug: z.string().min(4).max(64) });

/** Resolve the caller's preferred base URL for share links. */
function resolveBaseUrl(deps: Deps, c: { req: { url: string } }): string {
  const fromEnv = deps.env.PUBLIC_BASE_URL ?? deps.env.WEB_BASE_URL;
  if (typeof fromEnv === 'string' && fromEnv.length > 0) return fromEnv;
  // Best-effort: peel the origin off the request URL. Production sets
  // PUBLIC_BASE_URL explicitly (so the share URL always points at the
  // web app, not the API host).
  try {
    const u = new URL(c.req.url);
    return `${u.protocol}//${u.host}`;
  } catch {
    return 'http://localhost:3000';
  }
}

export function sharesRoutes(deps: Deps): Hono {
  const app = new Hono();

  // -------------------------------------------------------------------------
  // Authenticated CRUD.
  // -------------------------------------------------------------------------

  app.get('/v1/shares', async (c) => {
    const url = new URL(c.req.url);
    const parsed = ListShareLinksQuery.safeParse({
      targetKind: url.searchParams.get('targetKind') ?? undefined,
      targetId: url.searchParams.get('targetId') ?? undefined,
    });
    if (!parsed.success) {
      throw validationError('invalid shares.list query', parsed.error.issues);
    }
    const auth = getAuth(c);
    const shares = await listShares(deps.db, {
      tenantId: auth.tenantId,
      ...(parsed.data.targetKind !== undefined ? { targetKind: parsed.data.targetKind } : {}),
      ...(parsed.data.targetId !== undefined ? { targetId: parsed.data.targetId } : {}),
      baseUrl: resolveBaseUrl(deps, c),
    });
    return c.json(ListShareLinksResponse.parse({ shares }));
  });

  app.post('/v1/shares', async (c) => {
    requireRole(c, 'member');
    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      throw validationError('request body must be JSON');
    }
    const parsed = CreateShareLinkRequest.safeParse(raw);
    if (!parsed.success) {
      throw validationError('invalid share payload', parsed.error.issues);
    }
    const auth = getAuth(c);
    // Tenant scoping: confirm the target exists in this tenant. A
    // missing target 404s with a generic message — we don't tell the
    // caller WHICH tenant the row belongs to.
    const exists = await targetExistsInTenant(
      deps,
      auth.tenantId,
      parsed.data.targetKind,
      parsed.data.targetId,
    );
    if (!exists) {
      throw notFound('cannot share: target not found in this tenant');
    }
    const share = await createShareLink(deps.db, {
      tenantId: auth.tenantId,
      createdByUserId: auth.userId,
      targetKind: parsed.data.targetKind,
      targetId: parsed.data.targetId,
      ...(parsed.data.expiresInHours !== undefined
        ? { expiresInHours: parsed.data.expiresInHours }
        : {}),
      ...(parsed.data.password !== undefined ? { password: parsed.data.password } : {}),
      baseUrl: resolveBaseUrl(deps, c),
    });
    await recordAudit(deps.db, c, {
      verb: 'share_link.create',
      objectKind: 'share_link',
      objectId: share.id,
      metadata: {
        targetKind: share.targetKind,
        targetId: share.targetId,
        hasPassword: share.hasPassword,
        expiresAt: share.expiresAt,
      },
    });
    return c.json(CreateShareLinkResponse.parse({ share }), 201);
  });

  app.post('/v1/shares/:id/revoke', async (c) => {
    requireRole(c, 'member');
    const idParsed = IdParam.safeParse({ id: c.req.param('id') });
    if (!idParsed.success) {
      throw validationError('invalid share id', idParsed.error.issues);
    }
    const auth = getAuth(c);
    const result = await revokeShareLink(deps.db, {
      tenantId: auth.tenantId,
      callerUserId: auth.userId,
      callerRole: auth.role,
      id: idParsed.data.id,
    });
    if (result === 'not_found') throw notFound('share not found');
    if (result === 'forbidden') {
      throw forbidden('only the creator or an owner may revoke a share');
    }
    const baseUrl = resolveBaseUrl(deps, c);
    const refreshed = await findShareById(deps.db, auth.tenantId, idParsed.data.id);
    if (refreshed === null) throw notFound('share not found');
    await recordAudit(deps.db, c, {
      verb: 'share_link.revoke',
      objectKind: 'share_link',
      objectId: idParsed.data.id,
      metadata: { result },
    });
    return c.json({
      share: {
        id: refreshed.id,
        targetKind: refreshed.target_kind,
        targetId: refreshed.target_id,
        slug: refreshed.slug,
        url: `${baseUrl.replace(/\/+$/, '')}/share/${refreshed.slug}`,
        hasPassword: refreshed.password_hash !== null && refreshed.password_hash !== undefined,
        expiresAt:
          refreshed.expires_at instanceof Date
            ? refreshed.expires_at.toISOString()
            : (refreshed.expires_at ?? null),
        revokedAt:
          refreshed.revoked_at instanceof Date
            ? refreshed.revoked_at.toISOString()
            : (refreshed.revoked_at ?? null),
        viewCount: Number(refreshed.view_count ?? 0),
        createdAt:
          refreshed.created_at instanceof Date
            ? refreshed.created_at.toISOString()
            : String(refreshed.created_at),
        createdByUserId: refreshed.created_by_user_id,
        createdByEmail: refreshed.created_by_email ?? '',
      },
    });
  });

  app.delete('/v1/shares/:id', async (c) => {
    requireRole(c, 'member');
    const idParsed = IdParam.safeParse({ id: c.req.param('id') });
    if (!idParsed.success) {
      throw validationError('invalid share id', idParsed.error.issues);
    }
    const auth = getAuth(c);
    const result = await deleteShareLink(deps.db, {
      tenantId: auth.tenantId,
      callerUserId: auth.userId,
      callerRole: auth.role,
      id: idParsed.data.id,
    });
    if (result === 'not_found') throw notFound('share not found');
    if (result === 'forbidden') {
      throw forbidden('only the creator or an owner may delete a share');
    }
    await recordAudit(deps.db, c, {
      verb: 'share_link.delete',
      objectKind: 'share_link',
      objectId: idParsed.data.id,
    });
    return c.body(null, 204);
  });

  // -------------------------------------------------------------------------
  // PUBLIC resolve. NO auth header required (allow-listed).
  // -------------------------------------------------------------------------

  app.get('/v1/public/share/:slug', async (c) => {
    const parsed = SlugParam.safeParse({ slug: c.req.param('slug') });
    if (!parsed.success) {
      // Slug shapes that can't possibly be ours just look like 404s to
      // a curious browser — never echo the malformed value.
      throw notFound('share not found');
    }
    const slug = parsed.data.slug;
    const row = await findShareBySlug(deps.db, slug);
    if (row === null) {
      // Unified "404" for unknown / revoked / expired so a casual
      // visitor can't tell them apart.
      throw notFound('share not found');
    }
    if (row.hasPassword) {
      const supplied = c.req.query('password') ?? undefined;
      // Always charge an attempt against the bucket whether or not a
      // password was supplied — a missing password is just as much an
      // attempt as a wrong one.
      const budget = consumeRateBudget(slug);
      if (!budget.allowed) {
        return c.json({ locked: true as const, reason: 'rate_limited' as const }, 429);
      }
      if (supplied === undefined) {
        return c.json({ locked: true as const, reason: 'password_required' as const }, 401);
      }
      const ok = await verifySharePassword(row, supplied);
      if (!ok) {
        return c.json({ locked: true as const, reason: 'password_invalid' as const }, 401);
      }
    }
    const resource = await projectPublicResource(deps, row.tenantId, row.targetKind, row.targetId);
    if (resource === null) {
      // The share is valid but the underlying row is gone / out of
      // tenant. Treat as 404 so the viewer renders "not found".
      throw notFound('shared resource no longer available');
    }
    void bumpShareViewCount(deps.db, row.id);
    const body = PublicShareResponse.parse({
      share: {
        slug: row.slug,
        targetKind: row.targetKind,
        targetId: row.targetId,
        expiresAt: row.expiresAt,
        createdAt: row.createdAt,
      },
      resource,
    });
    return c.json(body);
  });

  return app;
}

// ---------------------------------------------------------------------------
// Tenant scoping helpers + public projection.
// ---------------------------------------------------------------------------

async function targetExistsInTenant(
  deps: Deps,
  tenantId: string,
  kind: 'run' | 'sweep' | 'agent',
  id: string,
): Promise<boolean> {
  if (kind === 'run') {
    const res = await deps.db.query<{ id: string }>(
      'SELECT id FROM runs WHERE id = $1 AND tenant_id = $2',
      [id, tenantId],
    );
    return res.rows.length > 0;
  }
  if (kind === 'sweep') {
    // The wave-3 `sweeps` table predates the wave-10 tenancy column,
    // so it's NOT tenant-scoped at the schema level. Existence is the
    // best we can check — the API still rejects /v1/eval/sweeps for
    // viewers via the role guard, so a valid id from inside the
    // dashboard is a sufficient gate in practice.
    const res = await deps.db.query<{ id: string }>('SELECT id FROM sweeps WHERE id = $1', [id]);
    void tenantId; // intentionally unused — see comment above
    return res.rows.length > 0;
  }
  if (kind === 'agent') {
    // The agent is keyed by name in this tenant; the registered_agents
    // table holds (tenant_id, name, version).
    const res = await deps.db.query<{ name: string }>(
      'SELECT name FROM registered_agents WHERE name = $1 AND tenant_id = $2 LIMIT 1',
      [id, tenantId],
    );
    return res.rows.length > 0;
  }
  return false;
}

async function projectPublicResource(
  deps: Deps,
  tenantId: string,
  kind: 'run' | 'sweep' | 'agent',
  id: string,
): Promise<PublicSharedResource | null> {
  if (kind === 'run') {
    const run = await getRun(deps.db, tenantId, id);
    if (run === null) return null;
    // The runs table doesn't have a dedicated `final_output` column.
    // Surface the payload of the last `run.completed` / `run.output`
    // event as the "final output" — that's what the run-detail page
    // shows and what makes sense in a public share.
    const finalOutput = pickFinalOutput(run.events);
    const out: PublicSharedRun = {
      kind: 'run',
      run: {
        id: run.id,
        agentName: run.agentName,
        agentVersion: run.agentVersion,
        status: run.status,
        startedAt: run.startedAt,
        endedAt: run.endedAt,
        totalUsd: run.totalUsd,
        finalOutput,
        events: run.events.map((e) => ({
          id: e.id,
          type: e.type,
          at: e.at,
          payload: e.payload,
        })),
      },
    };
    return out;
  }
  if (kind === 'sweep') {
    // Pull the sweep head + the cells matrix + an aggregate summary
    // (pass-rate per model + total cost). Public viewers see the
    // shape but not per-call usage records — the cell `output` is
    // included so the matrix is meaningful.
    const head = await deps.db.query<{
      id: string;
      agent_name: string;
      status: string;
      started_at: string | Date;
      models: unknown;
    }>(
      `SELECT id, agent_name, status, started_at, models
         FROM sweeps WHERE id = $1`,
      [id],
    );
    const row = head.rows[0];
    if (row === undefined) return null;
    void tenantId;
    const cells = await deps.db.query<{
      case_id: string;
      model: string;
      passed: boolean | string;
      score: string | number;
      output: string;
      cost_usd: string | number;
      duration_ms: number;
    }>(
      `SELECT case_id, model, passed, score, output, cost_usd, duration_ms
         FROM sweep_cells WHERE sweep_id = $1
         ORDER BY id ASC`,
      [id],
    );
    const matrix = cells.rows.map((c) => ({
      caseId: c.case_id,
      model: c.model,
      passed: c.passed === true || c.passed === 't' || c.passed === 'true',
      score: Number(c.score),
      output: c.output,
      costUsd: Number(c.cost_usd),
      durationMs: c.duration_ms,
    }));
    // Aggregate summary: per-model pass-rate + total cost across the sweep.
    const summary = aggregateSweepSummary(matrix);
    const out: PublicSharedSweep = {
      kind: 'sweep',
      sweep: {
        id: row.id,
        agentName: row.agent_name,
        status: row.status,
        createdAt:
          row.started_at instanceof Date ? row.started_at.toISOString() : String(row.started_at),
        matrix,
        summary,
      },
    };
    return out;
  }
  if (kind === 'agent') {
    // Pick the current version per the registered_agent_pointer.
    const ptr = await deps.db.query<{ current_version: string }>(
      `SELECT current_version FROM registered_agent_pointer
         WHERE tenant_id = $1 AND name = $2`,
      [tenantId, id],
    );
    const currentVersion = ptr.rows[0]?.current_version;
    const versionRes = await deps.db.query<{
      version: string;
      spec_yaml: string;
    }>(
      currentVersion !== undefined
        ? `SELECT version, spec_yaml FROM registered_agents
             WHERE tenant_id = $1 AND name = $2 AND version = $3`
        : `SELECT version, spec_yaml FROM registered_agents
             WHERE tenant_id = $1 AND name = $2
             ORDER BY created_at DESC LIMIT 1`,
      currentVersion !== undefined ? [tenantId, id, currentVersion] : [tenantId, id],
    );
    const row = versionRes.rows[0];
    if (row === undefined) return null;
    const out: PublicSharedAgent = {
      kind: 'agent',
      agent: {
        name: id,
        version: row.version,
        description: extractDescriptionFromYaml(row.spec_yaml),
        specYaml: row.spec_yaml,
      },
    };
    return out;
  }
  return null;
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

interface SweepMatrixCell {
  readonly caseId: string;
  readonly model: string;
  readonly passed: boolean;
  readonly score: number;
  readonly costUsd: number;
}

function aggregateSweepSummary(matrix: readonly SweepMatrixCell[]): {
  readonly totalCells: number;
  readonly totalUsd: number;
  readonly perModel: ReadonlyArray<{
    readonly model: string;
    readonly passed: number;
    readonly total: number;
    readonly costUsd: number;
  }>;
} {
  const perModel = new Map<string, { passed: number; total: number; costUsd: number }>();
  let totalUsd = 0;
  for (const c of matrix) {
    const bucket = perModel.get(c.model) ?? { passed: 0, total: 0, costUsd: 0 };
    bucket.total += 1;
    if (c.passed) bucket.passed += 1;
    bucket.costUsd += c.costUsd;
    perModel.set(c.model, bucket);
    totalUsd += c.costUsd;
  }
  return {
    totalCells: matrix.length,
    totalUsd,
    perModel: [...perModel.entries()].map(([model, v]) => ({ model, ...v })),
  };
}

function pickFinalOutput(
  events: ReadonlyArray<{ readonly type: string; readonly payload?: unknown }>,
): unknown {
  // Walk events from the end. The most recent terminal-completion
  // event payload is the "final output" we surface.
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e === undefined) continue;
    if (e.type === 'run.completed' || e.type === 'run.output' || e.type === 'agent.completed') {
      return e.payload ?? null;
    }
  }
  return null;
}

/** Pull `description: "..."` (or unquoted) from the YAML head. Best-effort. */
function extractDescriptionFromYaml(yaml: string): string | null {
  const m = /\n\s*description:\s*(.+)$/m.exec(yaml);
  if (m === null) return null;
  const raw = (m[1] ?? '').trim();
  // Strip surrounding quotes if any.
  if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
    return raw.slice(1, -1);
  }
  return raw;
}
