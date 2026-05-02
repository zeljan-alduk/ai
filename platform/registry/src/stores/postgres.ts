/**
 * Postgres-backed `RegisteredAgentStore`.
 *
 * Reads/writes the wave-10 `registered_agents` and
 * `registered_agent_pointer` tables defined in migration 007. Every
 * query is hard-scoped by `tenant_id = $1` — the store NEVER issues a
 * statement that could match rows in another tenant. This is the
 * platform's tenant isolation boundary; bugs here are security
 * incidents.
 *
 * The store handles three core writes:
 *
 *   - register(tenantId, spec, yaml) — upsert the version row + bump
 *     the pointer in the same logical operation. Used by the API's
 *     "register a new spec" path (POST /v1/agents) and by the boot
 *     seeder.
 *   - upsertVersion(...)  — version row only; pointer untouched. Used
 *     by the eval gate to stage a candidate before promotion.
 *   - promote(tenantId, name, version) — bump the pointer. Throws when
 *     the (tenant, name, version) row is missing so we can never set
 *     the pointer to a phantom version.
 *
 * The pointer is a separate row per (tenant, name) so the invariant
 * "at most one current version per agent" is enforced by the PRIMARY
 * KEY rather than by the application.
 *
 * Driver-agnostic: this module imports the `SqlClient` interface only;
 * the host wires pglite/pg/Neon via `@aldo-ai/storage`.
 */

import { randomUUID } from 'node:crypto';
import type { SqlClient } from '@aldo-ai/storage';
import type { AgentSpec } from '@aldo-ai/types';
import { parseYaml } from '../loader.js';
import { RegisteredAgentNotFoundError } from './in-memory.js';
import type {
  ListOptions,
  RegisterOptions,
  RegisteredAgent,
  RegisteredAgentStore,
} from './types.js';

export interface PostgresRegisteredAgentStoreOptions {
  readonly client: SqlClient;
  readonly now?: () => Date;
}

interface AgentRow {
  readonly tenant_id: string;
  /**
   * Wave-17 (migration 020). Nullable on the wire AND in storage —
   * the column was added without NOT NULL so any in-flight insert
   * from a pre-020 code path doesn't crash. New writes resolve to
   * the tenant's Default project before reaching this layer.
   */
  readonly project_id: string | null;
  readonly name: string;
  readonly version: string;
  readonly spec_yaml: string;
  readonly created_at: string | Date;
  readonly updated_at: string | Date;
  readonly [k: string]: unknown;
}

interface PointerRow {
  readonly tenant_id: string;
  readonly name: string;
  readonly current_version: string | null;
  readonly [k: string]: unknown;
}

export class PostgresRegisteredAgentStore implements RegisteredAgentStore {
  private readonly db: SqlClient;
  private readonly now: () => Date;

  constructor(opts: PostgresRegisteredAgentStoreOptions) {
    this.db = opts.client;
    this.now = opts.now ?? (() => new Date());
  }

  async list(tenantId: string, opts: ListOptions = {}): Promise<readonly RegisteredAgent[]> {
    // INNER JOIN against the pointer so soft-deleted rows
    // (current_version IS NULL) are filtered out automatically.
    //
    // Wave-17: when `opts.projectId` is set, narrow to that project.
    // Without the filter we keep the pre-wave-17 "all agents in
    // tenant" semantics so pre-picker clients don't break.
    if (opts.projectId !== undefined) {
      const res = await this.db.query<AgentRow>(
        `SELECT ra.tenant_id, ra.project_id, ra.name, ra.version, ra.spec_yaml, ra.created_at, ra.updated_at
           FROM registered_agent_pointer rap
           JOIN registered_agents ra
             ON ra.tenant_id = rap.tenant_id
            AND ra.name      = rap.name
            AND ra.version   = rap.current_version
          WHERE rap.tenant_id = $1
            AND rap.current_version IS NOT NULL
            AND ra.project_id = $2
          ORDER BY ra.name ASC`,
        [tenantId, opts.projectId],
      );
      return res.rows.map(rowToAgent);
    }
    const res = await this.db.query<AgentRow>(
      `SELECT ra.tenant_id, ra.project_id, ra.name, ra.version, ra.spec_yaml, ra.created_at, ra.updated_at
         FROM registered_agent_pointer rap
         JOIN registered_agents ra
           ON ra.tenant_id = rap.tenant_id
          AND ra.name      = rap.name
          AND ra.version   = rap.current_version
        WHERE rap.tenant_id = $1
          AND rap.current_version IS NOT NULL
        ORDER BY ra.name ASC`,
      [tenantId],
    );
    return res.rows.map(rowToAgent);
  }

