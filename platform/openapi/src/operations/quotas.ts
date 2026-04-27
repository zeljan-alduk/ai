/**
 * Quotas operations — wave 16D.
 *
 *   GET /v1/quotas/me   read the caller's tenant quota snapshot.
 *
 * The quota row is lazily seeded on first read with the trial-plan
 * defaults; an existing row is returned verbatim. Enforcement
 * happens in the run / cost write paths — clients never need to
 * compute their own remaining quota.
 */

import { GetMyQuotaResponse } from '@aldo-ai/api-contract';
import type { OpenAPIRegistry } from '../registry.js';
import { Resp401, SECURITY_BOTH, jsonResponse } from './_shared.js';

export function registerQuotaOperations(reg: OpenAPIRegistry): void {
  reg.registerTag(
    'Quotas',
    'Per-tenant monthly run + cost allowance. Enforced server-side; clients read for UI.',
  );

  reg.registerPath({
    method: 'get',
    path: '/v1/quotas/me',
    summary: "Read this tenant's monthly quota snapshot",
    description:
      "Returns the caller's plan + run / cost caps + month-to-date usage + reset timestamp. The row is lazily seeded with the trial-plan defaults on first read.",
    tags: ['Quotas'],
    security: SECURITY_BOTH,
    responses: {
      '200': jsonResponse('Current quota snapshot.', GetMyQuotaResponse),
      '401': Resp401(),
    },
  });
}
