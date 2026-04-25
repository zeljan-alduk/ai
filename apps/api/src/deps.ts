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
 */

import { AgentRegistry, PostgresStorage } from '@aldo-ai/registry';
import { type SqlClient, fromDatabaseUrl } from '@aldo-ai/storage';
import {
  type EngineDebugger,
  type InProcessEngineDebugger,
  createInProcessEngineDebugger,
} from './routes/debugger.js';
import type { EvalDeps } from './routes/eval.js';

export interface Env {
  /** Postgres URL. Empty / unset / `pglite:` / `memory://` -> in-process pglite. */
  readonly DATABASE_URL?: string | undefined;
  /** Comma-separated extra origins allowed by CORS. */
  readonly CORS_ORIGINS?: string | undefined;
  /** Path to the gateway models YAML fixture. Defaults to the bundled path. */
  readonly MODELS_FIXTURE_PATH?: string | undefined;
  /** Server build/version label exposed by /health. */
  readonly API_VERSION?: string | undefined;
  /** Provider key + base-URL env vars. Read by the models route to stamp `available`. */
  readonly [k: string]: string | undefined;
}

export interface Deps {
  readonly db: SqlClient;
  readonly registry: AgentRegistry;
  readonly env: Env;
  readonly version: string;
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
  const deps: Deps = {
    db,
    registry,
    env,
    version,
    __defaultDebugger,
    ...(opts.engineDebugger !== undefined ? { engineDebugger: opts.engineDebugger } : {}),
    ...(opts.evalDeps !== undefined ? { evalDeps: opts.evalDeps } : {}),
    async close() {
      // If the caller supplied the db, they own its lifecycle.
      if (opts.db === undefined) await db.close();
    },
  };
  return deps;
}
