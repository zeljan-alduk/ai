/**
 * `projects` table CRUD — wave 17.
 *
 * Foundation only: agents/runs/datasets/etc. are NOT yet scoped by
 * `project_id`. This module is the canonical home for project rows;
 * follow-up work threads `project_id` through everything else.
 *
 * All queries are tenant-scoped. The `slug` is unique per tenant; we
 * surface the conflict as a typed error so the route can return 409
 * instead of leaking a Postgres SQLSTATE upward.
 */

import type { Project } from '@aldo-ai/api-contract';
import type { SqlClient } from '@aldo-ai/storage';

/**
 * Postgres TIMESTAMPTZ columns come back from `pg` as JS `Date`
 * instances by default. The wire schema is ISO strings — we coerce
 * via `toIso()` below. Without this, `ListProjectsResponse.parse`
 * fails server-side with `Expected string, received date`.
 */
interface ProjectRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly slug: string;
  readonly name: string;
  readonly description: string;
  readonly archived_at: Date | string | null;
  readonly created_at: Date | string;
  readonly updated_at: Date | string;
  // SqlRow constraint — pg's row shape is open at runtime, but we
  // only consume the named columns above. The index signature lets
  // ProjectRow satisfy `R extends SqlRow` on `db.query<ProjectRow>`.
  readonly [k: string]: unknown;
}

export class ProjectSlugConflictError extends Error {
  constructor(slug: string) {
    super(`project slug already exists in this tenant: ${slug}`);
    this.name = 'ProjectSlugConflictError';
  }
}

function toIso(v: Date | string): string {
  return v instanceof Date ? v.toISOString() : v;
}

function toIsoOrNull(v: Date | string | null): string | null {
  if (v === null) return null;
  return toIso(v);
}

function toWire(r: ProjectRow): Project {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    slug: r.slug,
    name: r.name,
    description: r.description,
    archivedAt: toIsoOrNull(r.archived_at),
    createdAt: toIso(r.created_at),
    updatedAt: toIso(r.updated_at),
  };
}

export async function listProjects(
  db: SqlClient,
  args: { tenantId: string; includeArchived?: boolean },
): Promise<readonly Project[]> {
  const { tenantId, includeArchived = false } = args;
  const rows = includeArchived
    ? await db.query<ProjectRow>(
        'SELECT id, tenant_id, slug, name, description, archived_at, created_at, updated_at ' +
          'FROM projects WHERE tenant_id = $1 ORDER BY created_at DESC',
        [tenantId],
      )
    : await db.query<ProjectRow>(
        'SELECT id, tenant_id, slug, name, description, archived_at, created_at, updated_at ' +
          'FROM projects WHERE tenant_id = $1 AND archived_at IS NULL ORDER BY created_at DESC',
        [tenantId],
      );
  return rows.rows.map(toWire);
}

export async function getProjectById(
  db: SqlClient,
  args: { id: string; tenantId: string },
): Promise<Project | null> {
  const res = await db.query<ProjectRow>(
    'SELECT id, tenant_id, slug, name, description, archived_at, created_at, updated_at ' +
      'FROM projects WHERE id = $1 AND tenant_id = $2',
    [args.id, args.tenantId],
  );
  const row = res.rows[0];
  return row === undefined ? null : toWire(row);
}

/**
 * Resolve the tenant's "Default" project id — the destination for any
 * resource (agent, run, dataset, …) that's created without an explicit
 * project_id. Wave-17 retrofit helper.
 *
 * Resolution path:
 *   1. Slug lookup `WHERE tenant_id = $1 AND slug = 'default'`. Cheap
 *      (covered by the unique index from migration 019). This catches
 *      both the migration-time seed (formula-derived id) and signups
 *      after the migration (random-UUID id from auth/routes.ts).
 *   2. Returns null when the tenant has no Default project. Callers
 *      MAY treat null as "skip the project_id assignment" (the column
 *      is nullable in 020 specifically to keep this path
 *      non-fatal). The migration backfilled every existing tenant's
 *      agents to the Default project, so this only matters for
 *      brand-new tenants in the unlikely event signup's
 *      best-effort default-project seed failed.
 */
export async function getDefaultProjectIdForTenant(
  db: SqlClient,
  tenantId: string,
): Promise<string | null> {
  const res = await db.query<{ id: string }>(
    "SELECT id FROM projects WHERE tenant_id = $1 AND slug = 'default' LIMIT 1",
    [tenantId],
  );
  return res.rows[0]?.id ?? null;
}

export async function getProjectBySlug(
  db: SqlClient,
  args: { slug: string; tenantId: string },
): Promise<Project | null> {
  const res = await db.query<ProjectRow>(
    'SELECT id, tenant_id, slug, name, description, archived_at, created_at, updated_at ' +
      'FROM projects WHERE slug = $1 AND tenant_id = $2',
    [args.slug, args.tenantId],
  );
  const row = res.rows[0];
  return row === undefined ? null : toWire(row);
}

export async function createProject(
  db: SqlClient,
  args: {
    id: string;
    tenantId: string;
    slug: string;
    name: string;
    description: string;
  },
): Promise<Project> {
  try {
    const res = await db.query<ProjectRow>(
      'INSERT INTO projects (id, tenant_id, slug, name, description) ' +
        'VALUES ($1, $2, $3, $4, $5) ' +
        'RETURNING id, tenant_id, slug, name, description, archived_at, created_at, updated_at',
      [args.id, args.tenantId, args.slug, args.name, args.description],
    );
    const row = res.rows[0];
    if (row === undefined) {
      throw new Error('createProject: insert returned no row');
    }
    return toWire(row);
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new ProjectSlugConflictError(args.slug);
    }
    throw err;
  }
}

export async function updateProject(
  db: SqlClient,
  args: {
    id: string;
    tenantId: string;
    slug?: string;
    name?: string;
    description?: string;
    archived?: boolean;
  },
): Promise<Project | null> {
  // Build a typed SET list. We never run an UPDATE with zero columns —
  // the route filters that case before getting here.
  const sets: string[] = [];
  const params: unknown[] = [args.id, args.tenantId];
  let p = 3;
  if (args.slug !== undefined) {
    sets.push(`slug = $${p++}`);
    params.push(args.slug);
  }
  if (args.name !== undefined) {
    sets.push(`name = $${p++}`);
    params.push(args.name);
  }
  if (args.description !== undefined) {
    sets.push(`description = $${p++}`);
    params.push(args.description);
  }
  if (args.archived !== undefined) {
    sets.push(`archived_at = ${args.archived ? 'now()' : 'NULL'}`);
  }
  sets.push('updated_at = now()');

  try {
    const res = await db.query<ProjectRow>(
      `UPDATE projects SET ${sets.join(', ')} WHERE id = $1 AND tenant_id = $2 RETURNING id, tenant_id, slug, name, description, archived_at, created_at, updated_at`,
      params,
    );
    const row = res.rows[0];
    return row === undefined ? null : toWire(row);
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new ProjectSlugConflictError(args.slug ?? '');
    }
    throw err;
  }
}

/**
 * Postgres unique-violation = SQLSTATE 23505. We narrow on `code` only
 * and never on the constraint name — drivers spell that field
 * differently across versions.
 */
function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: string }).code === '23505'
  );
}