  async listAllVersions(tenantId: string, name: string): Promise<readonly RegisteredAgent[]> {
    const res = await this.db.query<AgentRow>(
      `SELECT tenant_id, project_id, name, version, spec_yaml, created_at, updated_at
         FROM registered_agents
        WHERE tenant_id = $1 AND name = $2
        ORDER BY created_at DESC, version DESC`,
      [tenantId, name],
    );
    return res.rows.map(rowToAgent);
  }

  async get(tenantId: string, name: string): Promise<RegisteredAgent | null> {
    const res = await this.db.query<AgentRow>(
      `SELECT ra.tenant_id, ra.project_id, ra.name, ra.version, ra.spec_yaml, ra.created_at, ra.updated_at
         FROM registered_agent_pointer rap
         JOIN registered_agents ra
           ON ra.tenant_id = rap.tenant_id
          AND ra.name      = rap.name
          AND ra.version   = rap.current_version
        WHERE rap.tenant_id = $1
          AND rap.name      = $2
          AND rap.current_version IS NOT NULL`,
      [tenantId, name],
    );
    const row = res.rows[0];
    return row === undefined ? null : rowToAgent(row);
  }

  async getVersion(
    tenantId: string,
    name: string,
    version: string,
  ): Promise<RegisteredAgent | null> {
    const res = await this.db.query<AgentRow>(
      `SELECT tenant_id, project_id, name, version, spec_yaml, created_at, updated_at
         FROM registered_agents
        WHERE tenant_id = $1 AND name = $2 AND version = $3`,
      [tenantId, name, version],
    );
    const row = res.rows[0];
    return row === undefined ? null : rowToAgent(row);
  }

  async register(
    tenantId: string,
    spec: AgentSpec,
    specYaml: string,
    opts: RegisterOptions = {},
  ): Promise<RegisteredAgent> {
    await this.upsertVersionImpl(tenantId, spec, specYaml, opts.projectId ?? null);
    await this.upsertPointer(tenantId, spec.identity.name, spec.identity.version);
    const got = await this.getVersion(tenantId, spec.identity.name, spec.identity.version);
    if (got === null) {
      // Should be unreachable — the upsert above just wrote this row.
      throw new Error(
        `register() failed to read back ${spec.identity.name}@${spec.identity.version}`,
      );
    }
    return got;
  }

  async upsertVersion(
    tenantId: string,
    spec: AgentSpec,
    specYaml: string,
    opts: RegisterOptions = {},
  ): Promise<RegisteredAgent> {
    await this.upsertVersionImpl(tenantId, spec, specYaml, opts.projectId ?? null);
    const got = await this.getVersion(tenantId, spec.identity.name, spec.identity.version);
    if (got === null) {
      throw new Error(
        `upsertVersion() failed to read back ${spec.identity.name}@${spec.identity.version}`,
      );
    }
    return got;
  }

  async moveToProject(tenantId: string, name: string, projectId: string): Promise<void> {
    // Wave-17: rehome every version of `name` (within `tenantId`) to a
    // different project. We update every version row, not just the
    // pointer-current one, so /v1/agents/:name/versions/:version
    // continues to surface project_id consistently across the history.
    await this.db.query(
      `UPDATE registered_agents
          SET project_id = $3,
              updated_at = $4::timestamptz
        WHERE tenant_id = $1 AND name = $2`,
      [tenantId, name, projectId, this.now().toISOString()],
    );
  }

