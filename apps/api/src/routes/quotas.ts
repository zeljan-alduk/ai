/**
 * `/v1/quotas` — read-only quota snapshot for the caller's tenant.
 *
 * Wave-16 (Engineer 16D). Surface:
 *   GET /v1/quotas/me   echo back the (lazily-initialised) row.
 *
 * The web `/settings/quotas` page reads this to render usage vs cap
 * with a progress bar. The actual quota enforcement happens
 * server-side in `apps/api/src/quotas.ts`; clients NEVER need to
 * compute their own remaining quota.
 *
 * LLM-agnostic — provider names never appear here.
 */

import { GetMyQuotaResponse } from '@aldo-ai/api-contract';
import { Hono } from 'hono';
import { getAuth } from '../auth/middleware.js';
import type { Deps } from '../deps.js';
import { getTenantQuota } from '../quotas.js';

export function quotasRoutes(deps: Deps): Hono {
  const app = new Hono();

  app.get('/v1/quotas/me', async (c) => {
    const tenantId = getAuth(c).tenantId;
    const snap = await getTenantQuota(deps, tenantId);
    const body = GetMyQuotaResponse.parse({ quota: snap });
    return c.json(body);
  });

  return app;
}
