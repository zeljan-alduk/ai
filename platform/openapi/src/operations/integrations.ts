/**
 * Outbound integration operations — Slack, GitHub, Discord, generic webhooks.
 */

import {
  CreateIntegrationRequest,
  IntegrationResponse,
  ListIntegrationsResponse,
  TestFireResponse,
  UpdateIntegrationRequest,
} from '@aldo-ai/api-contract';
import type { OpenAPIRegistry } from '../registry.js';
import { Resp401, Resp404, Resp422, SECURITY_BOTH, jsonResponse, pathParam } from './_shared.js';

export function registerIntegrationOperations(reg: OpenAPIRegistry): void {
  reg.registerTag(
    'Integrations',
    'Outbound integrations: Slack, GitHub, Discord, generic webhooks.',
  );

  reg.registerPath({
    method: 'get',
    path: '/v1/integrations',
    summary: 'List integrations',
    description: 'Returns the list of configured outbound integrations for the tenant.',
    tags: ['Integrations'],
    security: SECURITY_BOTH,
    responses: {
      '200': jsonResponse('Integration list.', ListIntegrationsResponse),
      '401': Resp401(),
    },
  });

  reg.registerPath({
    method: 'post',
    path: '/v1/integrations',
    summary: 'Create an integration',
    description:
      'Registers a new outbound integration. Secrets (e.g. webhook signing) are stored encrypted.',
    tags: ['Integrations'],
    security: SECURITY_BOTH,
    request: {
      required: true,
      content: { 'application/json': { schema: CreateIntegrationRequest } },
    },
    responses: {
      '200': jsonResponse('Created.', IntegrationResponse),
      '401': Resp401(),
      '422': Resp422(),
    },
  });

  reg.registerPath({
    method: 'get',
    path: '/v1/integrations/{id}',
    summary: 'Fetch one integration',
    description: 'Returns the integration record.',
    tags: ['Integrations'],
    security: SECURITY_BOTH,
    parameters: [pathParam('id', 'Integration id.', '<integration-id>')],
    responses: {
      '200': jsonResponse('Integration.', IntegrationResponse),
      '401': Resp401(),
      '404': Resp404('Integration'),
    },
  });

  reg.registerPath({
    method: 'patch',
    path: '/v1/integrations/{id}',
    summary: 'Update an integration',
    description: 'Partial update.',
    tags: ['Integrations'],
    security: SECURITY_BOTH,
    parameters: [pathParam('id', 'Integration id.', '<integration-id>')],
    request: {
      required: true,
      content: { 'application/json': { schema: UpdateIntegrationRequest } },
    },
    responses: {
      '200': jsonResponse('Updated.', IntegrationResponse),
      '401': Resp401(),
      '404': Resp404('Integration'),
    },
  });

  reg.registerPath({
    method: 'delete',
    path: '/v1/integrations/{id}',
    summary: 'Delete an integration',
    description: 'Hard-delete; the integration is no longer dispatched to.',
    tags: ['Integrations'],
    security: SECURITY_BOTH,
    parameters: [pathParam('id', 'Integration id.', '<integration-id>')],
    responses: { '204': { description: 'Deleted.' }, '401': Resp401() },
  });

  reg.registerPath({
    method: 'post',
    path: '/v1/integrations/{id}/test',
    summary: 'Send a test payload',
    description:
      'Exercises the integration end-to-end with a synthetic event. Useful for verifying webhook signatures.',
    tags: ['Integrations'],
    security: SECURITY_BOTH,
    parameters: [pathParam('id', 'Integration id.', '<integration-id>')],
    responses: {
      '200': jsonResponse('Test result.', TestFireResponse),
      '401': Resp401(),
      '404': Resp404('Integration'),
    },
  });
}
