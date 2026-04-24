/**
 * Tiny migration runner.
 *
 * Applies numbered `.sql` files from a directory in lexicographic order.
 * Each successful migration is recorded in `_meridian_migrations`; reruns
 * are idempotent and skip applied versions.
 *
 * Migrations are forward-only — there is no `down`. If you need to roll
 * back, write a new numbered file. This matches how Neon, RDS, and most
 * production Postgres setups are operated and avoids the "did the down
 * actually run?" failure mode.
 */

import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SqlClient } from './pool.js';

export interface MigrationRecord {
  readonly version: string;
  readonly name: string;
  readonly appliedAt: string;
}

export interface MigrateOptions {
  /** Directory containing `NNN_name.sql` files. Defaults to the bundled migrations/. */
  readonly dir?: string;
  /** Override the bookkeeping table name. Useful for tests. */
  readonly table?: string;
}

const DEFAULT_TABLE = '_meridian_migrations';

/** Default migrations directory shipped with the package. */
export function defaultMigrationsDir(): string {
  // platform/storage/src/migrate.ts -> platform/storage/migrations
  return fileURLToPath(new URL('../migrations', import.meta.url));
}

/**
 * Apply every pending migration found in `dir`. Safe to run repeatedly;
 * already-applied versions are skipped.
 */
export async function migrate(client: SqlClient, opts: MigrateOptions = {}): Promise<MigrationRecord[]> {
  const dir = opts.dir ?? defaultMigrationsDir();
  const table = opts.table ?? DEFAULT_TABLE;

  await ensureMigrationsTable(client, table);
  const applied = await listApplied(client, table);
  const appliedSet = new Set(applied.map((m) => m.version));

  const files = await readdir(dir);
  const sqlFiles = files
    .filter((f) => f.endsWith('.sql'))
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

  const newlyApplied: MigrationRecord[] = [];
  for (const file of sqlFiles) {
    const { version, name } = parseMigrationName(file);
    if (appliedSet.has(version)) continue;
    const sql = await readFile(join(dir, file), 'utf8');
    await client.exec(sql);
    const appliedAt = new Date().toISOString();
    await client.query(
      `INSERT INTO ${table} (version, name, applied_at) VALUES ($1, $2, $3)`,
      [version, name, appliedAt],
    );
    newlyApplied.push({ version, name, appliedAt });
  }
  return newlyApplied;
}

/** Returns every migration ever applied, sorted by version ascending. */
export async function listApplied(
  client: SqlClient,
  table: string = DEFAULT_TABLE,
): Promise<MigrationRecord[]> {
  await ensureMigrationsTable(client, table);
  const res = await client.query<{ version: string; name: string; applied_at: string }>(
    `SELECT version, name, applied_at FROM ${table} ORDER BY version ASC`,
  );
  return res.rows.map((r) => ({ version: r.version, name: r.name, appliedAt: r.applied_at }));
}

async function ensureMigrationsTable(client: SqlClient, table: string): Promise<void> {
  await client.exec(
    `CREATE TABLE IF NOT EXISTS ${table} (
       version     TEXT PRIMARY KEY,
       name        TEXT NOT NULL,
       applied_at  TEXT NOT NULL
     )`,
  );
}

/** `001_init.sql` -> `{ version: "001", name: "init" }`. */
export function parseMigrationName(file: string): { version: string; name: string } {
  const base = file.replace(/\.sql$/, '');
  const match = /^(\d+)[_-](.+)$/.exec(base);
  if (match === null) {
    throw new Error(`migration filename must look like NNN_name.sql, got: ${file}`);
  }
  return { version: match[1] as string, name: match[2] as string };
}
