/**
 * Secrets operations — list / set / delete tenant-scoped secrets.
 * Values are NEVER returned over the wire after a `set`.
 */

import { ListSecretsResponse, SecretSummary, SetSecretRequest } from '@aldo-ai/api-contract';
import type { OpenAPIRegistry } from '../registry.js';
import { Resp401, Resp404, Resp422, SECURITY_BOTH, jsonResponse, pathParam } from './_shared.js';

export function registerSecretOperations(reg: OpenAPIRegistry): void {
  reg.registerTag(
    'Secrets',
    'Tenant-scoped secrets for tool integrations. Values are write-only over the wire.',
  );

  reg.registerPath({
    method: 'get',
    path: '/v1/secrets',
    summary: 'List secrets (redacted)',
    description: 'Returns secret names + metadata. The actual values are never echoed back.',
    tags: ['Secrets'],
    security: SECURITY_BOTH,
    responses: { '200': jsonResponse('Secret list.', ListSecretsResponse), '401': Resp401() },
  });

  reg.registerPath({
    method: 'post',
    path: '/v1/secrets',
    summary: 'Set or rotate a secret',
    description:
      'Creates or replaces a secret value for the tenant. The response carries the redacted summary only.',
    tags: ['Secrets'],
    security: SECURITY_BOTH,
    request: { required: true, content: { 'application/json': { schema: SetSecretRequest } } },
    responses: {
      '200': jsonResponse('Secret persisted.', SecretSummary),
      '401': Resp401(),
      '422': Resp422(),
    },
  });

  reg.registerPath({
    method: 'delete',
    path: '/v1/secrets/{name}',
    summary: 'Delete a secret',
    description:
      'Hard-deletes the secret value. Pre-existing references in agent specs will fail their next run.',
    tags: ['Secrets'],
    security: SECURITY_BOTH,
    parameters: [pathParam('name', 'Secret name.', '<secret-name>')],
    responses: { '204': { description: 'Deleted.' }, '401': Resp401(), '404': Resp404('Secret') },
  });
}
