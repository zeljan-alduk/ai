/**
 * Cache operations — wave 16C.
 *
 *   GET   /v1/cache/stats           tenant-scoped snapshot.
 *   POST  /v1/cache/purge           owner-only.
 *   GET   /v1/cache/policy          read current policy.
 *   PATCH /v1/cache/policy          admin/owner update.
 */

import {
  CachePolicyResponse,
  CachePurgeRequest,
  CachePurgeResponse,
  CacheStatsResponse,
  UpdateCachePolicyRequest,
} from '@aldo-ai/api-contract';
import type { OpenAPIRegistry } from '../registry.js';
import { Resp401, Resp403, Resp422, SECURITY_BOTH, jsonResponse, queryParam } from './_shared.js';

export function registerCacheOperations(reg: OpenAPIRegistry): void {
  reg.registerTag(
    'Cache',
    'LLM-response cache. Tenant-scoped; sensitive privacy tier SKIPS the cache by default.',
  );

  reg.registerPath({
    method: 'get',
    path: '/v1/cache/stats',
    summary: 'Cache hit/miss + savings snapshot',
    description:
      'Returns hit count, miss count, hit rate, total $ saved, and a per-model breakdown for the selected period.',
    tags: ['Cache'],
    security: SECURITY_BOTH,
    parameters: [
      queryParam('period', 'Time window — `24h`, `7d`, or `30d`. Defaults to `24h`.', {
        type: 'string',
        enum: ['24h', '7d', '30d'],
      }),
    ],
    responses: {
      '200': jsonResponse('Cache stats snapshot.', CacheStatsResponse),
      '401': Resp401(),
      '422': Resp422(),
    },
  });

  reg.registerPath({
    method: 'post',
    path: '/v1/cache/purge',
    summary: 'Purge cached entries (owner only)',
    description:
      'Removes cached entries matching the optional `olderThan` (ISO ts) and/or `model` filters. Empty body purges everything for the tenant.',
    tags: ['Cache'],
    security: SECURITY_BOTH,
    request: {
      required: false,
      content: { 'application/json': { schema: CachePurgeRequest } },
    },
    responses: {
      '200': jsonResponse('Number of rows purged.', CachePurgeResponse),
      '401': Resp401(),
      '403': Resp403(),
      '422': Resp422(),
    },
  });

  reg.registerPath({
    method: 'get',
    path: '/v1/cache/policy',
    summary: 'Read the per-tenant cache policy',
    description:
      'Returns enabled flag, TTL in seconds, and the sensitive-tier opt-in flag. Defaults to enabled + 24h + sensitive-skip when unset.',
    tags: ['Cache'],
    security: SECURITY_BOTH,
    responses: {
      '200': jsonResponse('Current policy.', CachePolicyResponse),
      '401': Resp401(),
    },
  });

  reg.registerPath({
    method: 'patch',
    path: '/v1/cache/policy',
    summary: 'Update the per-tenant cache policy (admin/owner)',
    description:
      'Patch any subset of `enabled` / `ttlSeconds` / `cacheSensitive`. TTL is clamped to the supported range (1 minute … 30 days).',
    tags: ['Cache'],
    security: SECURITY_BOTH,
    request: {
      required: true,
      content: { 'application/json': { schema: UpdateCachePolicyRequest } },
    },
    responses: {
      '200': jsonResponse('Updated policy.', CachePolicyResponse),
      '401': Resp401(),
      '403': Resp403(),
      '422': Resp422(),
    },
  });
}
