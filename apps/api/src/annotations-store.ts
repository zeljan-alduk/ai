/**
 * Annotations + reactions storage helpers.
 *
 * Wave 14 (Engineer 14D). Tenant-scoped CRUD over the `annotations`
 * and `annotation_reactions` tables (migration 016). The helpers here
 * never touch a Hono `Context` — they take a `SqlClient` directly so
 * tests can drive them without spinning up the API.
 *
 * The reactions surface is folded into the annotation projection: the
 * read paths (`listAnnotations`, `getAnnotationById`) join the
 * reactions table and emit a `reactions: Array<{kind, count,
 * reactedByMe}>` summary so the UI can render the toggle bar in one
 * pass.
 *
 * LLM-agnostic: nothing here references a model provider.
 */

import { randomUUID } from 'node:crypto';
import type {
  Annotation,
  AnnotationReactionKind,
  AnnotationReactionSummary,
  AnnotationTargetKind,
} from '@aldo-ai/api-contract';
import type { SqlClient } from '@aldo-ai/storage';

interface AnnotationRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly user_id: string;
  readonly target_kind: string;
  readonly target_id: string;
  readonly parent_id: string | null;
  readonly body: string;
  readonly created_at: string | Date;
  readonly updated_at: string | Date;
  readonly author_email: string | null;
  readonly [k: string]: unknown;
}

interface ReactionRow {
  readonly annotation_id: string;
  readonly kind: string;
  readonly user_id: string;
  readonly [k: string]: unknown;
}

function toIso(v: unknown): string {
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'string') {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? v : d.toISOString();
  }
  return new Date(0).toISOString();
}

const ALL_REACTION_KINDS: readonly AnnotationReactionKind[] = [
  'thumbs_up',
  'thumbs_down',
  'eyes',
  'check',
];

function emptyReactions(): AnnotationReactionSummary[] {
  return ALL_REACTION_KINDS.map((kind) => ({ kind, count: 0, reactedByMe: false }));
}

