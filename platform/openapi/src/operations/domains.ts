/**
 * Domains operations — wave 16D.
 *
 *   POST   /v1/domains                  create + return TXT instructions
 *   GET    /v1/domains                  list (≤ 1 row for MVP)
 *   POST   /v1/domains/:hostname/verify TXT lookup + match
 *   DELETE /v1/domains/:hostname        remove
 *
 * Verification is exclusively via TXT record at
 * `_aldo-verification.<hostname>`. SSL is provisioned automatically
 * by Fly / Vercel once the TXT verification succeeds; the
 * `sslStatus` field is informational.
 */

import {
  CreateDomainRequest,
  CreateDomainResponse,
  DeleteDomainResponse,
  ListDomainsResponse,
  VerifyDomainResponse,
} from '@aldo-ai/api-contract';
import type { OpenAPIRegistry } from '../registry.js';
import {
  Resp401,
  Resp403,
  Resp404,
  Resp422,
  SECURITY_BOTH,
  jsonResponse,
  pathParam,
} from './_shared.js';

export function registerDomainOperations(reg: OpenAPIRegistry): void {
  reg.registerTag(
    'Domains',
    'Per-tenant custom domains. Verification is via TXT record; SSL provisioned automatically by Fly / Vercel.',
  );

  reg.registerPath({
    method: 'post',
    path: '/v1/domains',
    summary: 'Create / replace this tenant custom domain',
    description:
      'Seeds a `tenant_domains` row with a freshly-generated verification token. Returns the TXT record name + value the caller must publish at their DNS provider before calling /verify.',
    tags: ['Domains'],
    security: SECURITY_BOTH,
    request: {
      required: true,
      content: { 'application/json': { schema: CreateDomainRequest } },
    },
    responses: {
      '201': jsonResponse('Domain created.', CreateDomainResponse),
      '401': Resp401(),
      '403': Resp403(),
      '422': Resp422(),
    },
  });

  reg.registerPath({
    method: 'get',
    path: '/v1/domains',
    summary: 'List custom domains for this tenant',
    description: 'Returns the (at most one) custom domain registered for the caller tenant.',
    tags: ['Domains'],
    security: SECURITY_BOTH,
    responses: {
      '200': jsonResponse('Custom domains.', ListDomainsResponse),
      '401': Resp401(),
    },
  });

  reg.registerPath({
    method: 'post',
    path: '/v1/domains/{hostname}/verify',
    summary: 'Verify a custom domain via TXT record lookup',
    description:
      'Resolves `_aldo-verification.<hostname>` and matches the TXT value against the stored verification token. Caps the lookup at 10 seconds. Returns 200 with `verified=false` + `reason` on a TXT mismatch / DNS timeout.',
    tags: ['Domains'],
    security: SECURITY_BOTH,
    parameters: [pathParam('hostname', 'The hostname to verify (e.g. agents.acme-corp.com).')],
    responses: {
      '200': jsonResponse(
        'Verification result. `verified=false` with a `reason` field is also returned at this status when the TXT record check failed (the API uses a single 200 envelope rather than mapping deny to 4xx — clients render the `reason` inline).',
        VerifyDomainResponse,
      ),
      '401': Resp401(),
      '403': Resp403(),
      '404': Resp404('domain'),
      '422': Resp422(),
    },
  });

  reg.registerPath({
    method: 'delete',
    path: '/v1/domains/{hostname}',
    summary: 'Remove a custom domain',
    description:
      'Removes the `tenant_domains` row. SSL certificates issued by Fly / Vercel are NOT revoked here — operators must clean those up out of band.',
    tags: ['Domains'],
    security: SECURITY_BOTH,
    parameters: [pathParam('hostname', 'The hostname to remove.')],
    responses: {
      '200': jsonResponse('Domain removed.', DeleteDomainResponse),
      '401': Resp401(),
      '403': Resp403(),
      '404': Resp404('domain'),
    },
  });
}
