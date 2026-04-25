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
import { getAuth } from '../auth/middleware.js';
import { type Deps, SEED_TENANT_UUID } from '../deps.js';
import { HttpError } from '../middleware/error.js';

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

  return app;
}
