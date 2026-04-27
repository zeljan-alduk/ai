/**
 * Admin surface — wave-13 wire types for the /settings shell.
 *
 *   - API keys (programmatic access, scope-checked).
 *   - Invitations (email-driven onboarding into a tenant).
 *   - Roles (fixed 4-role enum: owner | admin | member | viewer).
 *   - Audit log (append-only mutation log, owner-only browser).
 *
 * Schemas live here so apps/api (server) and apps/web (client) share
 * exactly one canonical shape. Adding a field requires a coordinated
 * change at both ends.
 *
 * LLM-agnostic: nothing here references a model provider.
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Roles + scopes catalog.
// ---------------------------------------------------------------------------

/** Fixed RBAC enum. Promotion paths: viewer → member → admin → owner. */
export const Role = z.enum(['owner', 'admin', 'member', 'viewer']);
export type Role = z.infer<typeof Role>;

/**
 * API-key scopes. Wildcards keep the shape compact:
 *   - `runs:write`    create runs / spawn agents
 *   - `runs:read`     read runs
 *   - `agents:read`   read the agent registry
 *   - `agents:write`  register / promote agents
 *   - `secrets:read`  list secret summaries (NEVER values)
 *   - `secrets:write` create / update / delete secrets
 *   - `admin:*`       any admin operation (members / api-keys / audit)
 *
 * The full catalog is mirrored in apps/api/src/auth/api-keys.ts —
 * the canonical enforcement happens there, but the wire schema
 * exists here so client code can render scope checkboxes without
 * cross-package import gymnastics.
 */
export const ApiKeyScope = z.enum([
  'runs:write',
  'runs:read',
  'agents:read',
  'agents:write',
  'secrets:read',
  'secrets:write',
  'admin:*',
]);
export type ApiKeyScope = z.infer<typeof ApiKeyScope>;

// ---------------------------------------------------------------------------
// API keys.
// ---------------------------------------------------------------------------

/**
 * The displayable shape of an API key — the full secret is NEVER part
 * of this. List + revoke + delete responses use this shape.
 */
export const ApiKey = z.object({
  id: z.string(),
  name: z.string(),
  /** First 12 chars of the full secret (`aldo_live_xxxx`). */
  prefix: z.string(),
  scopes: z.array(z.string()),
  createdAt: z.string(),
  lastUsedAt: z.string().nullable(),
  expiresAt: z.string().nullable(),
  revokedAt: z.string().nullable(),
});
export type ApiKey = z.infer<typeof ApiKey>;

export const ListApiKeysResponse = z.object({
  keys: z.array(ApiKey),
});
export type ListApiKeysResponse = z.infer<typeof ListApiKeysResponse>;

export const CreateApiKeyRequest = z.object({
  name: z.string().min(1).max(120),
  scopes: z.array(z.string()).min(1),
  /** Optional expiry, in days from now. Omit for non-expiring keys. */
  expiresInDays: z.number().int().positive().max(3650).optional(),
});
export type CreateApiKeyRequest = z.infer<typeof CreateApiKeyRequest>;

/**
 * The full plain-text secret is shown ONCE on creation. The web UI
 * surfaces it in a copy-on-click block with a clear warning; after
 * dismiss the API has no way to re-derive it.
 */
export const CreateApiKeyResponse = z.object({
  key: z.string(),
  apiKey: ApiKey,
});
export type CreateApiKeyResponse = z.infer<typeof CreateApiKeyResponse>;

// ---------------------------------------------------------------------------
// Invitations.
// ---------------------------------------------------------------------------

export const Invitation = z.object({
  id: z.string(),
  email: z.string(),
  role: Role,
  invitedBy: z.string(),
  createdAt: z.string(),
  expiresAt: z.string(),
  acceptedAt: z.string().nullable(),
  acceptedBy: z.string().nullable(),
  revokedAt: z.string().nullable(),
});
export type Invitation = z.infer<typeof Invitation>;

export const ListInvitationsResponse = z.object({
  invitations: z.array(Invitation),
});
export type ListInvitationsResponse = z.infer<typeof ListInvitationsResponse>;

export const CreateInvitationRequest = z.object({
  email: z
    .string()
    .min(3)
    .max(254)
    .regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'invalid email'),
  role: Role,
});
export type CreateInvitationRequest = z.infer<typeof CreateInvitationRequest>;

/**
 * The plain accept-URL is shown ONCE on creation. Web UI emails the
 * link via the Mailer stub + falls back to a copyable display in dev.
 */
export const CreateInvitationResponse = z.object({
  invitation: Invitation,
  acceptUrl: z.string(),
  /** The plain token; the API has no way to re-derive it. */
  token: z.string(),
});
export type CreateInvitationResponse = z.infer<typeof CreateInvitationResponse>;

export const AcceptInvitationRequest = z.object({
  token: z.string().min(1),
  /** Required when the invitee doesn't already have a user row. */
  password: z.string().min(12).optional(),
});
export type AcceptInvitationRequest = z.infer<typeof AcceptInvitationRequest>;

// ---------------------------------------------------------------------------
// Members.
// ---------------------------------------------------------------------------

export const Member = z.object({
  userId: z.string(),
  email: z.string(),
  role: Role,
  joinedAt: z.string(),
});
export type Member = z.infer<typeof Member>;

export const ListMembersResponse = z.object({
  members: z.array(Member),
});
export type ListMembersResponse = z.infer<typeof ListMembersResponse>;

export const UpdateMemberRequest = z.object({
  role: Role,
});
export type UpdateMemberRequest = z.infer<typeof UpdateMemberRequest>;

// ---------------------------------------------------------------------------
// Audit log.
// ---------------------------------------------------------------------------

export const AuditLogEntry = z.object({
  id: z.string(),
  verb: z.string(),
  objectKind: z.string(),
  objectId: z.string().nullable(),
  actorUserId: z.string().nullable(),
  actorApiKeyId: z.string().nullable(),
  ip: z.string().nullable(),
  userAgent: z.string().nullable(),
  metadata: z.record(z.unknown()),
  at: z.string(),
});
export type AuditLogEntry = z.infer<typeof AuditLogEntry>;

export const ListAuditLogResponse = z.object({
  entries: z.array(AuditLogEntry),
  meta: z.object({
    nextCursor: z.string().nullable(),
    hasMore: z.boolean(),
  }),
});
export type ListAuditLogResponse = z.infer<typeof ListAuditLogResponse>;

export const ListAuditLogQuery = z.object({
  verb: z.string().optional(),
  objectKind: z.string().optional(),
  actorUserId: z.string().optional(),
  since: z.string().optional(),
  until: z.string().optional(),
  limit: z.coerce.number().int().positive().max(200).default(50),
  cursor: z.string().optional(),
});
export type ListAuditLogQuery = z.infer<typeof ListAuditLogQuery>;
