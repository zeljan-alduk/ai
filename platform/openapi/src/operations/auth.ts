/**
 * Auth operations — signup, login, switch-tenant, logout, /auth/me.
 *
 * Signup + login are PUBLIC (no security requirement). Everything else
 * requires a bearer token.
 */

import {
  AuthMeResponse,
  AuthSessionResponse,
  LoginRequest,
  SignupRequest,
  SwitchTenantRequest,
  SwitchTenantResponse,
} from '@aldo-ai/api-contract';
import type { OpenAPIRegistry } from '../registry.js';
import { Resp401, Resp404, Resp422, SECURITY_BEARER, jsonResponse } from './_shared.js';

export function registerAuthOperations(reg: OpenAPIRegistry): void {
  reg.registerTag('Auth', 'Sign up, log in, switch tenant, fetch the current session.');

  reg.registerPath({
    method: 'post',
    path: '/v1/auth/signup',
    summary: 'Create a tenant + owner account',
    description:
      'Creates a new tenant and the first owner-role user. Returns a JWT session token. Public — no auth required.',
    tags: ['Auth'],
    security: [],
    request: {
      required: true,
      content: { 'application/json': { schema: SignupRequest } },
    },
    responses: {
      '200': jsonResponse('Session created.', AuthSessionResponse),
      '422': Resp422(),
    },
  });

  reg.registerPath({
    method: 'post',
    path: '/v1/auth/login',
    summary: 'Log in with email + password',
    description:
      "Returns a JWT session token bound to the caller's default tenant. Public — no auth required.",
    tags: ['Auth'],
    security: [],
    request: { required: true, content: { 'application/json': { schema: LoginRequest } } },
    responses: {
      '200': jsonResponse('Session created.', AuthSessionResponse),
      '401': Resp401(),
      '422': Resp422(),
    },
  });

  reg.registerPath({
    method: 'post',
    path: '/v1/auth/logout',
    summary: 'Invalidate the current session',
    description:
      'Best-effort logout — server-side it merely confirms the call; the JWT continues to verify until expiry, so clients should also drop the token locally.',
    tags: ['Auth'],
    security: SECURITY_BEARER,
    responses: {
      '200': jsonResponse('Logged out.', {
        type: 'object',
        properties: { ok: { type: 'boolean' } },
      }),
      '401': Resp401(),
    },
  });

  reg.registerPath({
    method: 'get',
    path: '/v1/auth/me',
    summary: 'Resolve the current session',
    description:
      'Returns the authenticated user, their current tenant, and all tenant memberships with role.',
    tags: ['Auth'],
    security: SECURITY_BEARER,
    responses: {
      '200': jsonResponse('Current session.', AuthMeResponse),
      '401': Resp401(),
    },
  });

  reg.registerPath({
    method: 'post',
    path: '/v1/auth/switch-tenant',
    summary: 'Mint a session bound to a different tenant',
    description:
      'Re-issues the session JWT with the requested tenant pinned. The user must already be a member of the target tenant.',
    tags: ['Auth'],
    security: SECURITY_BEARER,
    request: { required: true, content: { 'application/json': { schema: SwitchTenantRequest } } },
    responses: {
      '200': jsonResponse('New session.', SwitchTenantResponse),
      '401': Resp401(),
      '404': Resp404('Tenant'),
      '422': Resp422(),
    },
  });
}
