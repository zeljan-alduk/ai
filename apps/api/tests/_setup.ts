/**
 * Test harness for the control-plane API.
 *
 * Spins up an in-memory pglite, applies the storage migrations, and
 * returns a `Deps` bag configured the same way production uses one —
 * just with the SQL client injected so we don't open a port and don't
 * read the real environment.
 *
 * Each test file should call `setupTestEnv()` in `beforeAll` and
 * `teardown()` the returned harness in `afterAll`. Seeding helpers live
 * here too so the test files stay focused on assertions.
 */

import { AgentRegistry, PostgresStorage } from '@aldo-ai/registry';
import { InMemorySecretStore } from '@aldo-ai/secrets';
import { type SqlClient, fromDatabaseUrl, migrate } from '@aldo-ai/storage';
import { buildApp } from '../src/app.js';
import { type Deps, type Env, createDeps } from '../src/deps.js';

export interface TestEnv {
  readonly deps: Deps;
  readonly app: ReturnType<typeof buildApp>;
  readonly db: SqlClient;
  teardown(): Promise<void>;
}

export async function setupTestEnv(envOverrides: Env = {}): Promise<TestEnv> {
  const db = await fromDatabaseUrl({ driver: 'pglite' });
  await migrate(db);
  const env: Env = { DATABASE_URL: '', ...envOverrides };
  const registry = new AgentRegistry({ storage: new PostgresStorage({ client: db }) });
  // Tests use the in-memory secrets store so we never need a master
  // key in the test env. Tests that exercise persistence semantics can
  // build a `PostgresSecretStore` directly via the same `db`.
  const secrets = { store: new InMemorySecretStore() };
  const deps = await createDeps(env, { db, registry, secrets });
  const app = buildApp(deps, { log: false });
  return {
    deps,
    app,
    db,
    async teardown() {
      await db.close();
    },
  };
}

// --- seeders ---------------------------------------------------------------

export interface SeedRunOptions {
  readonly id: string;
  readonly agentName: string;
  readonly agentVersion?: string;
  readonly tenantId?: string;
  readonly status?: string;
  readonly parentRunId?: string | null;
  readonly startedAt: string;
  readonly endedAt?: string | null;
  readonly usage?: readonly {
    readonly provider: string;
    readonly model: string;
    readonly tokensIn?: number;
    readonly tokensOut?: number;
    readonly usd?: number;
    readonly at?: string;
  }[];
  readonly events?: readonly {
    readonly id: string;
    readonly type: string;
    readonly payload: unknown;
    readonly at?: string;
  }[];
}

export async function seedRun(db: SqlClient, opts: SeedRunOptions): Promise<void> {
  await db.query(
    `INSERT INTO runs (id, tenant_id, agent_name, agent_version, parent_run_id, started_at, ended_at, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      opts.id,
      opts.tenantId ?? 'tenant-test',
      opts.agentName,
      opts.agentVersion ?? '1.0.0',
      opts.parentRunId ?? null,
      opts.startedAt,
      opts.endedAt ?? null,
      opts.status ?? 'completed',
    ],
  );
  if (opts.usage !== undefined) {
    let i = 0;
    for (const u of opts.usage) {
      await db.query(
        `INSERT INTO usage_records (id, run_id, span_id, provider, model, tokens_in, tokens_out, usd, at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          `${opts.id}-u-${i}`,
          opts.id,
          `${opts.id}-span-${i}`,
          u.provider,
          u.model,
          u.tokensIn ?? 0,
          u.tokensOut ?? 0,
          (u.usd ?? 0).toFixed(6),
          u.at ?? opts.startedAt,
        ],
      );
      i += 1;
    }
  }
  if (opts.events !== undefined) {
    for (const e of opts.events) {
      await db.query(
        `INSERT INTO run_events (id, run_id, type, payload_jsonb, at)
         VALUES ($1, $2, $3, $4::jsonb, $5)`,
        [e.id, opts.id, e.type, JSON.stringify(e.payload), e.at ?? opts.startedAt],
      );
    }
  }
}

export interface SeedAgentOptions {
  readonly name: string;
  readonly owner: string;
  readonly version: string;
  readonly team: string;
  readonly description?: string;
  readonly tags?: readonly string[];
  readonly privacyTier?: 'public' | 'internal' | 'sensitive';
  readonly promoted?: boolean;
  readonly createdAt?: string;
  readonly extraSpec?: Record<string, unknown>;
}

export async function seedAgent(db: SqlClient, opts: SeedAgentOptions): Promise<void> {
  const spec = {
    apiVersion: 'aldo-ai/agent.v1',
    kind: 'Agent',
    identity: {
      name: opts.name,
      version: opts.version,
      description: opts.description ?? `${opts.name} agent`,
      owner: opts.owner,
      tags: [...(opts.tags ?? [])],
    },
    role: { team: opts.team, pattern: 'worker' },
    modelPolicy: {
      privacyTier: opts.privacyTier ?? 'internal',
      capabilityRequirements: [],
      primary: { capabilityClass: 'reasoning-medium' },
      fallbacks: [],
      budget: { usdMax: 1, usdGrace: 0 },
      decoding: { mode: 'free' },
    },
    ...(opts.extraSpec ?? {}),
  };
  await db.query(
    `INSERT INTO agents (name, owner) VALUES ($1, $2)
     ON CONFLICT (name) DO UPDATE SET owner = EXCLUDED.owner`,
    [opts.name, opts.owner],
  );
  await db.query(
    `INSERT INTO agent_versions (name, version, spec_json, promoted, created_at)
     VALUES ($1, $2, $3::jsonb, $4, $5)`,
    [
      opts.name,
      opts.version,
      JSON.stringify(spec),
      opts.promoted ?? false,
      opts.createdAt ?? new Date().toISOString(),
    ],
  );
}
