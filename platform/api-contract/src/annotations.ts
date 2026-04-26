/**
 * Annotations + share-links wire types — wave 14 (Engineer 14D).
 *
 * Annotations are threaded comments anchored to a (target_kind,
 * target_id) tuple. Share links are public read-only handles for a
 * single resource (run / sweep / agent), optionally password-gated and
 * optionally expiring.
 *
 * Schemas live here so apps/api (server) and apps/web (client) share
 * exactly one canonical shape; adding a field requires a coordinated
 * change at both ends.
 *
 * LLM-agnostic: nothing here references a model provider.
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Annotations.
// ---------------------------------------------------------------------------

/**
 * The kinds of resource an annotation can be anchored to. Mirrored as a
 * CHECK constraint on `annotations.target_kind` in migration 016.
 */
export const AnnotationTargetKind = z.enum(['run', 'sweep', 'agent']);
export type AnnotationTargetKind = z.infer<typeof AnnotationTargetKind>;

/** Reaction kinds. Mirrored as a CHECK constraint in migration 016. */
export const AnnotationReactionKind = z.enum(['thumbs_up', 'thumbs_down', 'eyes', 'check']);
export type AnnotationReactionKind = z.infer<typeof AnnotationReactionKind>;

/**
 * A single reaction count + whether the calling user contributed it.
 * The UI renders these as toggle buttons; clicking one POSTs to the
 * `/reactions` endpoint to flip the bit.
 */
export const AnnotationReactionSummary = z.object({
  kind: AnnotationReactionKind,
  count: z.number().int().nonnegative(),
  reactedByMe: z.boolean(),
});
export type AnnotationReactionSummary = z.infer<typeof AnnotationReactionSummary>;

/**
 * The wire shape of an annotation. The `parent_id` column is exposed
 * verbatim so the client can derive thread structure; the server does
 * NOT pre-nest the response.
 */
