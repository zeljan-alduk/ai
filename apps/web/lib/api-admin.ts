/**
 * Wave-13 admin surface client (api-keys, invitations, members,
 * audit). Lives in its own module rather than `lib/api.ts` to keep the
 * settings UI's dependency surface tight — adding a wave-13-only
 * import to the main client would force every page that imports
 * anything from `lib/api` to drag in the admin schemas.
 */

import type {
  ApiKey,
  AuditLogEntry,
  CreateApiKeyRequest,
  CreateIntegrationRequest,
  CreateInvitationRequest,
  CreateInvitationResponse,
  IntegrationContract,
  IntegrationResponse,
  Invitation,
  ListApiKeysResponse,
  ListAuditLogResponse,
  ListIntegrationsResponse,
  ListInvitationsResponse,
  ListMembersResponse,
  Role,
  TestFireResponse,
  UpdateIntegrationRequest,
  UpdateMemberRequest,
} from '@aldo-ai/api-contract';
import { ApiClientError } from './api';

const PROXY = '/api/auth-proxy';

async function jsonFetch<T>(
  path: string,
  init: RequestInit & { query?: Record<string, string | undefined> } = {},
): Promise<T> {
  const { query, ...rest } = init;
  let url: string;
  if (typeof window !== 'undefined') {
    const u = new URL(`${PROXY}${path}`, window.location.origin);
    if (query) {
      for (const [k, v] of Object.entries(query)) {
        if (v !== undefined && v !== '') u.searchParams.set(k, v);
      }
    }
    url = u.toString();
  } else {
    const base = process.env.NEXT_PUBLIC_API_BASE ?? 'http://localhost:3001';
    const u = new URL(path, base);
    if (query) {
      for (const [k, v] of Object.entries(query)) {
        if (v !== undefined && v !== '') u.searchParams.set(k, v);
      }
    }
    url = u.toString();
  }
  const headers: Record<string, string> = {
    accept: 'application/json',
    ...(rest.headers as Record<string, string> | undefined),
  };
  if (typeof window === 'undefined') {
    const tokenResolver = (
      globalThis as { __aldoServerTokenResolver?: () => Promise<string | null> }
    ).__aldoServerTokenResolver;
    if (tokenResolver) {
      const tok = await tokenResolver();
      if (tok) headers.authorization = `Bearer ${tok}`;
    }
  }
  let res: Response;
  try {
    res = await fetch(url, {
      ...rest,
      headers,
      cache: 'no-store',
      credentials: typeof window === 'undefined' ? 'omit' : 'include',
    });
  } catch (err) {
    throw new ApiClientError('network', `Network error contacting API at ${url}`, { cause: err });
  }
  if (res.status === 204) return undefined as unknown as T;
  const text = await res.text();
  let json: unknown;
  if (text.length > 0) {
    try {
      json = JSON.parse(text);
    } catch (err) {
      throw new ApiClientError('parse', `Invalid JSON from ${url}`, {
        status: res.status,
        cause: err,
      });
    }
  }
  if (!res.ok) {
    const errBody = (json as { error?: { code?: string; message?: string } } | undefined)?.error;
    throw new ApiClientError(
      res.status >= 500 ? 'http_5xx' : 'http_4xx',
      errBody?.message ?? `HTTP ${res.status} from ${url}`,
      {
        status: res.status,
        ...(errBody?.code !== undefined ? { code: errBody.code } : {}),
        details: json,
      },
    );
  }
  return json as T;
}

// ---------------------------------------------------------------------------
// API keys
// ---------------------------------------------------------------------------

export function listApiKeys(): Promise<ListApiKeysResponse> {
  return jsonFetch<ListApiKeysResponse>('/v1/api-keys');
}

export interface CreatedKey {
  key: string;
  apiKey: ApiKey;
}

export function createApiKey(req: CreateApiKeyRequest): Promise<CreatedKey> {
  return jsonFetch<CreatedKey>('/v1/api-keys', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(req),
  });
}

