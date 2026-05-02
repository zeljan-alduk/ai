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

import { randomBytes } from 'node:crypto';
import { AgentRegistry, PostgresStorage } from '@aldo-ai/registry';
import { InMemorySecretStore } from '@aldo-ai/secrets';
import { type SqlClient, fromDatabaseUrl, migrate } from '@aldo-ai/storage';
import { buildApp } from '../src/app.js';
import { signSessionToken } from '../src/auth/jwt.js';
import { type Deps, type Env, SEED_TENANT_UUID, createDeps } from '../src/deps.js';
import { resetDiscoveryCache, resetHealthProbeCache } from '../src/routes/models.js';

export interface TestEnv {
  readonly deps: Deps;
  /**
   * `request()`-only proxy that auto-injects the default Authorization
   * header. Backwards-compatible with the wave-9 `app.request(path)`
   * signature so existing test files pass with no edits. Use `rawApp`
   * to skip the auto-injection (e.g. for the 401 negative tests).
   */
  readonly app: ReturnType<typeof buildApp>;
  /** The unwrapped Hono app — no automatic auth header injection. */
  readonly rawApp: ReturnType<typeof buildApp>;
  readonly db: SqlClient;
  /**
   * Default authentication header bound to a synthesised owner-role
   * session for `SEED_TENANT_UUID`. Tests pass this as
   * `app.request(path, { headers: env.authHeader })` so they don't
   * have to do the signup dance themselves.
   */
  readonly authHeader: { readonly Authorization: string };
  /** Mint a per-tenant header for cross-tenant tests. */
  authFor(
    tenantId: string,
    opts?: { readonly userId?: string },
  ): Promise<{ readonly Authorization: string }>;
  /** The tenant id baked into `authHeader`. */
  readonly tenantId: string;
  /** The raw default JWT (test files that exercise expiry/clock skew read this). */
  readonly token: string;
  /** Signing key tests use to mint custom tokens (e.g. expired). */
  readonly signingKey: Uint8Array;
  teardown(): Promise<void>;
}

/** Optional per-test-suite overrides for `Deps` fields not derived from `Env`. */
export interface SetupTestEnvOptions {
  /** Wave-3 — point the gallery fork endpoint at a fixture template tree. */
  readonly agencyDir?: string;
}