function rowToAnnotation(row: AnnotationRow, reactions: AnnotationReactionSummary[]): Annotation {
  return {
    id: row.id,
    targetKind: row.target_kind as AnnotationTargetKind,
    targetId: row.target_id,
    parentId: row.parent_id,
    authorUserId: row.user_id,
    authorEmail: row.author_email ?? '',
    body: row.body,
    reactions,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

/**
 * Fold a flat list of (annotation_id, kind, user_id) reaction rows into
 * a per-annotation reaction summary keyed by the annotation id. The
 * summary always carries an entry for every known reaction kind (even
 * when count = 0) so the UI can render a stable toggle bar.
 */
function buildReactionMap(
  rows: readonly ReactionRow[],
  callerUserId: string | null,
): Map<string, AnnotationReactionSummary[]> {
  const out = new Map<string, AnnotationReactionSummary[]>();
  for (const r of rows) {
    let bucket = out.get(r.annotation_id);
    if (bucket === undefined) {
      bucket = emptyReactions();
      out.set(r.annotation_id, bucket);
    }
    const entry = bucket.find((e) => e.kind === (r.kind as AnnotationReactionKind));
    if (entry === undefined) continue;
    entry.count += 1;
    if (callerUserId !== null && r.user_id === callerUserId) {
      entry.reactedByMe = true;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// CRUD.
// ---------------------------------------------------------------------------

export interface ListAnnotationsArgs {
  readonly tenantId: string;
  /** Caller user id (for `reactedByMe` flags). */
  readonly callerUserId: string;
  readonly targetKind: AnnotationTargetKind;
  readonly targetId: string;
}

export async function listAnnotationsForTarget(
  db: SqlClient,
  args: ListAnnotationsArgs,
): Promise<Annotation[]> {
  const res = await db.query<AnnotationRow>(
    `SELECT a.id, a.tenant_id, a.user_id, a.target_kind, a.target_id,
            a.parent_id, a.body, a.created_at, a.updated_at,
            u.email AS author_email
       FROM annotations a
       LEFT JOIN users u ON u.id = a.user_id
      WHERE a.tenant_id = $1 AND a.target_kind = $2 AND a.target_id = $3
      ORDER BY a.created_at ASC, a.id ASC`,
    [args.tenantId, args.targetKind, args.targetId],
  );
  if (res.rows.length === 0) return [];
  const ids = res.rows.map((r) => r.id);
  const reactions = await db.query<ReactionRow>(
    `SELECT annotation_id, kind, user_id
       FROM annotation_reactions
      WHERE annotation_id = ANY($1::text[])`,
    [ids],
  );
  const reactionMap = buildReactionMap(reactions.rows, args.callerUserId);
  return res.rows.map((r) => rowToAnnotation(r, reactionMap.get(r.id) ?? emptyReactions()));
}

export interface CreateAnnotationArgs {
  readonly tenantId: string;
  readonly userId: string;
  readonly targetKind: AnnotationTargetKind;
  readonly targetId: string;
  readonly body: string;
  readonly parentId?: string;
}

export async function createAnnotation(
  db: SqlClient,
  args: CreateAnnotationArgs,
): Promise<Annotation> {
  const id = randomUUID();
  // If a parent is supplied, validate that it belongs to the same
  // (tenant, target) so a malicious caller can't anchor a reply to an
  // annotation in another tenant.
  if (args.parentId !== undefined) {
    const parent = await db.query<AnnotationRow>(
      `SELECT id, tenant_id, target_kind, target_id, parent_id
         FROM annotations
        WHERE id = $1 AND tenant_id = $2`,
      [args.parentId, args.tenantId],
    );
    const row = parent.rows[0];
    if (row === undefined) {
      throw new Error('parent annotation not found');
    }
    if (row.target_kind !== args.targetKind || row.target_id !== args.targetId) {
      throw new Error('parent annotation belongs to a different target');
    }
  }
  await db.query(
    `INSERT INTO annotations
       (id, tenant_id, user_id, target_kind, target_id, parent_id, body)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      id,
      args.tenantId,
      args.userId,
      args.targetKind,
      args.targetId,
      args.parentId ?? null,
      args.body,
    ],
  );
  const inserted = await getAnnotationById(db, {
    tenantId: args.tenantId,
    callerUserId: args.userId,
    id,
  });
  if (inserted === null) {
    throw new Error('annotation post-condition failed: row not visible after insert');
  }
  return inserted;
}

export interface GetAnnotationArgs {
  readonly tenantId: string;
  readonly callerUserId: string;
  readonly id: string;
}

export async function getAnnotationById(
  db: SqlClient,
  args: GetAnnotationArgs,
): Promise<Annotation | null> {
  const res = await db.query<AnnotationRow>(
    `SELECT a.id, a.tenant_id, a.user_id, a.target_kind, a.target_id,
            a.parent_id, a.body, a.created_at, a.updated_at,
            u.email AS author_email
       FROM annotations a
       LEFT JOIN users u ON u.id = a.user_id
      WHERE a.id = $1 AND a.tenant_id = $2`,
    [args.id, args.tenantId],
  );
  const row = res.rows[0];
  if (row === undefined) return null;
  const reactions = await db.query<ReactionRow>(
    'SELECT annotation_id, kind, user_id FROM annotation_reactions WHERE annotation_id = $1',
    [args.id],
  );
  const reactionMap = buildReactionMap(reactions.rows, args.callerUserId);
  return rowToAnnotation(row, reactionMap.get(row.id) ?? emptyReactions());
}

export interface UpdateAnnotationArgs {
  readonly tenantId: string;
  readonly callerUserId: string;
  readonly id: string;
  readonly body: string;
}

/**
 * Update the body. Only the original author can edit; non-author
 * callers receive `null` and the route translates that to 403.
 */
export async function updateAnnotation(
  db: SqlClient,
  args: UpdateAnnotationArgs,
): Promise<Annotation | null> {
  const existing = await db.query<AnnotationRow>(
    'SELECT user_id FROM annotations WHERE id = $1 AND tenant_id = $2',
    [args.id, args.tenantId],
  );
  const row = existing.rows[0];
  if (row === undefined) return null;
  if (row.user_id !== args.callerUserId) return null;
  await db.query(
    'UPDATE annotations SET body = $1, updated_at = now() WHERE id = $2 AND tenant_id = $3',
    [args.body, args.id, args.tenantId],
  );
  return getAnnotationById(db, {
    tenantId: args.tenantId,
    callerUserId: args.callerUserId,
    id: args.id,
  });
}

export interface DeleteAnnotationArgs {
  readonly tenantId: string;
  readonly callerUserId: string;
  readonly callerRole: 'owner' | 'admin' | 'member' | 'viewer';
  readonly id: string;
}

export type DeleteAnnotationResult = 'deleted' | 'forbidden' | 'not_found';

export async function deleteAnnotation(
  db: SqlClient,
  args: DeleteAnnotationArgs,
): Promise<DeleteAnnotationResult> {
  const existing = await db.query<AnnotationRow>(
    'SELECT user_id FROM annotations WHERE id = $1 AND tenant_id = $2',
    [args.id, args.tenantId],
  );
  const row = existing.rows[0];
  if (row === undefined) return 'not_found';
  // Author OR owner.
  if (row.user_id !== args.callerUserId && args.callerRole !== 'owner') {
    return 'forbidden';
  }
  await db.query('DELETE FROM annotations WHERE id = $1 AND tenant_id = $2', [
    args.id,
    args.tenantId,
  ]);
  return 'deleted';
}

// ---------------------------------------------------------------------------
// Reactions.
// ---------------------------------------------------------------------------

export interface ToggleReactionArgs {
  readonly tenantId: string;
  readonly callerUserId: string;
  readonly annotationId: string;
  readonly kind: AnnotationReactionKind;
}

/**
 * Toggle a reaction on / off. Returns the refreshed annotation when
 * the reaction was successfully applied / removed; returns `null` when
 * the underlying annotation isn't visible to the caller (404).
 */
export async function toggleReaction(
  db: SqlClient,
  args: ToggleReactionArgs,
): Promise<Annotation | null> {
  // Confirm the annotation exists in this tenant before flipping the
  // bit — a 404 here is what the route surfaces for "annotation not
  // visible".
  const ann = await db.query<AnnotationRow>(
    'SELECT id FROM annotations WHERE id = $1 AND tenant_id = $2',
    [args.annotationId, args.tenantId],
  );
  if (ann.rows[0] === undefined) return null;
  // Toggle: try a delete first; if zero rows changed, insert one.
  const del = await db.query(
    `DELETE FROM annotation_reactions
       WHERE annotation_id = $1 AND user_id = $2 AND kind = $3`,
    [args.annotationId, args.callerUserId, args.kind],
  );
  if (del.rowCount === 0) {
    await db.query(
      `INSERT INTO annotation_reactions (annotation_id, user_id, kind) VALUES ($1, $2, $3)
       ON CONFLICT (annotation_id, user_id, kind) DO NOTHING`,
      [args.annotationId, args.callerUserId, args.kind],
    );
  }
  return getAnnotationById(db, {
    tenantId: args.tenantId,
    callerUserId: args.callerUserId,
    id: args.annotationId,
  });
}

// ---------------------------------------------------------------------------
// Tenant-wide feed.
// ---------------------------------------------------------------------------

export interface ListAnnotationFeedArgs {
  readonly tenantId: string;
  readonly callerUserId: string;
  readonly since?: string;
  readonly limit: number;
}

export async function listAnnotationFeed(
  db: SqlClient,
  args: ListAnnotationFeedArgs,
): Promise<Annotation[]> {
  const params: unknown[] = [args.tenantId];
  let where = 'a.tenant_id = $1';
  if (args.since !== undefined) {
    params.push(args.since);
    where += ` AND a.created_at >= $${params.length}::timestamptz`;
  }
  params.push(Math.max(1, Math.min(200, args.limit)));
  const limitIdx = params.length;
  const res = await db.query<AnnotationRow>(
    `SELECT a.id, a.tenant_id, a.user_id, a.target_kind, a.target_id,
            a.parent_id, a.body, a.created_at, a.updated_at,
            u.email AS author_email
       FROM annotations a
       LEFT JOIN users u ON u.id = a.user_id
      WHERE ${where}
      ORDER BY a.created_at DESC, a.id DESC
      LIMIT $${limitIdx}`,
    params,
  );
  if (res.rows.length === 0) return [];
  const ids = res.rows.map((r) => r.id);
  const reactions = await db.query<ReactionRow>(
    'SELECT annotation_id, kind, user_id FROM annotation_reactions WHERE annotation_id = ANY($1::text[])',
    [ids],
  );
  const reactionMap = buildReactionMap(reactions.rows, args.callerUserId);
  return res.rows.map((r) => rowToAnnotation(r, reactionMap.get(r.id) ?? emptyReactions()));
}

// ---------------------------------------------------------------------------
// @-mention extraction (used to fan out notifications).
// ---------------------------------------------------------------------------

/**
 * Extract email-style @-mentions from a body. Matches `@<localpart>@<domain>`
 * which is awkward to type but unambiguous; the notification surface is
 * a strict allow-list (only mentions that map to a tenant member fire a
 * notification, so a stray `@@example` in code blocks is silently
 * ignored).
 */
export function extractMentionedEmails(body: string): string[] {
  const out = new Set<string>();
  // Match `@email@domain.tld`. Email RFC is famously permissive; we
  // intentionally use a conservative regex (`[^\s@]+@[^\s@]+\.[^\s@]+`)
  // that mirrors the invitation-email validator.
  const re = /@([^\s@]+@[^\s@]+\.[^\s@]+)/g;
  let m: RegExpExecArray | null = re.exec(body);
  while (m !== null) {
    const candidate = (m[1] ?? '').toLowerCase();
    // Trim trailing punctuation that often follows a mention in prose.
    const trimmed = candidate.replace(/[.,;:!?)\]}]+$/, '');
    if (trimmed.length > 0) out.add(trimmed);
    m = re.exec(body);
  }
  return [...out];
}