  async promote(tenantId: string, name: string, version: string): Promise<void> {
    // Verify the version exists IN THIS TENANT before bumping the pointer.
    // A cross-tenant lookup must surface as not-found — never as success.
    const r = await this.db.query<{ count: string | number }>(
      `SELECT count(*)::text AS count FROM registered_agents
         WHERE tenant_id = $1 AND name = $2 AND version = $3`,
      [tenantId, name, version],
    );
    if (Number(r.rows[0]?.count ?? 0) === 0) {
      throw new RegisteredAgentNotFoundError(tenantId, name, version);
    }
    await this.upsertPointer(tenantId, name, version);
  }

  async delete(tenantId: string, name: string): Promise<void> {
    // Soft delete: keep version history, null the pointer.
    await this.db.query(
      `UPDATE registered_agent_pointer
          SET current_version = NULL,
              updated_at = $3::timestamptz
        WHERE tenant_id = $1 AND name = $2`,
      [tenantId, name, this.now().toISOString()],
    );
  }

  // --- internals ----------------------------------------------------------

  private async upsertVersionImpl(
    tenantId: string,
    spec: AgentSpec,
    specYaml: string,
    projectId: string | null,
  ): Promise<void> {
    const { name, version } = spec.identity;
    const id = randomUUID();
    const nowIso = this.now().toISOString();
    // Wave-17: persist project_id alongside the version row. On
    // conflict (re-upsert of the same (tenant, name, version)) we
    // refresh project_id ONLY when the caller supplied one — passing
    // null for the conflict path leaves the existing project_id
    // intact via COALESCE. This keeps the eval-gate's stage-then-
    // promote pattern from accidentally clearing a previously-set
    // project assignment.
    await this.db.query(
      `INSERT INTO registered_agents (id, tenant_id, project_id, name, version, spec_yaml, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7::timestamptz, $7::timestamptz)
       ON CONFLICT (tenant_id, name, version) DO UPDATE
         SET spec_yaml  = EXCLUDED.spec_yaml,
             project_id = COALESCE(EXCLUDED.project_id, registered_agents.project_id),
             updated_at = EXCLUDED.updated_at`,
      [id, tenantId, projectId, name, version, specYaml, nowIso],
    );
  }

  private async upsertPointer(tenantId: string, name: string, version: string): Promise<void> {
    const nowIso = this.now().toISOString();
    await this.db.query(
      `INSERT INTO registered_agent_pointer (tenant_id, name, current_version, updated_at)
       VALUES ($1, $2, $3, $4::timestamptz)
       ON CONFLICT (tenant_id, name) DO UPDATE
         SET current_version = EXCLUDED.current_version,
             updated_at      = EXCLUDED.updated_at`,
      [tenantId, name, version, nowIso],
    );
  }
}

function rowToAgent(row: AgentRow): RegisteredAgent {
  // Re-parse the spec from the persisted YAML — same loader used at
  // write time, so the typed `spec` is byte-equivalent across rounds.
  const parsed = parseYaml(row.spec_yaml);
  if (!parsed.ok || parsed.spec === undefined) {
    throw new Error(
      `registered_agents row ${row.tenant_id}/${row.name}@${row.version} carried unparseable YAML`,
    );
  }
  return {
    tenantId: row.tenant_id,
    projectId: row.project_id ?? null,
    name: row.name,
    version: row.version,
    spec: parsed.spec,
    specYaml: row.spec_yaml,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

function toIso(v: unknown): string {
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'string') {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? v : d.toISOString();
  }
  return new Date(0).toISOString();
}

// Keep the unused-import linter happy: PointerRow is documented for
// readers of this file even though the actual queries materialise
// joined rows.
void (undefined as unknown as PointerRow);
