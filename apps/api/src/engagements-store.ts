/**
 * `engagements`, `engagement_milestones`, `engagement_comments` —
 * customer engagement surface, MISSING_PIECES §12.4.
 *
 * Threads + run grouping was the closest analogue today; this module
 * adds the engagement-shaped semantics threads lacks: status,
 * milestones, sign-off, change-request comments. Tenant-scoped at
 * every layer; cross-tenant access is impossible.
 *
 * LLM-agnostic: no model fields anywhere in this surface. Comments
 * carry plain text + an optional run_id reference.
 */

import { randomUUID } from 'node:crypto';
import type { SqlClient } from '@aldo-ai/storage';

const ALLOWED_ENGAGEMENT_STATUSES = new Set(['active', 'paused', 'complete', 'archived']);
const ALLOWED_MILESTONE_STATUSES = new Set(['pending', 'in_review', 'signed_off', 'rejected']);
const ALLOWED_COMMENT_KINDS = new Set([
  'comment',
  'change_request',
  'architecture_decision',
]);

export interface Engagement {
  readonly id: string;
  readonly tenantId: string;
  readonly slug: string;
  readonly name: string;
  readonly description: string;
  readonly status: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly archivedAt: string | null;
}

interface EngagementRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly slug: string;
  readonly name: string;
  readonly description: string;
  readonly status: string;
  readonly created_at: Date | string;
  readonly updated_at: Date | string;
  readonly archived_at: Date | string | null;
  readonly [k: string]: unknown;
}

export interface Milestone {
  readonly id: string;
  readonly engagementId: string;
  readonly tenantId: string;
  readonly title: string;
  readonly description: string;
  readonly status: string;
  readonly dueAt: string | null;
  readonly signedOffBy: string | null;
  readonly signedOffAt: string | null;
  readonly rejectedReason: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

interface MilestoneRow {
  readonly id: string;
  readonly engagement_id: string;
  readonly tenant_id: string;
  readonly title: string;
  readonly description: string;
  readonly status: string;
  readonly due_at: Date | string | null;
  readonly signed_off_by: string | null;
  readonly signed_off_at: Date | string | null;
  readonly rejected_reason: string | null;
  readonly created_at: Date | string;
  readonly updated_at: Date | string;
  readonly [k: string]: unknown;
}

export interface Comment {
  readonly id: string;
  readonly engagementId: string;
  readonly tenantId: string;
  readonly runId: string | null;
  readonly authorUserId: string | null;
  readonly body: string;
  readonly kind: string;
  readonly at: string;
}

interface CommentRow {
  readonly id: string;
  readonly engagement_id: string;
  readonly tenant_id: string;
  readonly run_id: string | null;
  readonly author_user_id: string | null;
  readonly body: string;
  readonly kind: string;
  readonly at: Date | string;
  readonly [k: string]: unknown;
}

function toIso(v: Date | string): string {
  return v instanceof Date ? v.toISOString() : v;
}

function toIsoOrNull(v: Date | string | null): string | null {
  return v === null ? null : toIso(v);
}

function toEngagement(r: EngagementRow): Engagement {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    slug: r.slug,
    name: r.name,
    description: r.description,
    status: r.status,
    createdAt: toIso(r.created_at),
    updatedAt: toIso(r.updated_at),
    archivedAt: toIsoOrNull(r.archived_at),
  };
}

function toMilestone(r: MilestoneRow): Milestone {
  return {
    id: r.id,
    engagementId: r.engagement_id,
    tenantId: r.tenant_id,
    title: r.title,
    description: r.description,
    status: r.status,
    dueAt: toIsoOrNull(r.due_at),
    signedOffBy: r.signed_off_by,
    signedOffAt: toIsoOrNull(r.signed_off_at),
    rejectedReason: r.rejected_reason,
    createdAt: toIso(r.created_at),
    updatedAt: toIso(r.updated_at),
  };
}

function toComment(r: CommentRow): Comment {
  return {
    id: r.id,
    engagementId: r.engagement_id,
    tenantId: r.tenant_id,
    runId: r.run_id,
    authorUserId: r.author_user_id,
    body: r.body,
    kind: r.kind,
    at: toIso(r.at),
  };
}

// ---------- engagements -----------------------------------------------------

export class EngagementSlugConflictError extends Error {
  constructor(slug: string) {
    super(`engagement slug already exists in this tenant: ${slug}`);
    this.name = 'EngagementSlugConflictError';
  }
}

export interface CreateEngagementInput {
  readonly tenantId: string;
  readonly slug: string;
  readonly name: string;
  readonly description?: string;
}

export async function createEngagement(
  db: SqlClient,
  input: CreateEngagementInput,
): Promise<Engagement> {
  const id = randomUUID();
  try {
    const res = await db.query<EngagementRow>(
      `INSERT INTO engagements (id, tenant_id, slug, name, description)
         VALUES ($1, $2, $3, $4, $5)
       RETURNING id, tenant_id, slug, name, description, status,
                 created_at, updated_at, archived_at`,
      [id, input.tenantId, input.slug, input.name, input.description ?? ''],
    );
    const row = res.rows[0];
    if (row === undefined) throw new Error('createEngagement: no row returned');
    return toEngagement(row);
  } catch (err) {
    if (err instanceof Error && /idx_engagements_tenant_slug|duplicate key/.test(err.message)) {
      throw new EngagementSlugConflictError(input.slug);
    }
    throw err;
  }
}

