/**
 * @meridian/storage — shared Postgres helpers + schema for the platform.
 *
 * This package owns:
 *  - the SQL migration runner and the canonical `001_init.sql`,
 *  - a thin `SqlClient` abstraction that hides node-postgres / Neon /
 *    pglite behind a single interface (so consumers stay driver-agnostic),
 *  - the Drizzle ORM schema definitions for queries + future codegen.
 *
 * It deliberately does NOT depend on `@meridian/types`; the JSONB columns
 * carry cross-package payloads as opaque values. Registry + engine
 * supply the typed wrappers.
 */

export {
  fromDatabaseUrl,
  detectDriver,
  splitSqlScript,
  type SqlClient,
  type SqlResult,
  type SqlRow,
  type PoolOptions,
} from './pool.js';

export {
  migrate,
  listApplied,
  defaultMigrationsDir,
  parseMigrationName,
  type MigrationRecord,
  type MigrateOptions,
} from './migrate.js';

export * as schema from './schema.js';