export const Annotation = z.object({
  id: z.string(),
  targetKind: AnnotationTargetKind,
  targetId: z.string(),
  parentId: z.string().nullable(),
  authorUserId: z.string(),
  authorEmail: z.string(),
  body: z.string(),
  reactions: z.array(AnnotationReactionSummary),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Annotation = z.infer<typeof Annotation>;

export const ListAnnotationsQuery = z.object({
  targetKind: AnnotationTargetKind,
  targetId: z.string().min(1),
});
export type ListAnnotationsQuery = z.infer<typeof ListAnnotationsQuery>;

export const ListAnnotationsResponse = z.object({
  annotations: z.array(Annotation),
});
export type ListAnnotationsResponse = z.infer<typeof ListAnnotationsResponse>;

export const CreateAnnotationRequest = z.object({
  targetKind: AnnotationTargetKind,
  targetId: z.string().min(1).max(256),
  body: z.string().min(1).max(8192),
  parentId: z.string().min(1).optional(),
});
export type CreateAnnotationRequest = z.infer<typeof CreateAnnotationRequest>;

export const UpdateAnnotationRequest = z.object({
  body: z.string().min(1).max(8192),
});
export type UpdateAnnotationRequest = z.infer<typeof UpdateAnnotationRequest>;

export const ToggleReactionRequest = z.object({
  kind: AnnotationReactionKind,
});
export type ToggleReactionRequest = z.infer<typeof ToggleReactionRequest>;

export const ToggleReactionResponse = z.object({
  annotation: Annotation,
});
export type ToggleReactionResponse = z.infer<typeof ToggleReactionResponse>;

export const AnnotationFeedQuery = z.object({
  since: z.string().optional(),
  limit: z.coerce.number().int().positive().max(200).default(50),
});
export type AnnotationFeedQuery = z.infer<typeof AnnotationFeedQuery>;

export const AnnotationFeedResponse = z.object({
  annotations: z.array(Annotation),
});
export type AnnotationFeedResponse = z.infer<typeof AnnotationFeedResponse>;

// ---------------------------------------------------------------------------
// Share links.
// ---------------------------------------------------------------------------

/**
 * The list / create / revoke-response shape of a share link. The
 * password is NEVER returned (only the boolean `hasPassword`); the
 * slug is opaque; `url` is a fully-qualified URL the UI displays in a
 * copy-button code block.
 */
export const ShareLink = z.object({
  id: z.string(),
  targetKind: AnnotationTargetKind,
  targetId: z.string(),
  slug: z.string(),
  url: z.string(),
  hasPassword: z.boolean(),
  expiresAt: z.string().nullable(),
  revokedAt: z.string().nullable(),
  viewCount: z.number().int().nonnegative(),
  createdAt: z.string(),
  createdByUserId: z.string(),
  createdByEmail: z.string(),
});
export type ShareLink = z.infer<typeof ShareLink>;

export const CreateShareLinkRequest = z.object({
  targetKind: AnnotationTargetKind,
  targetId: z.string().min(1).max(256),
  /** Optional expiry, in hours from now. Omit for non-expiring links. */
  expiresInHours: z
    .number()
    .int()
    .positive()
    .max(24 * 365)
    .optional(),
  /** Optional password (argon2id-hashed at rest). Min 4 chars to be useful. */
  password: z.string().min(4).max(128).optional(),
});
export type CreateShareLinkRequest = z.infer<typeof CreateShareLinkRequest>;

export const ListShareLinksQuery = z.object({
  targetKind: AnnotationTargetKind.optional(),
  targetId: z.string().optional(),
});
export type ListShareLinksQuery = z.infer<typeof ListShareLinksQuery>;

export const ListShareLinksResponse = z.object({
  shares: z.array(ShareLink),
});
export type ListShareLinksResponse = z.infer<typeof ListShareLinksResponse>;

export const CreateShareLinkResponse = z.object({
  share: ShareLink,
});
export type CreateShareLinkResponse = z.infer<typeof CreateShareLinkResponse>;

// ---------------------------------------------------------------------------
// Public share viewer payload.
// ---------------------------------------------------------------------------

/**
 * The publicly-served projection of a shared resource. The shape is a
 * union over `targetKind`. The viewer pages branch on `kind` and render
 * a watermarked read-only view.
 *
 * SECURITY:
 *   - Runs: NO secret values; the per-call `usage_records` are dropped
 *     entirely (only aggregated `totalUsd` survives). The flame-graph
 *     spans + final output are included.
 *   - Sweeps: matrix + cell-level pass/fail/cost survives; raw secret
 *     values are not part of a sweep payload anyway.
 *   - Agents: spec_yaml + composite diagram. Secrets referenced by
 *     name are visible (the secret VALUE never leaves /v1/secrets).
 */
export const PublicSharedRun = z.object({
  kind: z.literal('run'),
  run: z.object({
    id: z.string(),
    agentName: z.string(),
    agentVersion: z.string(),
    status: z.string(),
    startedAt: z.string(),
    endedAt: z.string().nullable(),
    totalUsd: z.number(),
    finalOutput: z.unknown().nullable(),
    events: z.array(
      z.object({
        id: z.string(),
        type: z.string(),
        at: z.string(),
        payload: z.unknown(),
      }),
    ),
  }),
});
export type PublicSharedRun = z.infer<typeof PublicSharedRun>;

export const PublicSharedSweep = z.object({
  kind: z.literal('sweep'),
  sweep: z.object({
    id: z.string(),
    agentName: z.string().nullable(),
    status: z.string(),
    createdAt: z.string(),
    matrix: z.unknown(),
    summary: z.unknown(),
  }),
});
export type PublicSharedSweep = z.infer<typeof PublicSharedSweep>;

export const PublicSharedAgent = z.object({
  kind: z.literal('agent'),
  agent: z.object({
    name: z.string(),
    version: z.string(),
    description: z.string().nullable(),
    specYaml: z.string(),
  }),
});
export type PublicSharedAgent = z.infer<typeof PublicSharedAgent>;

export const PublicSharedResource = z.discriminatedUnion('kind', [
  PublicSharedRun,
  PublicSharedSweep,
  PublicSharedAgent,
]);
export type PublicSharedResource = z.infer<typeof PublicSharedResource>;

export const PublicShareResponse = z.object({
  share: z.object({
    slug: z.string(),
    targetKind: AnnotationTargetKind,
    targetId: z.string(),
    expiresAt: z.string().nullable(),
    createdAt: z.string(),
  }),
  resource: PublicSharedResource,
});
export type PublicShareResponse = z.infer<typeof PublicShareResponse>;

/**
 * Response when the share is gated and the caller hasn't supplied (or
 * has supplied a wrong) password. The viewer renders a password prompt
 * and re-tries with `?password=...`.
 */
export const PublicShareLockedResponse = z.object({
  locked: z.literal(true),
  reason: z.enum(['password_required', 'password_invalid', 'rate_limited']),
});
export type PublicShareLockedResponse = z.infer<typeof PublicShareLockedResponse>;
