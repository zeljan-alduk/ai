/**
 * Admin surfaces — api-keys, invitations, members, audit log, design
 * partner application admin.
 *
 * Most of these gate on `requireRole(c, 'admin')` server-side; the spec
 * still uses the standard auth schemes since RBAC is not modelled in
 * OpenAPI security.
 */

import {
  CreateApiKeyRequest,
  CreateApiKeyResponse,
  CreateInvitationRequest,
  CreateInvitationResponse,
  Invitation,
  ListApiKeysResponse,
  ListAuditLogResponse,
  ListDesignPartnerApplicationsResponse,
  ListInvitationsResponse,
  ListMembersResponse,
  Member,
  UpdateMemberRequest,
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

export function registerAdminOperations(reg: OpenAPIRegistry): void {
  reg.registerTag('API Keys', 'Programmatic API keys (`aldo_live_…`) with scope-based RBAC.');
  reg.registerTag('Invitations', 'Tenant invitations + acceptance flow.');
  reg.registerTag('Members', 'Tenant member listing + role updates.');
  reg.registerTag('Audit', 'Tenant audit log (admin-only).');
  reg.registerTag('Tenants', 'Tenant-scoped admin surfaces.');
  reg.registerTag('Design Partners', 'Public application form + admin review surfaces.');

  // -- API keys ---------------------------------------------------------------
  reg.registerPath({
    method: 'get',
    path: '/v1/api-keys',
    summary: 'List API keys for the tenant',
    description:
      'Returns the redacted summary of every active API key. Plaintext is only returned at create time.',
    tags: ['API Keys'],
    security: SECURITY_BOTH,
    responses: {
      '200': jsonResponse('API key list.', ListApiKeysResponse),
      '401': Resp401(),
      '403': Resp403(),
    },
  });

  reg.registerPath({
    method: 'post',
    path: '/v1/api-keys',
    summary: 'Mint a new API key',
    description:
      'Creates a new key. The plaintext token is in the response body — store it; subsequent reads return only the redacted summary.',
    tags: ['API Keys'],
    security: SECURITY_BOTH,
    request: { required: true, content: { 'application/json': { schema: CreateApiKeyRequest } } },
    responses: {
      '200': jsonResponse('Created (plaintext token in body).', CreateApiKeyResponse),
      '401': Resp401(),
      '403': Resp403(),
      '422': Resp422(),
    },
  });

  reg.registerPath({
    method: 'post',
    path: '/v1/api-keys/{id}/revoke',
    summary: 'Revoke an API key',
    description: 'Marks the key revoked; subsequent bearer use returns 401.',
    tags: ['API Keys'],
    security: SECURITY_BOTH,
    parameters: [pathParam('id', 'API-key id (the prefix-tagged uuid).', '<api-key-id>')],
    responses: {
      '200': jsonResponse('Revoked.', { type: 'object', properties: { ok: { type: 'boolean' } } }),
      '401': Resp401(),
      '404': Resp404('API key'),
    },
  });

  reg.registerPath({
    method: 'delete',
    path: '/v1/api-keys/{id}',
    summary: 'Delete an API key record',
    description: 'Hard-delete after revocation. Idempotent.',
    tags: ['API Keys'],
    security: SECURITY_BOTH,
    parameters: [pathParam('id', 'API-key id.', '<api-key-id>')],
    responses: { '204': { description: 'Deleted.' }, '401': Resp401() },
  });

  // -- Invitations ------------------------------------------------------------
  reg.registerPath({
    method: 'get',
    path: '/v1/invitations',
    summary: 'List pending invitations',
    description: 'Lists invitations for the tenant.',
    tags: ['Invitations'],
    security: SECURITY_BOTH,
    responses: { '200': jsonResponse('Invitations.', ListInvitationsResponse), '401': Resp401() },
  });

  reg.registerPath({
    method: 'post',
    path: '/v1/invitations',
    summary: 'Create an invitation',
    description: 'Mints an invitation token and (when mailer is configured) emails it.',
    tags: ['Invitations'],
    security: SECURITY_BOTH,
    request: {
      required: true,
      content: { 'application/json': { schema: CreateInvitationRequest } },
    },
    responses: {
      '200': jsonResponse('Created.', CreateInvitationResponse),
      '401': Resp401(),
      '422': Resp422(),
    },
  });

  reg.registerPath({
    method: 'post',
    path: '/v1/invitations/{id}/revoke',
    summary: 'Revoke an invitation',
    description: 'Marks the invitation revoked.',
    tags: ['Invitations'],
    security: SECURITY_BOTH,
    parameters: [pathParam('id', 'Invitation id.', '<invitation-id>')],
    responses: {
      '200': jsonResponse('Revoked.', Invitation),
      '401': Resp401(),
      '404': Resp404('Invitation'),
    },
  });

  reg.registerPath({
    method: 'delete',
    path: '/v1/invitations/{id}',
    summary: 'Delete an invitation',
    description: 'Hard-delete; idempotent.',
    tags: ['Invitations'],
    security: SECURITY_BOTH,
    parameters: [pathParam('id', 'Invitation id.', '<invitation-id>')],
    responses: { '204': { description: 'Deleted.' }, '401': Resp401() },
  });

  reg.registerPath({
    method: 'post',
    path: '/v1/invitations/accept',
    summary: 'Accept an invitation by token',
    description:
      'Public route — bearer auth is replaced by argon2 verification of the invitation token. Returns a session for the new member.',
    tags: ['Invitations'],
    security: [],
    request: {
      required: true,
      content: {
        'application/json': { schema: { $ref: '#/components/schemas/AcceptInvitationRequest' } },
      },
    },
    responses: {
      '200': jsonResponse('Joined.', { $ref: '#/components/schemas/AuthSessionResponse' }),
      '404': Resp404('Invitation'),
      '422': Resp422(),
    },
  });

  // -- Members ----------------------------------------------------------------
  reg.registerPath({
    method: 'get',
    path: '/v1/members',
    summary: 'List members of the tenant',
    description: 'Returns the user records and their roles.',
    tags: ['Members'],
    security: SECURITY_BOTH,
    responses: { '200': jsonResponse('Members.', ListMembersResponse), '401': Resp401() },
  });

  reg.registerPath({
    method: 'patch',
    path: '/v1/members/{userId}',
    summary: "Update a member's role",
    description: 'Owner-only. Cannot demote the last owner.',
    tags: ['Members'],
    security: SECURITY_BOTH,
    parameters: [pathParam('userId', 'Target user id.', '<user-id>')],
    request: { required: true, content: { 'application/json': { schema: UpdateMemberRequest } } },
    responses: {
      '200': jsonResponse('Updated.', Member),
      '401': Resp401(),
      '403': Resp403(),
      '404': Resp404('Member'),
    },
  });

  reg.registerPath({
    method: 'delete',
    path: '/v1/members/{userId}',
    summary: 'Remove a member from the tenant',
    description: 'Owner-only. Cannot remove the last owner.',
    tags: ['Members'],
    security: SECURITY_BOTH,
    parameters: [pathParam('userId', 'Target user id.', '<user-id>')],
    responses: {
      '204': { description: 'Removed.' },
      '401': Resp401(),
      '403': Resp403(),
      '404': Resp404('Member'),
    },
  });

  // -- Audit ------------------------------------------------------------------
  reg.registerPath({
    method: 'get',
    path: '/v1/audit',
    summary: 'Read the tenant audit log',
    description: 'Owner-only. Returns the audit entries with cursor pagination.',
    tags: ['Audit'],
    security: SECURITY_BOTH,
    responses: {
      '200': jsonResponse('Audit page.', ListAuditLogResponse),
      '401': Resp401(),
      '403': Resp403(),
    },
  });

  // -- Tenants ----------------------------------------------------------------
  reg.registerPath({
    method: 'post',
    path: '/v1/tenants/me/seed-default',
    summary: 'Seed the tenant with the default agency',
    description:
      "Copies the bundled `agency/` reference org's agents + suites into the calling tenant. Idempotent.",
    tags: ['Tenants'],
    security: SECURITY_BOTH,
    responses: {
      '200': jsonResponse('Seeded.', { $ref: '#/components/schemas/SeedDefaultResponse' }),
      '401': Resp401(),
    },
  });

  // -- Design partners --------------------------------------------------------
  reg.registerPath({
    method: 'post',
    path: '/v1/design-partners/apply',
    summary: 'Submit a design-partner application',
    description:
      "Public route — applicants haven't signed up yet. The API persists the application; an admin reviews it later.",
    tags: ['Design Partners'],
    security: [],
    request: {
      required: true,
      content: {
        'application/json': { schema: { $ref: '#/components/schemas/DesignPartnerApplyRequest' } },
      },
    },
    responses: {
      '200': jsonResponse('Application accepted.', {
        $ref: '#/components/schemas/DesignPartnerApplyResponse',
      }),
      '422': Resp422(),
    },
  });

  reg.registerPath({
    method: 'get',
    path: '/v1/admin/design-partner-applications',
    summary: 'List design-partner applications (admin)',
    description: 'Admin-only. Returns the applications with their review status.',
    tags: ['Design Partners'],
    security: SECURITY_BOTH,
    responses: {
      '200': jsonResponse('Applications.', ListDesignPartnerApplicationsResponse),
      '401': Resp401(),
      '403': Resp403(),
    },
  });

  reg.registerPath({
    method: 'patch',
    path: '/v1/admin/design-partner-applications/{id}',
    summary: 'Update a design-partner application',
    description: 'Admin-only. Status transitions: `new` -> `contacted` / `accepted` / `declined`.',
    tags: ['Design Partners'],
    security: SECURITY_BOTH,
    parameters: [pathParam('id', 'Application id.', '<application-id>')],
    request: {
      required: true,
      content: {
        'application/json': {
          schema: { $ref: '#/components/schemas/UpdateDesignPartnerApplicationRequest' },
        },
      },
    },
    responses: {
      '200': jsonResponse('Updated.', { $ref: '#/components/schemas/DesignPartnerApplication' }),
      '401': Resp401(),
      '403': Resp403(),
      '404': Resp404('Application'),
    },
  });
}
