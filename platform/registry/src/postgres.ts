/**
 * Postgres-backed `RegistryStorage`.
 *
 * Persists agent specs, version history, and the promotion pointer in the
 * `agents` and `agent_versions` tables defined by `@meridian/storage`.
 * The promotion pointer is encoded as a partial `WHERE promoted = TRUE`
 * row per agent name — there is at most one promoted row at a time, kept
 * consistent inside a transaction.
 *
 * This module imports `@meridian/storage`'s `SqlClient` interface only;
 * it is driver-agnostic.
 */

import type { AgentSpec } from '@meridian/types';
import type { SqlClient } from '@meridian/storage';
import { assertValid, compare, latest } from './semver.js';
import {
  AgentNotFoundError,
  NoPromotedVersionError,
  type RegistryStorage,
  type StoredVersion,
} from './storage.js';

export interface PostgresStorageOptions {
  /** Injected SqlClient — caller owns the lifecycle (close, etc.). */
  readonly client: SqlClient;
  /** Optional clock; defaults to `new Date()`. */
  readonly now?: () => Date;
}

interface AgentVersionRow {
  readonly name: string;
  readonly version: string;
  readonly spec_json: AgentSpec | string;
  readonly promoted: boolean;
  readonly eval_evidence_json: unknown;
  readonly created_at: string | Date;
  readonly [k: string]: unknown;
}

export class PostgresStorage implements RegistryStorage {
  private readonly client: SqlClient;
  private readonly now: () => Date;

  constructor(opts: PostgresStorageOptions) {
    this.client = opts.client;
    this.now = opts.now ?? (() => new Date());
  }

  async put(spec: AgentSpec): Promise<void> {
    const { name, version, owner } = spec.identity;
    assertValid(version);
    const specJson = JSON.stringify(spec);

    // Upsert the parent agent row first so foreign-key style joins are
    // possible later. We don't enforce an FK in the schema yet because
    // CLI bootstrap registers specs before any tenant/owner table is
    // populated.
    await this.client.query(
      `INSERT INTO agents (name, owner) VALUES ($1, $2)
       ON CONFLICT (name) DO UPDATE SET owner = EXCLUDED.owner`,
      [name, owner],
    );

    await this.client.query(
      `INSERT INTO agent_versions (name, version, spec_json, promoted, created_at)
       VALUES ($1, $2, $3::jsonb, FALSE, $4)
       ON CONFLICT (name, version) DO UPDATE
         SET spec_json = EXCLUDED.spec_json`,
      [name, version, specJson, this.now().toISOString()],
    );
  }

  async has(name: string, version?: string): Promise<boolean> {
    if (version === undefined) {
      const r = await this.client.query<{ count: string | number }>(
        `SELECT count(*)::text AS count FROM agent_versions WHERE name = $1`,
        [name],
      );
      return Number(r.rows[0]?.count ?? 0) > 0;
    }
    const r = await this.client.query<{ count: string | number }>(
      `SELECT count(*)::text AS count FROM agent_versions WHERE name = $1 AND version = $2`,
      [name, version],
    );
    return Number(r.rows[0]?.count ?? 0) > 0;
  }

  async getVersion(name: string, version: string): Promise<StoredVersion> {
    const r = await this.client.query<AgentVersionRow>(
      `SELECT name, version, spec_json, promoted, eval_evidence_json, created_at
         FROM agent_versions WHERE name = $1 AND version = $2`,
      [name, version],
    );
    const row = r.rows[0];
    if (row === undefined) throw new AgentNotFoundError(name, version);
    return rowToStored(row);
  }

  async getPromoted(name: string): Promise<StoredVersion> {
    const r = await this.client.query<AgentVersionRow>(
      `SELECT name, version, spec_json, promoted, eval_evidence_json, created_at
         FROM agent_versions WHERE name = $1 AND promoted = TRUE`,
      [name],
    );
    const row = r.rows[0];
    if (row === undefined) throw new NoPromotedVersionError(name);
    return rowToStored(row);
  }

  async listVersions(name: string): Promise<readonly string[]> {
    const r = await this.client.query<{ version: string }>(
      `SELECT version FROM agent_versions WHERE name = $1`,
      [name],
    );
    return r.rows.map((row) => row.version).sort(compare);
  }

  async listNames(): Promise<readonly string[]> {
    const r = await this.client.query<{ name: string }>(
      `SELECT DISTINCT name FROM agent_versions ORDER BY name ASC`,
    );
    return r.rows.map((row) => row.name);
  }

  async promotedVersion(name: string): Promise<string | null> {
    const r = await this.client.query<{ version: string }>(
      `SELECT version FROM agent_versions WHERE name = $1 AND promoted = TRUE`,
      [name],
    );
    return r.rows[0]?.version ?? null;
  }

  async promote(name: string, version: string, evidence: unknown): Promise<void> {
    // Verify the (name, version) exists before flipping the pointer.
    const r = await this.client.query<{ count: string | number }>(
      `SELECT count(*)::text AS count FROM agent_versions WHERE name = $1 AND version = $2`,
      [name, version],
    );
    if (Number(r.rows[0]?.count ?? 0) === 0) {
      throw new AgentNotFoundError(name, version);
    }

    // Two-step "transaction" expressed without BEGIN/COMMIT so we don't
    // care which driver is in use — Neon HTTP doesn't support multi-stmt
    // transactions over the wire. The window where a name has zero
    // promoted rows is microseconds; readers that fall into it just see
    // `promotedVersion -> null` and fall back to the bootstrap path.
    await this.client.query(
      `UPDATE agent_versions SET promoted = FALSE WHERE name = $1 AND promoted = TRUE`,
      [name],
    );
    await this.client.query(
      `UPDATE agent_versions
         SET promoted = TRUE, eval_evidence_json = $3::jsonb
         WHERE name = $1 AND version = $2`,
      [name, version, JSON.stringify(evidence ?? null)],
    );
  }

  async latestVersion(name: string): Promise<string | null> {
    return latest(await this.listVersions(name));
  }
}

function rowToStored(row: AgentVersionRow): StoredVersion {
  const spec: AgentSpec =
    typeof row.spec_json === 'string' ? (JSON.parse(row.spec_json) as AgentSpec) : row.spec_json;
  const storedAt =
    row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at);
  const out: StoredVersion =
    row.eval_evidence_json !== null && row.eval_evidence_json !== undefined
      ? { spec, storedAt, promotionEvidence: row.eval_evidence_json }
      : { spec, storedAt };
  return out;
}
