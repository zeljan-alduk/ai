# @aldo-ai/storage

Postgres helpers, schema, and migrations shared by `@aldo-ai/registry`
and `@aldo-ai/engine` (and, in a later wave, `@aldo-ai/observability`).

## Why this package exists

The platform needs persistence in three places — the agent registry,
the engine checkpointer, and the OTEL span exporter — and all three
should target the same database without duplicating connection logic
or schema. This package owns:

1. The **SQL of record** (numbered files in `migrations/`).
2. A driver-agnostic **`SqlClient`** that wraps node-postgres, Neon
   serverless, and pglite behind one tiny interface.
3. A **migration runner** (`migrate()`) that applies pending files in
   order and is idempotent on rerun.
4. **Drizzle schema** definitions for typed queries.

It does **not** import from `@aldo-ai/types`. JSONB columns carry
cross-package payloads (`AgentSpec`, `RunOverrides`, …) as opaque
values; the registry + engine supply typed wrappers.

## ORM choice: Drizzle

We picked **Drizzle ORM** over Kysely for two reasons:

1. **Neon serverless** is the documented free-tier deploy target
   (see `.env.example`). Drizzle has first-class support for the
   `@neondatabase/serverless` HTTP driver and is the one Neon's own
   docs recommend; Kysely's Neon dialect is a third-party shim.
2. **Schema-as-code** plays better with our agents-as-data ethos:
   `pgTable(...)` definitions are the single declarative source for
   columns and indexes, and `drizzle-kit` can codegen migrations from
   diffs in a later wave (we hand-write the seed migration to keep
   the dep tree small).

Neither choice would have been wrong; Kysely's pure-builder approach
is appealing. We're not exposing Drizzle types at the package
boundary — the `SqlClient` interface is what other packages see —
so swapping is mechanical if we ever need to.

## How `DATABASE_URL` is consumed

This is the platform-wide convention: every persistence-aware package
reads `process.env.DATABASE_URL` (or accepts an injected `SqlClient`)
and calls `fromDatabaseUrl()` from this package. Driver detection is
URL-driven:

| URL                                                | Driver          |
| -------------------------------------------------- | --------------- |
| empty string, `pglite:`, `pglite:/path`, `memory://` | pglite (in-proc) |
| `postgres://...neon.tech/...`                       | Neon HTTP        |
| anything else                                       | node-postgres    |

`MERIDIAN_FORCE_NEON=1` bypasses host detection (useful behind
custom CNAMEs).

> **Other packages should NOT branch on driver type.** If your code
> does `if (driver === 'pg')`, that's a bug — it means we leaked
> driver-specific behaviour out of `pool.ts`.

## Schema (matches `migrations/001_init.sql`)

| Table            | Columns (abbreviated)                                                     |
| ---------------- | ------------------------------------------------------------------------- |
| `tenants`        | `id pk, name, created_at`                                                 |
| `agents`         | `name pk, owner`                                                          |
| `agent_versions` | `(name, version) pk, spec_json, promoted, eval_evidence_json, created_at` |
| `runs`           | `id pk, tenant_id, agent_name, agent_version, parent_run_id?, started_at, ended_at?, status` |
| `checkpoints`    | `id pk, run_id, node_path, payload_jsonb, created_at`                     |
| `run_events`     | `id pk, run_id, type, payload_jsonb, at`                                  |
| `usage_records`  | `id pk, run_id, span_id, provider, model, tokens_in, tokens_out, usd, at` |
| `span_events`    | `id pk, run_id, trace_id, span_id, parent_span_id?, kind, attrs_jsonb, started_at, ended_at?, status` |

Indexes:

- `checkpoints`, `run_events`, `usage_records`, `span_events` are all indexed on `run_id`.
- `agent_versions` has a partial index on `(name) WHERE promoted = TRUE`.
- `runs` is indexed on `parent_run_id` (and `tenant_id` for free).

## Tests: pglite, no Docker

`@electric-sql/pglite` is a WASM build of Postgres that runs entirely
in-process. We picked it over testcontainers because:

- CI on the GitHub free tier does not have privileged Docker access
  in every runner; pglite needs only Node 22.
- Tests are an order of magnitude faster — no container boot.
- The dialect coverage is enough for our schema (plain DDL +
  JSONB + indexes).

If you ever need to validate against a real Postgres, point
`DATABASE_URL` at it and rerun the same tests; the driver swap is
transparent.

## Layout

```
src/
  pool.ts       SqlClient abstraction + driver detection
  migrate.ts    numbered .sql migration runner
  schema.ts     Drizzle ORM schema (matches 001_init.sql)
  index.ts      public surface
migrations/
  001_init.sql  canonical seed schema
tests/
  migrate.test.ts
```

## LLM-agnostic

This package contains no provider SDKs and makes no model calls. It
only persists and queries data that other packages produce.
