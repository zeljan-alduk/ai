/**
 * `/v1/tenants/...` — wave-10 tenant administration.
 *
 * Today there is one endpoint:
 *
 *   POST /v1/tenants/me/seed-default
 *     Copy every current-version agent from the `default` tenant
 *     (id = `00000000-0000-0000-0000-000000000000`, slug = `default`)
 *     into the caller's tenant. Wave-7.5's `/welcome` page calls this
 *     when a brand-new user clicks "Use the default agency template".
 *
 *   The endpoint is idempotent: rows that already exist in the caller's
 *   tenant under the same `(name, version)` are SKIPPED unless
 *   `?overwrite=true` is on the URL, in which case the source row is
 *   re-registered (overwriting the spec_yaml + bumping the pointer).
 *
 *   Returns `{copied: number, skipped: number}` so the welcome page can
 *   render a "<copied> agents seeded" toast.
 *
 * Tenant scoping: the caller's tenant is taken from the JWT
 * (`getAuth(c).tenantId`); the source tenant is the canonical default
 * UUID. A caller whose own tenant IS the default cannot self-seed —
 * we 409 with a precise message rather than silently no-op.
 *
 * LLM-agnostic: agent specs flow through verbatim; nothing here knows
 * what a "model" is.
 */

import { SeedDefaultResponse } from '@aldo-ai/api-contract';
import { copyTenantAgents } from '@aldo-ai/registry';
import { Hono } from 'hono';
import { z } from 'zod';
import { getAuth } from '../auth/middleware.js';
import { type Deps, SEED_TENANT_UUID } from '../deps.js';
import { HttpError, validationError } from '../middleware/error.js';
import {
  evaluateTenantBudget,
  getTenantBudgetCap,
  upsertTenantBudgetCap,
} from '../tenant-budget-store.js';

const BudgetCapBody = z.object({
  /**
   * Tenant USD ceiling. `null` removes the cap (the historical
   * default). Numbers must be > 0.
   */
  usdMax: z.number().positive().nullable(),
  /**
   * Inclusive lower bound the rolling sum starts from. ISO-8601 string;
   * omit / null = since-tenant-creation.
   */
  usdWindowStart: z.string().datetime().nullable().optional(),
  /**
   * `true` = in-flight runs receive a typed termination at the next
   * boundary when crossed. `false` = the cap fires the existing
   * `budget_threshold` notification but the run continues.
   */
  hardStop: z.boolean().optional(),
});

export function tenantsRoutes(deps: Deps): Hono {
  const app = new Hono();

  app.post('/v1/tenants/me/seed-default', async (c) => {
    const auth = getAuth(c);
    if (auth.tenantId === SEED_TENANT_UUID) {
      throw new HttpError(409, 'cannot_seed_self', 'the default tenant cannot seed itself');
    }
    const url = new URL(c.req.url);
    const overwrite = url.searchParams.get('overwrite') === 'true';
    const result = await copyTenantAgents(deps.agentStore, {
      fromTenantId: SEED_TENANT_UUID,
      toTenantId: auth.tenantId,
      overwrite,
    });
    const body = SeedDefaultResponse.parse(result);
    return c.json(body);
  });

  /**
   * `GET /v1/tenants/me/budget-cap` — read the engagement-level USD
   * cap for the caller's tenant. Returns `{ cap: null }` when no cap
   * is configured (the historical default — runs are unbounded).
   *
   * MISSING_PIECES §12.5.
   */
  app.get('/v1/tenants/me/budget-cap', async (c) => {
    const auth = getAuth(c);
    const cap = await getTenantBudgetCap(deps.db, auth.tenantId);
    const verdict = await evaluateTenantBudget(deps.db, auth.tenantId);
    return c.json({
      cap,
      currentUsd: verdict.totalUsd,
      // `softCap` reflects the configured row only — when no cap is
      // set, `softCap` is false and `allowed` is true.
      softCap: verdict.softCap,
      allowed: verdict.allowed,
    });
  });

  /**
   * `PUT /v1/tenants/me/budget-cap` — upsert the engagement cap.
   * Send `{ usdMax: null }` to clear it. The window start is
   * optional; omitting it pins the cap against tenant-creation.
   */
  app.put('/v1/tenants/me/budget-cap', async (c) => {
    const auth = getAuth(c);
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      throw validationError('request body must be JSON');
    }
    const parsed = BudgetCapBody.safeParse(body);
    if (!parsed.success) {
      throw validationError('invalid budget-cap body', parsed.error.issues);
    }
    const cap = await upsertTenantBudgetCap(deps.db, {
      tenantId: auth.tenantId,
      usdMax: parsed.data.usdMax,
      usdWindowStart: parsed.data.usdWindowStart ?? null,
      hardStop: parsed.data.hardStop ?? true,
    });
    return c.json({ cap });
  });

  return app;
}
