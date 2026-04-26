/**
 * Dependency wiring for the control-plane API.
 *
 * `createDeps()` is the single place where the process environment is read.
 * It picks the right SQL driver via `@aldo-ai/storage`'s URL-based detection
 * (pglite when DATABASE_URL is empty / `pglite:` / `memory://`, Neon HTTP
 * for `*.neon.tech`, node-postgres elsewhere) and instantiates an
 * `AgentRegistry` backed by the same client.
 *
 * Routes get a typed bag of dependencies via Hono's per-request context;
 * tests build their own `Deps` directly so they never touch a port and
 * never read environment outside the harness.
 *
 * Wave 10: deps grew a `signingKey` (32-byte HS256 secret for JWT) and
 * lost its v0 `tenantId` constant. Tenant id is now per-request, set by
 * the auth middleware on `c.var.auth.tenantId`. There is no platform
 * fallback: a route that runs without an authenticated session 401s
 * before the route body executes.
 */

import {
  type BillingConfig,
  type Mailer,
  PostgresSubscriptionStore,
  type SubscriptionStore,
  describeBillingConfig,
  loadBillingConfig,
  loadMailerFromEnv,
} from '@aldo-ai/billing';
import { IntegrationDispatcher, PostgresIntegrationStore } from '@aldo-ai/integrations';
import {
  AgentRegistry,
  PostgresRegisteredAgentStore,
  PostgresStorage,
  type RegisteredAgentStore,
} from '@aldo-ai/registry';
import { PostgresSecretStore, type SecretStore, loadMasterKeyFromEnv } from '@aldo-ai/secrets';
import { type SqlClient, fromDatabaseUrl } from '@aldo-ai/storage';
import { loadSigningKeyFromEnv } from './auth/jwt.js';
import { setIntegrationsDispatcher } from './notifications.js';
import {
  type EngineDebugger,
  type InProcessEngineDebugger,
  createInProcessEngineDebugger,
} from './routes/debugger.js';
import type { EvalDeps } from './routes/eval.js';

/**
 * Canonical "default" tenant id. Migration 006 seeds a row in `tenants`
 * with this id and `slug = 'default'`; pre-wave-10 rows whose
 * `tenant_id` was the literal string `tenant-default` get backfilled
 * to this UUID so old runs/secrets keep their FK targets.
 *
 * The constant is intentionally NOT a fallback for missing auth — every
 * route reads its tenant id from `c.var.auth.tenantId` populated by
 * the bearer-token middleware. The seed UUID is exported so test
 * harnesses can stamp it into a synthesised JWT.
 */
export const SEED_TENANT_UUID = '00000000-0000-0000-0000-000000000000';
export const SEED_TENANT_SLUG = 'default';

export interface Env {
  /** Postgres URL. Empty / unset / `pglite:` / `memory://` -> in-process pglite. */
  readonly DATABASE_URL?: string | undefined;
  /** Comma-separated extra origins allowed by CORS. */
  readonly CORS_ORIGINS?: string | undefined;
  /** Path to the gateway models YAML fixture. Defaults to the bundled path. */
  readonly MODELS_FIXTURE_PATH?: string | undefined;
  /** Server build/version label exposed by /health. */
  readonly API_VERSION?: string | undefined;
  /** When set, allow `aldo` to start without `ALDO_SECRETS_MASTER_KEY`. */
  readonly NODE_ENV?: string | undefined;
  /** 32-byte base64 master key for `@aldo-ai/secrets`. Required in prod. */
  readonly ALDO_SECRETS_MASTER_KEY?: string | undefined;
  /**
   * 32-byte base64 (or hex) HS256 signing key for session JWTs. Required
   * in production; in dev (`NODE_ENV !== 'production'`) the api boots
   * with an ephemeral key and a console warning, mirroring the wave-7
   * `ALDO_SECRETS_MASTER_KEY` pattern.
   */
  readonly ALDO_JWT_SECRET?: string | undefined;
  /**
   * Wave 11 — Stripe wiring. ALL FIVE must be set (non-empty) for the
   * billing endpoints to leave `not_configured` mode. Empty/unset
   * values make `/v1/billing/*` return HTTP 503 with code
   * `not_configured`; the trial-gate stays permissive.
   */
  readonly STRIPE_SECRET_KEY?: string | undefined;
  readonly STRIPE_WEBHOOK_SIGNING_SECRET?: string | undefined;
  readonly STRIPE_PRICE_SOLO?: string | undefined;
  readonly STRIPE_PRICE_TEAM?: string | undefined;
  readonly STRIPE_BILLING_PORTAL_RETURN_URL?: string | undefined;
  /** Provider key + base-URL env vars. Read by the models route to stamp `available`. */
  readonly [k: string]: string | undefined;
}