export function revokeApiKey(id: string): Promise<{ apiKey: ApiKey }> {
  return jsonFetch<{ apiKey: ApiKey }>(`/v1/api-keys/${encodeURIComponent(id)}/revoke`, {
    method: 'POST',
  });
}

export function deleteApiKey(id: string): Promise<void> {
  return jsonFetch<void>(`/v1/api-keys/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

// ---------------------------------------------------------------------------
// Invitations
// ---------------------------------------------------------------------------

export function listInvitations(): Promise<ListInvitationsResponse> {
  return jsonFetch<ListInvitationsResponse>('/v1/invitations');
}

export function createInvitation(req: CreateInvitationRequest): Promise<CreateInvitationResponse> {
  return jsonFetch<CreateInvitationResponse>('/v1/invitations', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(req),
  });
}

export function revokeInvitation(id: string): Promise<{ invitation: Invitation }> {
  return jsonFetch<{ invitation: Invitation }>(`/v1/invitations/${encodeURIComponent(id)}/revoke`, {
    method: 'POST',
  });
}

export function deleteInvitation(id: string): Promise<void> {
  return jsonFetch<void>(`/v1/invitations/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

// ---------------------------------------------------------------------------
// Members
// ---------------------------------------------------------------------------

export function listMembers(): Promise<ListMembersResponse> {
  return jsonFetch<ListMembersResponse>('/v1/members');
}

export function updateMemberRole(userId: string, req: UpdateMemberRequest): Promise<unknown> {
  return jsonFetch<unknown>(`/v1/members/${encodeURIComponent(userId)}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(req),
  });
}

export function removeMember(userId: string): Promise<void> {
  return jsonFetch<void>(`/v1/members/${encodeURIComponent(userId)}`, { method: 'DELETE' });
}

// ---------------------------------------------------------------------------
// Audit log
// ---------------------------------------------------------------------------

export interface ListAuditQuery {
  verb?: string;
  objectKind?: string;
  actorUserId?: string;
  since?: string;
  until?: string;
  limit?: number;
  cursor?: string;
}

export function listAuditLog(query: ListAuditQuery = {}): Promise<ListAuditLogResponse> {
  const q: Record<string, string | undefined> = {};
  if (query.verb !== undefined) q.verb = query.verb;
  if (query.objectKind !== undefined) q.objectKind = query.objectKind;
  if (query.actorUserId !== undefined) q.actorUserId = query.actorUserId;
  if (query.since !== undefined) q.since = query.since;
  if (query.until !== undefined) q.until = query.until;
  if (query.limit !== undefined) q.limit = String(query.limit);
  if (query.cursor !== undefined) q.cursor = query.cursor;
  return jsonFetch<ListAuditLogResponse>('/v1/audit', { query: q });
}

// ---------------------------------------------------------------------------
// Integrations (wave 14C)
// ---------------------------------------------------------------------------

export function listIntegrations(): Promise<ListIntegrationsResponse> {
  return jsonFetch<ListIntegrationsResponse>('/v1/integrations');
}

export function createIntegration(req: CreateIntegrationRequest): Promise<IntegrationResponse> {
  return jsonFetch<IntegrationResponse>('/v1/integrations', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(req),
  });
}

export function updateIntegration(
  id: string,
  req: UpdateIntegrationRequest,
): Promise<IntegrationResponse> {
  return jsonFetch<IntegrationResponse>(`/v1/integrations/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(req),
  });
}

export function deleteIntegration(id: string): Promise<void> {
  return jsonFetch<void>(`/v1/integrations/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export function testFireIntegration(id: string): Promise<TestFireResponse> {
  return jsonFetch<TestFireResponse>(`/v1/integrations/${encodeURIComponent(id)}/test`, {
    method: 'POST',
  });
}

// ---------------------------------------------------------------------------
// Re-export the wire types so consumers don't need a second import.
// ---------------------------------------------------------------------------
export type { ApiKey, AuditLogEntry, Invitation, IntegrationContract, Role };