export async function getEngagementBySlug(
  db: SqlClient,
  args: { readonly tenantId: string; readonly slug: string },
): Promise<Engagement | null> {
  const res = await db.query<EngagementRow>(
    `SELECT id, tenant_id, slug, name, description, status,
            created_at, updated_at, archived_at
       FROM engagements
      WHERE tenant_id = $1 AND slug = $2`,
    [args.tenantId, args.slug],
  );
  const row = res.rows[0];
  return row === undefined ? null : toEngagement(row);
}

export async function listEngagements(
  db: SqlClient,
  args: { readonly tenantId: string; readonly status?: string },
): Promise<readonly Engagement[]> {
  const params: unknown[] = [args.tenantId];
  let statusClause = '';
  if (args.status !== undefined) {
    if (!ALLOWED_ENGAGEMENT_STATUSES.has(args.status)) {
      throw new Error(`unknown engagement status: ${args.status}`);
    }
    params.push(args.status);
    statusClause = `AND status = $${params.length}`;
  }
  const res = await db.query<EngagementRow>(
    `SELECT id, tenant_id, slug, name, description, status,
            created_at, updated_at, archived_at
       FROM engagements
      WHERE tenant_id = $1 ${statusClause}
      ORDER BY created_at DESC, id DESC`,
    params,
  );
  return res.rows.map(toEngagement);
}

export interface UpdateEngagementInput {
  readonly tenantId: string;
  readonly id: string;
  readonly name?: string;
  readonly description?: string;
  readonly status?: string;
}

export async function updateEngagement(
  db: SqlClient,
  input: UpdateEngagementInput,
): Promise<Engagement | null> {
  if (input.status !== undefined && !ALLOWED_ENGAGEMENT_STATUSES.has(input.status)) {
    throw new Error(`unknown engagement status: ${input.status}`);
  }
  const sets: string[] = [];
  const params: unknown[] = [];
  if (input.name !== undefined) {
    params.push(input.name);
    sets.push(`name = $${params.length}`);
  }
  if (input.description !== undefined) {
    params.push(input.description);
    sets.push(`description = $${params.length}`);
  }
  if (input.status !== undefined) {
    params.push(input.status);
    sets.push(`status = $${params.length}`);
    if (input.status === 'archived') {
      sets.push('archived_at = now()');
    }
  }
  if (sets.length === 0) {
    // No-op update — return the current row.
    const cur = await db.query<EngagementRow>(
      `SELECT id, tenant_id, slug, name, description, status,
              created_at, updated_at, archived_at
         FROM engagements
        WHERE tenant_id = $1 AND id = $2`,
      [input.tenantId, input.id],
    );
    return cur.rows[0] === undefined ? null : toEngagement(cur.rows[0]);
  }
  sets.push('updated_at = now()');
  params.push(input.tenantId);
  params.push(input.id);
  const res = await db.query<EngagementRow>(
    `UPDATE engagements
        SET ${sets.join(', ')}
      WHERE tenant_id = $${params.length - 1} AND id = $${params.length}
    RETURNING id, tenant_id, slug, name, description, status,
              created_at, updated_at, archived_at`,
    params,
  );
  const row = res.rows[0];
  return row === undefined ? null : toEngagement(row);
}

// ---------- milestones ------------------------------------------------------

export interface CreateMilestoneInput {
  readonly tenantId: string;
  readonly engagementId: string;
  readonly title: string;
  readonly description?: string;
  readonly dueAt?: string | null;
}

export async function createMilestone(
  db: SqlClient,
  input: CreateMilestoneInput,
): Promise<Milestone> {
  const id = randomUUID();
  const res = await db.query<MilestoneRow>(
    `INSERT INTO engagement_milestones
       (id, engagement_id, tenant_id, title, description, due_at)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, engagement_id, tenant_id, title, description, status,
               due_at, signed_off_by, signed_off_at, rejected_reason,
               created_at, updated_at`,
    [
      id,
      input.engagementId,
      input.tenantId,
      input.title,
      input.description ?? '',
      input.dueAt ?? null,
    ],
  );
  const row = res.rows[0];
  if (row === undefined) throw new Error('createMilestone: no row returned');
  return toMilestone(row);
}

export async function listMilestones(
  db: SqlClient,
  args: { readonly tenantId: string; readonly engagementId: string },
): Promise<readonly Milestone[]> {
  const res = await db.query<MilestoneRow>(
    `SELECT id, engagement_id, tenant_id, title, description, status,
            due_at, signed_off_by, signed_off_at, rejected_reason,
            created_at, updated_at
       FROM engagement_milestones
      WHERE tenant_id = $1 AND engagement_id = $2
      ORDER BY created_at, id`,
    [args.tenantId, args.engagementId],
  );
  return res.rows.map(toMilestone);
}