export async function setupTestEnv(
  envOverrides: Env = {},
  opts: SetupTestEnvOptions = {},
): Promise<TestEnv> {
  // /v1/models keeps a module-scoped discovery cache; reset between
  // harness instances so back-to-back setups don't share state.
  resetDiscoveryCache();
  resetHealthProbeCache();
  const db = await fromDatabaseUrl({ driver: 'pglite' });
  await migrate(db);
  // Disable local-LLM discovery in the test harness so /v1/models
  // doesn't spend the per-probe timeout budget hitting closed
  // localhost ports on every request. Individual tests that exercise
  // discovery override this via `envOverrides`.
  const env: Env = {
    DATABASE_URL: '',
    ALDO_LOCAL_DISCOVERY: 'none',
    // Wave-12 — `/v1/models` can opt into a live HTTP probe of local
    // OpenAI-compat servers. The default is opt-in (`live`) only for
    // production; the test harness leaves it unset so the existing
    // suite (which relies on env-var presence == available) keeps its
    // semantics. Individual tests that exercise the probe set this to
    // `live` via `envOverrides`.
    //
    // Wave-16 — disable distributed rate-limiting + monthly quota
    // enforcement by default in the test harness. The dedicated
    // rate-limit + quota tests OPT IN by overriding these. Without
    // this hatch every existing test would have to handle 429s and
    // 402s the same way the production app does.
    ALDO_RATE_LIMIT_DISABLED: '1',
    ALDO_QUOTA_DISABLED: '1',
    ...envOverrides,
  };
  const registry = new AgentRegistry({ storage: new PostgresStorage({ client: db }) });
  // Tests use the in-memory secrets store so we never need a master
  // key in the test env. Tests that exercise persistence semantics can
  // build a `PostgresSecretStore` directly via the same `db`.
  const secrets = { store: new InMemorySecretStore() };
  // Stable signing key per-harness so we can mint tokens after the
  // deps are built. Production uses a 32-byte env var; here we
  // synthesise one in-memory.
  const signingKey = new Uint8Array(randomBytes(32));
  const deps = await createDeps(env, {
    db,
    registry,
    secrets,
    signingKey,
    ...(opts.agencyDir !== undefined ? { agencyDir: opts.agencyDir } : {}),
  });
  const app = buildApp(deps, { log: false });
  // Mint a default token for the canonical SEED tenant. Migration 006
  // already inserted the tenant row; we additionally seed a `users`
  // row + membership so /v1/auth/me returns a real session and not a
  // 403 (the route 403s when the JWT's `sub` doesn't resolve).
  const testUserId = 'test-user-seed';
  await db.query(
    `INSERT INTO users (id, email, password_hash)
     VALUES ($1, 'test-seed@aldo.test', 'test-only-not-a-real-hash')
     ON CONFLICT (id) DO NOTHING`,
    [testUserId],
  );
  await db.query(
    `INSERT INTO tenant_members (tenant_id, user_id, role)
     VALUES ($1, $2, 'owner')
     ON CONFLICT (tenant_id, user_id) DO NOTHING`,
    [SEED_TENANT_UUID, testUserId],
  );
  const token = await signSessionToken(
    {
      sub: testUserId,
      tid: SEED_TENANT_UUID,
      slug: 'default',
      role: 'owner',
    },
    signingKey,
  );
  const authHeader = { Authorization: `Bearer ${token}` };
  const authFor = async (
    tenantId: string,
    opts: { readonly userId?: string } = {},
  ): Promise<{ readonly Authorization: string }> => {
    // For arbitrary tenants we synthesise a tenant row when needed so
    // FK constraints in registered_agents/runs/etc stay satisfied. The
    // slug uses the FULL tenantId to avoid collisions when two
    // requested ids share the first 8 chars (UUIDs frequently do).
    const slug = `t-${tenantId.replace(/[^a-z0-9-]/gi, '').toLowerCase()}`;
    await db.query(
      `INSERT INTO tenants (id, slug, name, created_at)
       VALUES ($1, $2, $2, now())
       ON CONFLICT (id) DO NOTHING`,
      [tenantId, slug],
    );
    // Also ensure the user row exists so /v1/auth/me works for synth
    // sessions. Tests can override `userId`; otherwise we mint a stable
    // per-tenant id so successive calls from the same tenant return
    // the same user.
    const userId = opts.userId ?? `user-for-${tenantId}`;
    await db.query(
      `INSERT INTO users (id, email, password_hash) VALUES ($1, $2, 'test-only')
       ON CONFLICT (id) DO NOTHING`,
      [userId, `${userId}@aldo.test`],
    );
    await db.query(
      `INSERT INTO tenant_members (tenant_id, user_id, role) VALUES ($1, $2, 'owner')
       ON CONFLICT (tenant_id, user_id) DO NOTHING`,
      [tenantId, userId],
    );
    const t = await signSessionToken(
      { sub: userId, tid: tenantId, slug, role: 'owner' },
      signingKey,
    );
    return { Authorization: `Bearer ${t}` };
  };
  // Wave-10 ergonomic wrapper. The bearer-token middleware now 401s
  // every request that lacks an `Authorization` header; the test
  // suites have hundreds of `app.request(path)` calls without an
  // options object. Rather than retrofit `{ headers: env.authHeader }`
  // into every call site, we wrap `app.request` to inject the default
  // header when the caller doesn't supply one. Tests that want to
  // exercise the unauthenticated path explicitly set `Authorization:
  // ''` to opt out (or just call `deps`'s low-level Hono handle).
  const authedApp = {
    request: async (path: string, init: RequestInit = {}): Promise<Response> => {
      const headers: Record<string, string> = {};
      const provided = (init.headers ?? {}) as Record<string, string>;
      for (const [k, v] of Object.entries(provided)) {
        if (typeof v === 'string') headers[k] = v;
      }
      if (headers.Authorization === undefined && headers.authorization === undefined) {
        headers.Authorization = authHeader.Authorization;
      }
      return app.request(path, { ...init, headers });
    },
  };
  return {
    deps,
    app: authedApp as unknown as ReturnType<typeof buildApp>,
    rawApp: app,
    db,
    authHeader,
    authFor,
    tenantId: SEED_TENANT_UUID,
    token,
    signingKey,
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
  /**
   * Wave-17 — project this run is scoped to. Optional; when omitted
   * the row's project_id is inserted as SQL NULL (mirrors a pre-021
   * write path). Tests that exercise the project_id retrofit pass
   * an explicit value so the run lands in a known project.
   */
  readonly projectId?: string | null;
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
    `INSERT INTO runs (id, tenant_id, project_id, agent_name, agent_version, parent_run_id, started_at, ended_at, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      opts.id,
      // Default to the seeded tenant — the test harness binds its
      // authHeader to the same id so seeded rows are visible by
      // default. Cross-tenant tests pass an explicit `tenantId`.
      opts.tenantId ?? SEED_TENANT_UUID,
      // Wave-17 — explicit project_id when the test supplied one;
      // otherwise SQL NULL (mirrors pre-retrofit insert paths).
      opts.projectId ?? null,
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
    const tenantId = opts.tenantId ?? SEED_TENANT_UUID;
    // Wave-17 — events inherit project_id from the parent run row
    // (mirrors PostgresRunStore.appendEvent's INSERT...SELECT pattern).
    // We pass it explicitly here so the test seeder uses the same wire
    // shape the runtime would, instead of relying on a follow-up
    // backfill.
    const projectId = opts.projectId ?? null;
    for (const e of opts.events) {
      await db.query(
        `INSERT INTO run_events (id, run_id, tenant_id, project_id, type, payload_jsonb, at)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)`,
        [
          e.id,
          opts.id,
          tenantId,
          projectId,
          e.type,
          JSON.stringify(e.payload),
          e.at ?? opts.startedAt,
        ],
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

export interface SeedAgentTenantOptions extends SeedAgentOptions {
  /**
   * Tenant the agent should be registered into. Defaults to
   * `SEED_TENANT_UUID` so the harness's default `authHeader` can read
   * it back from `/v1/agents`. Cross-tenant tests pass an explicit
   * tenant id (M's `authFor()` helper synthesises the row in
   * `tenants` so the FK target exists).
   */
  readonly tenantId?: string;
}

export async function seedAgent(db: SqlClient, opts: SeedAgentTenantOptions): Promise<void> {
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
  // Legacy `agents`/`agent_versions` tables — eval gate + the
  // wave-1 list helper still read them.
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
  // Wave-10 tenant-scoped tables — `/v1/agents` reads from these.
  const tenantId = opts.tenantId ?? SEED_TENANT_UUID;
  await db.query(
    `INSERT INTO tenants (id, slug, name, created_at)
     VALUES ($1, $2, $2, now())
     ON CONFLICT (id) DO NOTHING`,
    [tenantId, tenantId === SEED_TENANT_UUID ? 'default' : `t-${tenantId.slice(0, 8)}`],
  );
  const yamlSpec = renderAgentYaml(spec, opts);
  const id = `seed-${tenantId}-${opts.name}-${opts.version}`;
  await db.query(
    `INSERT INTO registered_agents (id, tenant_id, name, version, spec_yaml, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6::timestamptz, $6::timestamptz)
     ON CONFLICT (tenant_id, name, version) DO UPDATE
       SET spec_yaml  = EXCLUDED.spec_yaml,
           updated_at = EXCLUDED.updated_at`,
    [id, tenantId, opts.name, opts.version, yamlSpec, opts.createdAt ?? new Date().toISOString()],
  );
  // Always set the pointer to this version. Wave-10 stores treat the
  // pointer as the "current" version regardless of any per-row
  // promoted flag in the legacy table.
  await db.query(
    `INSERT INTO registered_agent_pointer (tenant_id, name, current_version, updated_at)
     VALUES ($1, $2, $3, now())
     ON CONFLICT (tenant_id, name) DO UPDATE
       SET current_version = EXCLUDED.current_version,
           updated_at      = now()`,
    [tenantId, opts.name, opts.version],
  );
}

/**
 * Render a minimal-but-valid `agent.v1` YAML for the seedAgent shape.
 * Round-trips through @aldo-ai/registry's parseYaml so the wave-10
 * `RegisteredAgentStore` can re-validate at read time.
 */
function renderAgentYaml(
  spec: Record<string, unknown> & {
    identity: Record<string, unknown>;
    modelPolicy: Record<string, unknown>;
  },
  opts: SeedAgentOptions,
): string {
  const tags = opts.tags ?? [];
  const tagsLine =
    tags.length === 0 ? '  tags: []' : `  tags: [${tags.map((t) => JSON.stringify(t)).join(', ')}]`;
  const tools = (spec.tools as undefined | Record<string, unknown>) ?? undefined;
  const toolsPerm = (tools?.permissions as undefined | Record<string, string>) ?? {
    network: 'none',
    filesystem: 'none',
  };
  const guards = tools?.guards;
  const sandbox = (spec as { sandbox?: unknown }).sandbox;
  const composite = (spec as { composite?: unknown }).composite;
  const fallbacks = ((spec.modelPolicy as { fallbacks?: { capabilityClass: string }[] })
    .fallbacks ?? []) as {
    capabilityClass: string;
  }[];
  const fallbackLines =
    fallbacks.length === 0
      ? '    []'
      : fallbacks.map((f) => `    - capability_class: ${f.capabilityClass}`).join('\n');
  const reqs = ((spec.modelPolicy as { capabilityRequirements?: string[] })
    .capabilityRequirements ?? []) as string[];
  const reqLine = reqs.length === 0 ? '[]' : `[${reqs.map((r) => JSON.stringify(r)).join(', ')}]`;
  const identity = spec.identity as { description: string };
  const lines: string[] = [
    'apiVersion: aldo-ai/agent.v1',
    'kind: Agent',
    'identity:',
    `  name: ${opts.name}`,
    `  version: ${opts.version}`,
    `  description: ${JSON.stringify(identity.description)}`,
    `  owner: ${opts.owner}`,
    tagsLine,
    'role:',
    `  team: ${opts.team}`,
    '  pattern: worker',
    'model_policy:',
    `  capability_requirements: ${reqLine}`,
    `  privacy_tier: ${(spec.modelPolicy as { privacyTier: string }).privacyTier}`,
    '  primary:',
    `    capability_class: ${(spec.modelPolicy as { primary: { capabilityClass: string } }).primary.capabilityClass}`,
    '  fallbacks:',
    fallbackLines,
    '  budget:',
    '    usd_per_run: 1',
    '  decoding:',
    `    mode: ${(spec.modelPolicy as { decoding: { mode: string } }).decoding.mode}`,
    'prompt:',
    '  system_file: prompts/sample.md',
    'tools:',
    '  mcp: []',
    '  native: []',
    '  permissions:',
    `    network: ${toolsPerm.network ?? 'none'}`,
    `    filesystem: ${toolsPerm.filesystem ?? 'none'}`,
  ];
  if (guards !== undefined) {
    lines.push('  guards:');
    lines.push(...yamlBlock(guards as Record<string, unknown>, 4));
  }
  lines.push(
    'memory:',
    '  read: []',
    '  write: []',
    '  retention: {}',
    'spawn:',
    '  allowed: []',
    'escalation: []',
    'subscriptions: []',
    'eval_gate:',
    '  required_suites: []',
    '  must_pass_before_promote: false',
  );
  if (sandbox !== undefined) {
    lines.push('sandbox:');
    lines.push(...yamlBlock(sandbox as Record<string, unknown>, 2));
  }
  if (composite !== undefined) {
    lines.push('composite:');
    lines.push(...yamlBlock(composite as Record<string, unknown>, 2));
  }
  return lines.join('\n');
}

function yamlBlock(obj: Record<string, unknown>, indent: number): string[] {
  const pad = ' '.repeat(indent);
  const out: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    const key = camelToSnake(k);
    if (Array.isArray(v)) {
      if (v.length === 0) {
        out.push(`${pad}${key}: []`);
      } else if (v.every((e) => typeof e === 'string' || typeof e === 'number')) {
        out.push(`${pad}${key}: [${v.map((e) => JSON.stringify(e)).join(', ')}]`);
      } else {
        out.push(`${pad}${key}:`);
        for (const e of v) {
          if (typeof e === 'object' && e !== null) {
            out.push(`${pad}  -`);
            for (const line of yamlBlock(e as Record<string, unknown>, indent + 4)) out.push(line);
          } else {
            out.push(`${pad}  - ${JSON.stringify(e)}`);
          }
        }
      }
    } else if (typeof v === 'object' && v !== null) {
      out.push(`${pad}${key}:`);
      for (const line of yamlBlock(v as Record<string, unknown>, indent + 2)) out.push(line);
    } else if (typeof v === 'string') {
      out.push(`${pad}${key}: ${JSON.stringify(v)}`);
    } else {
      out.push(`${pad}${key}: ${String(v)}`);
    }
  }
  return out;
}

function camelToSnake(s: string): string {
  return s.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`);
}