export interface Deps {
  readonly db: SqlClient;
  readonly registry: AgentRegistry;
  readonly env: Env;
  readonly version: string;
  /** 32-byte HS256 secret used to sign + verify session JWTs. */
  readonly signingKey: Uint8Array;
  /**
   * Default in-process debugger surface. Always present so the debugger
   * routes can boot without an explicit injection. Tests reach in via
   * `engineDebugger` to swap a stub in.
   */
  readonly __defaultDebugger: InProcessEngineDebugger;
  /**
   * Optional override of the engine debugger (used by tests to inject a
   * mock that captures calls). When undefined, `__defaultDebugger` is
   * used. Once `@aldo-ai/engine` exports the real `EngineDebugger`,
   * `index.ts` builds one and assigns it here.
   */
  readonly engineDebugger?: EngineDebugger;
  /**
   * Optional override of the eval deps (sweep store + runner + promotion
   * gate). When undefined, the eval routes build a default
   * `PostgresSweepStore` + no-op runner/gate (until @aldo-ai/eval ships).
   * Tests inject a stub through this seam.
   */
  readonly evalDeps?: EvalDeps;
  /**
   * Secrets surface — store. Empty when the host hasn't wired secrets
   * (in which case `/v1/secrets` returns 500). Tests can swap an
   * `InMemorySecretStore` in via `CreateDepsOptions.secrets`.
   *
   * The tenant id used for SecretStore reads is pulled from the
   * authenticated session per request, not from the deps bag.
   */
  readonly secrets?: { readonly store: SecretStore };
  /**
   * Wave-10 tenant-scoped registered-agent store. Backs the rewritten
   * `/v1/agents` route + `POST /v1/tenants/me/seed-default`. Wired
   * automatically when `createDeps()` runs; tests can inject an
   * in-memory implementation through `CreateDepsOptions.agentStore`.
   */
  readonly agentStore: RegisteredAgentStore;
  /**
   * Wave-11 mailer used by the design-partner program notification
   * path. Defaults to `noopMailer` (logs one stderr line per send)
   * when `MAILER_PROVIDER` is unset; tests inject a capturing stub
   * via `CreateDepsOptions.mailer`. Send failures are NEVER allowed
   * to break the API request that triggered them.
   */
  readonly mailer: Mailer;
  /**
   * Wave-11 billing config. Either `{ configured: true, ... }` (all
   * STRIPE_* env vars set) or `{ configured: false, ... }`. Routes
   * under `/v1/billing/*` switch on this; the trial-gate is
   * permissive when `configured: false`.
   */
  readonly billing: BillingConfig;
  /**
   * Wave-11 subscription store. Always present so the trial-gate
   * middleware and `/v1/billing/subscription` can read it whether or
   * not Stripe itself is configured (the trial row exists for every
   * tenant the moment they sign up).
   */
  readonly subscriptionStore: SubscriptionStore;
  /** Release the underlying SQL client. */
  close(): Promise<void>;
}

export interface CreateDepsOptions {
  /** Inject an already-built SqlClient (tests pass a pglite handle here). */
  readonly db?: SqlClient;
  /** Inject an already-built registry (tests can stub). */
  readonly registry?: AgentRegistry;
  /** Inject a custom engine debugger (tests use this to capture calls). */
  readonly engineDebugger?: EngineDebugger;
  /** Inject custom eval deps (tests use this to stub the runner / gate). */
  readonly evalDeps?: EvalDeps;
  /** Inject a `SecretStore` (tests use `InMemorySecretStore`). */
  readonly secrets?: { readonly store: SecretStore };
  /**
   * Inject a `RegisteredAgentStore` (tests use the in-memory variant
   * to assert tenant-isolation semantics without a SQL round trip).
   */
  readonly agentStore?: RegisteredAgentStore;
  /**
   * Override the JWT signing key (tests pass an explicit 32-byte
   * Uint8Array so they don't have to thread an env var through every
   * setup helper). Production callers leave this unset and let
   * `loadSigningKeyFromEnv` resolve it.
   */
  readonly signingKey?: Uint8Array;
  /**
   * Inject a mailer (tests use a capturing stub to assert the
   * design-partner notification fires). Production leaves this
   * unset and `loadMailerFromEnv` decides between `NoopMailer` and
   * (eventually) a real provider.
   */
  readonly mailer?: Mailer;
  /**
   * Override the resolved billing config (tests pass `{ configured:
   * false }` to exercise the placeholder envelope without poking
   * STRIPE_* env vars; or pass `{ configured: true, ... }` with a
   * fake Stripe client to exercise the live paths).
   */
  readonly billing?: BillingConfig;
  /** Inject a `SubscriptionStore` (tests use the in-memory variant). */
  readonly subscriptionStore?: SubscriptionStore;
}