export class MilestoneAlreadyDecidedError extends Error {
  constructor(id: string, status: string) {
    super(`milestone ${id} is already in terminal status '${status}'`);
    this.name = 'MilestoneAlreadyDecidedError';
  }
}

export async function signOffMilestone(
  db: SqlClient,
  args: {
    readonly tenantId: string;
    readonly milestoneId: string;
    readonly userId: string;
  },
): Promise<Milestone | null> {
  const cur = await db.query<MilestoneRow>(
    `SELECT id, engagement_id, tenant_id, title, description, status,
            due_at, signed_off_by, signed_off_at, rejected_reason,
            created_at, updated_at
       FROM engagement_milestones
      WHERE tenant_id = $1 AND id = $2`,
    [args.tenantId, args.milestoneId],
  );
  const row = cur.rows[0];
  if (row === undefined) return null;
  if (row.status === 'signed_off' || row.status === 'rejected') {
    throw new MilestoneAlreadyDecidedError(row.id, row.status);
  }
  const res = await db.query<MilestoneRow>(
    `UPDATE engagement_milestones
        SET status = 'signed_off',
            signed_off_by = $3,
            signed_off_at = now(),
            rejected_reason = NULL,
            updated_at = now()
      WHERE tenant_id = $1 AND id = $2
    RETURNING id, engagement_id, tenant_id, title, description, status,
              due_at, signed_off_by, signed_off_at, rejected_reason,
              created_at, updated_at`,
    [args.tenantId, args.milestoneId, args.userId],
  );
  const out = res.rows[0];
  return out === undefined ? null : toMilestone(out);
}

export async function rejectMilestone(
  db: SqlClient,
  args: {
    readonly tenantId: string;
    readonly milestoneId: string;
    readonly userId: string;
    readonly reason: string;
  },
): Promise<Milestone | null> {
  const cur = await db.query<MilestoneRow>(
    `SELECT id, status FROM engagement_milestones
      WHERE tenant_id = $1 AND id = $2`,
    [args.tenantId, args.milestoneId],
  );
  const row = cur.rows[0];
  if (row === undefined) return null;
  if (row.status === 'signed_off' || row.status === 'rejected') {
    throw new MilestoneAlreadyDecidedError(row.id, row.status);
  }
  const res = await db.query<MilestoneRow>(
    `UPDATE engagement_milestones
        SET status = 'rejected',
            rejected_reason = $4,
            signed_off_by = $3,
            signed_off_at = now(),
            updated_at = now()
      WHERE tenant_id = $1 AND id = $2
    RETURNING id, engagement_id, tenant_id, title, description, status,
              due_at, signed_off_by, signed_off_at, rejected_reason,
              created_at, updated_at`,
    [args.tenantId, args.milestoneId, args.userId, args.reason],
  );
  const out = res.rows[0];
  return out === undefined ? null : toMilestone(out);
}

// ---------- comments --------------------------------------------------------

export interface CreateCommentInput {
  readonly tenantId: string;
  readonly engagementId: string;
  readonly authorUserId: string | null;
  readonly body: string;
  readonly kind?: string;
  readonly runId?: string | null;
}

export async function createComment(
  db: SqlClient,
  input: CreateCommentInput,
): Promise<Comment> {
  const kind = input.kind ?? 'comment';
  if (!ALLOWED_COMMENT_KINDS.has(kind)) {
    throw new Error(`unknown comment kind: ${kind}`);
  }
  const id = randomUUID();
  const res = await db.query<CommentRow>(
    `INSERT INTO engagement_comments
       (id, engagement_id, tenant_id, run_id, author_user_id, body, kind)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id, engagement_id, tenant_id, run_id, author_user_id, body, kind, at`,
    [
      id,
      input.engagementId,
      input.tenantId,
      input.runId ?? null,
      input.authorUserId,
      input.body,
      kind,
    ],
  );
  const row = res.rows[0];
  if (row === undefined) throw new Error('createComment: no row returned');
  return toComment(row);
}

export async function listComments(
  db: SqlClient,
  args: {
    readonly tenantId: string;
    readonly engagementId: string;
    readonly kind?: string;
  },
): Promise<readonly Comment[]> {
  const params: unknown[] = [args.tenantId, args.engagementId];
  let kindClause = '';
  if (args.kind !== undefined) {
    if (!ALLOWED_COMMENT_KINDS.has(args.kind)) {
      throw new Error(`unknown comment kind: ${args.kind}`);
    }
    params.push(args.kind);
    kindClause = `AND kind = $${params.length}`;
  }
  const res = await db.query<CommentRow>(
    `SELECT id, engagement_id, tenant_id, run_id, author_user_id, body, kind, at
       FROM engagement_comments
      WHERE tenant_id = $1 AND engagement_id = $2 ${kindClause}
      ORDER BY at DESC, id DESC`,
    params,
  );
  return res.rows.map(toComment);
}
