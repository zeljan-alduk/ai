/**
 * Build the Hono application for the ALDO AI control-plane API.
 *
 * Exported for tests so they can drive the server via `app.request()`
 * without opening a port. The entry point in `index.ts` wraps this with
 * `@hono/node-server` for production.
 *
 * Cross-cutting concerns wired here:
 *  - request logger (one-line per request),
 *  - CORS for the local web origin (and any extras configured via
 *    `CORS_ORIGINS`),
 *  - central error handler that emits the typed `ApiError` envelope.
 *
 * Auth is intentionally absent in v0; tenant scoping lands with the
 * orchestrator wave.
 */

// TODO(v1): require auth — every route must run through a tenant-aware
// session middleware before it can read storage.

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Deps } from './deps.js';
import { errorHandler } from './middleware/error.js';
import { logger } from './middleware/logger.js';
import { agentsRoutes } from './routes/agents.js';
import { debuggerRoutes } from './routes/debugger.js';
import { evalRoutes } from './routes/eval.js';
import { healthRoutes } from './routes/health.js';
import { modelsRoutes } from './routes/models.js';
import { runsRoutes } from './routes/runs.js';

export interface BuildAppOptions {
  /** Disable the request logger (tests pass `false`). */
  readonly log?: boolean;
}

export function buildApp(deps: Deps, opts: BuildAppOptions = {}): Hono {
  const app = new Hono();

  if (opts.log !== false) app.use('*', logger());

  const extraOrigins =
    typeof deps.env.CORS_ORIGINS === 'string' && deps.env.CORS_ORIGINS.length > 0
      ? deps.env.CORS_ORIGINS.split(',')
          .map((s) => s.trim())
          .filter((s) => s.length > 0)
      : [];
  const allowedOrigins = ['http://localhost:3000', ...extraOrigins];
  app.use(
    '*',
    cors({
      origin: (origin) => (allowedOrigins.includes(origin) ? origin : null),
      allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Authorization'],
      maxAge: 600,
    }),
  );

  app.route('/', healthRoutes(deps));
  app.route('/', runsRoutes(deps));
  app.route('/', agentsRoutes(deps));
  app.route('/', modelsRoutes(deps));
  app.route('/', debuggerRoutes(deps));
  app.route('/', evalRoutes(deps, deps.evalDeps !== undefined ? { evalDeps: deps.evalDeps } : {}));

  app.onError(errorHandler);
  app.notFound((c) =>
    c.json(
      { error: { code: 'not_found', message: `no route: ${c.req.method} ${c.req.path}` } },
      404,
    ),
  );

  return app;
}
