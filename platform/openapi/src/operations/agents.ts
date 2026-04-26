/**
 * Agent operations — list, fetch, register, promote, version pinning,
 * privacy-tier check.
 */

import {
  CheckAgentResponse,
  GetAgentResponse,
  ListAgentVersionsResponse,
  ListAgentsResponse,
  PromoteAgentRequest,
  PromoteAgentResponse,
  PromoteRegisteredAgentRequest,
  PromoteRegisteredAgentResponse,
  RegisterAgentJsonRequest,
  RegisterAgentResponse,
} from '@aldo-ai/api-contract';
import type { OpenAPIRegistry } from '../registry.js';
import {
  Resp401,
  Resp403,
  Resp404,
  Resp422,
  Resp422PrivacyTier,
  SECURITY_BOTH,
  jsonResponse,
  pathParam,
} from './_shared.js';

export function registerAgentOperations(reg: OpenAPIRegistry): void {
  reg.registerTag(
    'Agents',
    'Agent specs (data, versioned, eval-gated). Per CLAUDE.md non-negotiable #4.',
  );

  reg.registerPath({
    method: 'get',
    path: '/v1/agents',
    summary: 'List all agents in the current tenant',
    description:
      'Lists every agent visible to the calling tenant with its current version and metadata.',
    tags: ['Agents'],
    security: SECURITY_BOTH,
    responses: { '200': jsonResponse('Agents list.', ListAgentsResponse), '401': Resp401() },
  });

  reg.registerPath({
    method: 'post',
    path: '/v1/agents',
    summary: 'Register a new agent version',
    description:
      'Creates a new agent version from a YAML body. Re-registering the same name appends a new version row; the current version pointer is unchanged unless `setCurrent: true`.',
    tags: ['Agents'],
    security: SECURITY_BOTH,
    request: {
      required: true,
      content: { 'application/json': { schema: RegisterAgentJsonRequest } },
    },
    responses: {
      '200': jsonResponse('Agent registered.', RegisterAgentResponse),
      '401': Resp401(),
      '403': Resp403(),
      '422': Resp422(),
    },
  });

  reg.registerPath({
    method: 'get',
    path: '/v1/agents/{name}',
    summary: 'Fetch a single agent by name',
    description: "Returns the agent's currently-promoted version with its full spec.",
    tags: ['Agents'],
    security: SECURITY_BOTH,
    parameters: [pathParam('name', 'Agent name (slug).', '<agent-name>')],
    responses: {
      '200': jsonResponse('Agent detail.', GetAgentResponse),
      '401': Resp401(),
      '404': Resp404('Agent'),
    },
  });

  reg.registerPath({
    method: 'delete',
    path: '/v1/agents/{name}',
    summary: 'Delete an agent and all its versions',
    description:
      'Hard-deletes the agent record. Past runs that reference this agent retain their snapshot.',
    tags: ['Agents'],
    security: SECURITY_BOTH,
    parameters: [pathParam('name', 'Agent name.', '<agent-name>')],
    responses: { '204': { description: 'Deleted.' }, '401': Resp401(), '404': Resp404('Agent') },
  });

  reg.registerPath({
    method: 'get',
    path: '/v1/agents/{name}/versions',
    summary: 'List all versions of an agent',
    description: 'Returns every recorded version of the agent in registration order.',
    tags: ['Agents'],
    security: SECURITY_BOTH,
    parameters: [pathParam('name', 'Agent name.', '<agent-name>')],
    responses: {
      '200': jsonResponse('Version list.', ListAgentVersionsResponse),
      '401': Resp401(),
      '404': Resp404('Agent'),
    },
  });

  reg.registerPath({
    method: 'get',
    path: '/v1/agents/{name}/versions/{version}',
    summary: 'Fetch a specific agent version',
    description: 'Returns the spec exactly as registered for that version.',
    tags: ['Agents'],
    security: SECURITY_BOTH,
    parameters: [
      pathParam('name', 'Agent name.', '<agent-name>'),
      pathParam('version', 'Version string (e.g. `v3`).', '<version>'),
    ],
    responses: {
      '200': jsonResponse('Version detail.', GetAgentResponse),
      '401': Resp401(),
      '404': Resp404('Agent version'),
    },
  });

  reg.registerPath({
    method: 'post',
    path: '/v1/agents/{name}/check',
    summary: 'Run pre-flight privacy-tier + capability check',
    description:
      "Resolves the agent's privacy tier + capability requirements against the live model catalog WITHOUT executing the agent. Surfaces routing audit so an operator can debug `privacy_tier_unroutable` failures before kicking off a run.",
    tags: ['Agents'],
    security: SECURITY_BOTH,
    parameters: [pathParam('name', 'Agent name.', '<agent-name>')],
    responses: {
      '200': jsonResponse('Routing trace.', CheckAgentResponse),
      '401': Resp401(),
      '404': Resp404('Agent'),
      '422': Resp422PrivacyTier(),
    },
  });

  reg.registerPath({
    method: 'post',
    path: '/v1/agents/{name}/promote',
    summary: 'Promote a YAML body as the new current version',
    description:
      'Validates + persists the YAML and atomically points the current version pointer to it (eval-gate enforced server-side).',
    tags: ['Agents'],
    security: SECURITY_BOTH,
    parameters: [pathParam('name', 'Agent name.', '<agent-name>')],
    request: { required: true, content: { 'application/json': { schema: PromoteAgentRequest } } },
    responses: {
      '200': jsonResponse('Promoted.', PromoteAgentResponse),
      '401': Resp401(),
      '403': Resp403(),
      '422': Resp422(),
    },
  });

  reg.registerPath({
    method: 'post',
    path: '/v1/agents/{name}/set-current',
    summary: 'Set the current version pointer to an existing version',
    description:
      'No new content; just pivots the `current_version` to a previously-registered version. Used to roll back an unhealthy promotion.',
    tags: ['Agents'],
    security: SECURITY_BOTH,
    parameters: [pathParam('name', 'Agent name.', '<agent-name>')],
    request: {
      required: true,
      content: { 'application/json': { schema: PromoteRegisteredAgentRequest } },
    },
    responses: {
      '200': jsonResponse('Pointer updated.', PromoteRegisteredAgentResponse),
      '401': Resp401(),
      '403': Resp403(),
      '404': Resp404('Agent version'),
    },
  });
}
