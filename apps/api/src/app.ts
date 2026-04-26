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
 *  - bearer-token auth (HS256 JWT) — validates Authorization on every
 *    request EXCEPT the public allow-list (`/health`, `/v1/auth/signup`,
 *    `/v1/auth/login`, OPTIONS preflights),
 *  - central error handler that emits the typed `ApiError` envelope.
 *
 * Order matters: cors must run before auth so OPTIONS preflights
 * skip auth via the allow-list.
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { bearerAuth } from './auth/middleware.js';
import { authRoutes } from './auth/routes.js';
import { trialGate } from './auth/trial-gate.js';
import type { Deps } from './deps.js';
import { errorHandler } from './middleware/error.js';
import { logger } from './middleware/logger.js';
import { agentsRoutes } from './routes/agents.js';
import { billingRoutes } from './routes/billing.js';
import { debuggerRoutes } from './routes/debugger.js';
import { designPartnersRoutes } from './routes/design-partners.js';
import { evalRoutes } from './routes/eval.js';
import { healthRoutes } from './routes/health.js';
import { modelsRoutes } from './routes/models.js';
import { observabilityRoutes } from './routes/observability.js';
import { runsRoutes } from './routes/runs.js';
import { secretsRoutes } from './routes/secrets.js';
import { tenantsRoutes } from './routes/tenants.js';

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

  // Bearer-token middleware. Runs on every request, but skips the
  // public allow-list (health + signup/login + OPTIONS). Stamps
  // `c.var.auth` for downstream routes.
  app.use('*', bearerAuth(deps.signingKey));

  // Wave 11 — trial gate on the mutating routes that COST money to
  // run later. Permissive when billing is `not_configured`, when the
  // subscription row is missing, or when the trial is still active.
  // Read paths are NOT gated. Mounted BEFORE the route handlers so a
  // gate-block fires before any request body is processed.
  const gate = trialGate(deps);
  app.use('/v1/runs', async (c, next) => {
    if (c.req.method === 'POST') return gate(c, next);
    await next();
  });
  app.use('/v1/agents/:name/check', async (c, next) => {
    if (c.req.method === 'POST') return gate(c, next);
    await next();
  });

  app.route('/', healthRoutes(deps));
  app.route('/', authRoutes({ db: deps.db, signingKey: deps.signingKey }));
  app.route('/', runsRoutes(deps));
  app.route('/', agentsRoutes(deps));
  app.route('/', modelsRoutes(deps));
  app.route('/', observabilityRoutes(deps));
  app.route('/', debuggerRoutes(deps));
  app.route('/', evalRoutes(deps, deps.evalDeps !== undefined ? { evalDeps: deps.evalDeps } : {}));
  app.route('/', secretsRoutes(deps));
  app.route('/', tenantsRoutes(deps));
  app.route('/', designPartnersRoutes(deps));
  app.route('/', billingRoutes(deps));

  app.onError(errorHandler);
  app.notFound((c) =>
    c.json(
      { error: { code: 'not_found', message: `no route: ${c.req.method} ${c.req.path}` } },
      404,
    ),
  );

  return app;
}