export async function createDeps(
  env: Env = process.env,
  opts: CreateDepsOptions = {},
): Promise<Deps> {
  const db = opts.db ?? (await fromDatabaseUrl({ url: env.DATABASE_URL ?? '' }));
  const registry =
    opts.registry ?? new AgentRegistry({ storage: new PostgresStorage({ client: db }) });
  const version = env.API_VERSION ?? '0.0.0';
  const __defaultDebugger = createInProcessEngineDebugger();

  // Build the secrets store. If the caller supplies one (tests) use it
  // verbatim; otherwise resolve the master key from env and wire a
  // `PostgresSecretStore` against the same SqlClient. Production
  // enforces the env var; dev (`NODE_ENV !== 'production'`) generates
  // an ephemeral key and warns.
  const secrets = opts.secrets ?? {
    store: new PostgresSecretStore({
      client: db,
      masterKey: loadMasterKeyFromEnv({
        env,
        allowDevFallback: env.NODE_ENV !== 'production',
      }),
    }),
  };

  // JWT signing key. The brief mandates production refuses to boot
  // without ALDO_JWT_SECRET; in dev we generate ephemeral with a
  // warning. Callers can override via opts.signingKey for tests.
  const signingKey =
    opts.signingKey ??
    loadSigningKeyFromEnv({
      env,
      allowDevFallback: env.NODE_ENV !== 'production',
    }).key;

  const agentStore = opts.agentStore ?? new PostgresRegisteredAgentStore({ client: db });

  // Mailer: callers (tests) pass a capturing stub; production resolves
  // through `loadMailerFromEnv` which currently only knows about the
  // no-op (real provider lands when the inbox does).
  const mailer = opts.mailer ?? loadMailerFromEnv(env);

  // Wave-11 billing config. Resolves the STRIPE_* env vars into either
  // a fully-populated `ResolvedBillingConfig` or the typed
  // `UnconfiguredBilling` envelope. Tests can pre-stamp either shape
  // through `opts.billing`.
  const billing = opts.billing ?? loadBillingConfig(env);
  // Boot-time signal so operators can read the deploy log and confirm
  // wiring without inspecting env. Never echoes the actual values.
  // Mirrors the wave-7 `[secrets]` boot log.
  console.log(describeBillingConfig(billing));

  const subscriptionStore = opts.subscriptionStore ?? new PostgresSubscriptionStore({ client: db });

  // Wave-14C — outbound integrations dispatcher. Wired here so
  // `emitNotification` (the side-channel callable from every wave-13
  // surface) can fan events out to enabled tenant integrations
  // without threading the dispatcher through every call site. The
  // dispatcher is best-effort: a failure to load integrations or
  // dispatch one never propagates up to the caller. Keyed on the
  // SqlClient identity so a test harness that spins up multiple
  // independent Deps doesn't cross-contaminate dispatchers.
  const integrationsDispatcher = new IntegrationDispatcher({
    store: new PostgresIntegrationStore({ client: db }),
  });
  setIntegrationsDispatcher(db, integrationsDispatcher);

  const deps: Deps = {
    db,
    registry,
    env,
    version,
    signingKey,
    __defaultDebugger,
    secrets,
    agentStore,
    mailer,
    billing,
    subscriptionStore,
    ...(opts.engineDebugger !== undefined ? { engineDebugger: opts.engineDebugger } : {}),
    ...(opts.evalDeps !== undefined ? { evalDeps: opts.evalDeps } : {}),
    async close() {
      // If the caller supplied the db, they own its lifecycle.
      if (opts.db === undefined) await db.close();
    },
  };
  return deps;
}
