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

import { ROUTE_CAPS, rateLimit, rateLimitForPlan } from '@aldo-ai/rate-limit';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { bearerAuth } from './auth/middleware.js';
import { authRoutes } from './auth/routes.js';
import { trialGate } from './auth/trial-gate.js';
import type { Deps } from './deps.js';
import { domainRewrite } from './middleware/domain-rewrite.js';
import { errorHandler } from './middleware/error.js';
import { logger } from './middleware/logger.js';
import { agentsRoutes } from './routes/agents.js';
import { alertsRoutes } from './routes/alerts.js';
import { annotationsRoutes } from './routes/annotations.js';
import { apiKeysRoutes } from './routes/api-keys.js';
import { auditRoutes } from './routes/audit.js';
import { billingRoutes } from './routes/billing.js';
import { cacheRoutes } from './routes/cache.js';
import { dashboardsRoutes } from './routes/dashboards.js';
import { datasetsRoutes } from './routes/datasets.js';
import { debuggerRoutes } from './routes/debugger.js';
import { designPartnersRoutes } from './routes/design-partners.js';
import { domainsRoutes } from './routes/domains.js';
import { evalPlaygroundRoutes } from './routes/eval-playground.js';
import { evalRoutes } from './routes/eval.js';
import { evaluatorsRoutes } from './routes/evaluators.js';
import { galleryRoutes } from './routes/gallery.js';
import { healthRoutes } from './routes/health.js';
import { integrationsGitRoutes } from './routes/integrations-git.js';
import { integrationsRoutes } from './routes/integrations.js';
import { invitationsRoutes } from './routes/invitations.js';
import { membersRoutes } from './routes/members.js';
import { modelsRoutes } from './routes/models.js';
import { newsletterRoutes } from './routes/newsletter.js';
import { notificationsRoutes } from './routes/notifications.js';
import { observabilityRoutes } from './routes/observability.js';
import { openApiRoutes } from './routes/openapi.js';
import { assistantRoutes } from './routes/assistant.js';
import { playgroundRoutes } from './routes/playground.js';
import { projectsRoutes } from './routes/projects.js';
import { createGatewayPromptRunner } from './lib/gateway-prompt-runner.js';
import { promptsRoutes } from './routes/prompts.js';
import { quotasRoutes } from './routes/quotas.js';
import { runsCompareRoutes } from './routes/runs-compare.js';
import { runsRoutes } from './routes/runs.js';
import { secretsRoutes } from './routes/secrets.js';
import { sharesRoutes } from './routes/shares.js';
import { spendRoutes } from './routes/spend.js';
import { tenantsRoutes } from './routes/tenants.js';
import { threadsRoutes } from './routes/threads.js';
import { viewsRoutes } from './routes/views.js';

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

  // Wave-16 — custom-domain rewrite. Runs BEFORE auth so the
  // bearer-token middleware can match a JWT/api-key against the
  // domain-resolved tenant id. Best-effort; no-op for the platform
  // default origin.
  app.use('*', domainRewrite(deps.db));

  // Bearer-token middleware. Runs on every request, but skips the
  // public allow-list (health + signup/login + OPTIONS). Stamps
  // `c.var.auth` for downstream routes.
  app.use('*', bearerAuth(deps.signingKey, deps.db));

  // Wave-16 — distributed rate-limit. Runs AFTER auth so we have a
  // tenant id to key the bucket on. Per-plan caps are pulled from
  // the wave-11 subscription table on every request (no in-process
  // cache — a plan upgrade takes effect on the next call).
  //
  // The brief carves out three rate-limit scopes:
  //   1. global per-tenant cap (60/600/6000/unlimited per plan)
  //   2. per-route caps for hot endpoints (POST /v1/runs, playground)
  //   3. brute-force slow-down on /v1/auth/{signup,login} keyed on IP
  //
  // We apply them in cascade: every authenticated request hits (1);
  // routes in (2) ALSO hit a stricter per-route bucket. The auth
  // brute-force caps run BEFORE bearerAuth (those endpoints are on
  // the public allow-list) — we mount them with `app.use('/v1/auth/...')`.
  //
  // Test escape hatch: setting `ALDO_RATE_LIMIT_DISABLED=1` in env
  // disables every rate-limit middleware. The shared test harness
  // sets this so the existing 280+ tests don't have to be rewritten
  // to handle 429s — the rate-limit logic itself is exercised by
  // the dedicated tests in `tests/rate-limit.test.ts`.
  const rateLimitDisabled = deps.env.ALDO_RATE_LIMIT_DISABLED === '1';
  if (!rateLimitDisabled) {
    app.use(
      '/v1/auth/signup',
      rateLimit({
        db: () => deps.db,
        tenantId: (c) => extractIp(c) ?? 'anon',
        scope: () => 'route:/v1/auth/signup',
        capacity: ROUTE_CAPS['route:/v1/auth/signup']?.capacity ?? 10,
        refillPerSec: ROUTE_CAPS['route:/v1/auth/signup']?.refillPerSec ?? 10 / 60,
      }),
    );
    app.use(
      '/v1/auth/login',
      rateLimit({
        db: () => deps.db,
        tenantId: (c) => extractIp(c) ?? 'anon',
        scope: () => 'route:/v1/auth/login',
        capacity: ROUTE_CAPS['route:/v1/auth/login']?.capacity ?? 10,
        refillPerSec: ROUTE_CAPS['route:/v1/auth/login']?.refillPerSec ?? 10 / 60,
      }),
    );
    app.use('/v1/*', async (c, next) => {
      // Skip the auth endpoints (already covered above) and the
      // public surfaces. Pull tenant from auth context if available.
      // biome-ignore lint/suspicious/noExplicitAny: untyped Hono variable
      const auth = (c as any).get('auth') as { tenantId?: string } | undefined;
      if (auth === undefined || typeof auth.tenantId !== 'string') {
        await next();
        return;
      }
      const policy = await resolveRateLimitPolicy(deps, auth.tenantId);
      if (policy.capacity === null || policy.refillPerSec === null) {
        // Enterprise — unlimited.
        await next();
        return;
      }
      const handler = rateLimit({
        db: () => deps.db,
        tenantId: () => auth.tenantId ?? 'anon',
        scope: () => 'global',
        capacity: policy.capacity,
        refillPerSec: policy.refillPerSec,
      });
      return handler(c, next);
    });
    // Per-route stricter caps. Apply AFTER the global cap so a denied
    // global request 429s without ever booting the per-route check.
    app.use('/v1/runs', async (c, next) => {
      if (c.req.method !== 'POST') return next();
      // biome-ignore lint/suspicious/noExplicitAny: untyped Hono variable
      const auth = (c as any).get('auth') as { tenantId?: string } | undefined;
      if (auth === undefined || typeof auth.tenantId !== 'string') return next();
      const handler = rateLimit({
        db: () => deps.db,
        tenantId: () => auth.tenantId ?? 'anon',
        scope: () => 'route:/v1/runs',
        capacity: 30,
        refillPerSec: 30 / 60,
      });
      return handler(c, next);
    });
    app.use('/v1/playground/run', async (c, next) => {
      // biome-ignore lint/suspicious/noExplicitAny: untyped Hono variable
      const auth = (c as any).get('auth') as { tenantId?: string } | undefined;
      if (auth === undefined || typeof auth.tenantId !== 'string') return next();
      const handler = rateLimit({
        db: () => deps.db,
        tenantId: () => auth.tenantId ?? 'anon',
        scope: () => 'route:/v1/playground/run',
        capacity: ROUTE_CAPS['route:/v1/playground/run']?.capacity ?? 30,
        refillPerSec: ROUTE_CAPS['route:/v1/playground/run']?.refillPerSec ?? 30 / 60,
      });
      return handler(c, next);
    });
  } // end !rateLimitDisabled wiring

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
  // Wave 15: machine-readable spec endpoints (`/openapi.json` +
  // `/openapi.yaml`). Public per the auth allow-list; cacheable.
  app.route('/', openApiRoutes(deps));
  app.route('/', authRoutes({ db: deps.db, signingKey: deps.signingKey }));
  // Wave-13 — register the compare route BEFORE the generic /v1/runs/:id
  // matcher in `runsRoutes` so Hono picks the more specific path first.
  app.route('/', runsCompareRoutes(deps));
  app.route('/', runsRoutes(deps));
  // Wave-13 — multi-model prompt playground (SSE).
  app.route('/', playgroundRoutes(deps));
  // Assistant MVP — single-model SSE chat. Off by default; opt-in via
  // ASSISTANT_ENABLED env. Tool support arrives with IterativeAgentRun
  // (MISSING_PIECES.md #1).
  app.route('/', assistantRoutes(deps));
  app.route('/', agentsRoutes(deps));
  app.route('/', modelsRoutes(deps));
  app.route('/', observabilityRoutes(deps));
  // Wave-4 — cost + spend analytics: totals + cards + timeseries +
  // breakdowns by capability/agent/project. Backs `/observability/spend`.
  app.route('/', spendRoutes(deps));
  app.route('/', debuggerRoutes(deps));
  app.route('/', evalRoutes(deps, deps.evalDeps !== undefined ? { evalDeps: deps.evalDeps } : {}));
  // Wave-3 (Tier-3.1) — eval scorer playground. Closes the Braintrust
  // playground / LangSmith evaluators-as-product gap. Pick one
  // evaluator + one dataset, watch per-row scores stream alongside
  // aggregate stats. Re-uses the existing evaluator runner.
  app.route('/', evalPlaygroundRoutes(deps));
  app.route('/', secretsRoutes(deps));
  app.route('/', tenantsRoutes(deps));
  // Wave-3 — per-template gallery fork (companion to seed-default).
  app.route('/', galleryRoutes(deps));
  app.route('/', designPartnersRoutes(deps));
  app.route('/', billingRoutes(deps));
  app.route('/', viewsRoutes(deps));
  // Wave-13 — notifications + activity feed + SSE live tail.
  app.route('/', notificationsRoutes(deps));
  // Wave-13 — admin surfaces: api-keys, invitations, members, audit.
  app.route('/', apiKeysRoutes(deps));
  app.route('/', invitationsRoutes(deps));
  app.route('/', membersRoutes(deps));
  app.route('/', auditRoutes(deps));
  // Wave-14 — dashboards + alerts.
  app.route('/', dashboardsRoutes(deps));
  app.route('/', alertsRoutes(deps));
  // Wave-14 — annotations (threaded comments) + share links (public,
  // password-gated read-only handles for runs / sweeps / agents).
  app.route('/', annotationsRoutes(deps));
  app.route('/', sharesRoutes(deps));
  // Wave-14C — outbound integrations (Slack/GitHub/Discord/webhook) +
  // their dispatcher hooked into the notification sink.
  app.route('/', integrationsRoutes(deps));
  // Wave-18 (Tier 3.5) — Git integration: read-only sync of agent specs
  // from a customer GitHub/GitLab repo into the registry. The webhook
  // path under /v1/webhooks/git/ is on the auth allow-list.
  app.route('/', integrationsGitRoutes(deps));
  // Wave-16 — datasets (tenant-scoped collections of input/expected
  // examples) + custom evaluators (built-in + llm_judge).
  app.route('/', datasetsRoutes(deps));
  app.route('/', evaluatorsRoutes(deps, deps.judge !== undefined ? { judge: deps.judge } : {}));
  // Wave-16C — LLM-response cache stats + purge + per-tenant policy.
  app.route('/', cacheRoutes(deps));
  // Wave-16D — per-tenant monthly quota snapshot + custom domain CRUD.
  app.route('/', quotasRoutes(deps));
  app.route('/', domainsRoutes(deps));
  // Wave-17 — projects (entity foundation; agents/runs/datasets not
  // yet scoped by project_id — that's the follow-up retrofit).
  app.route('/', projectsRoutes(deps));
  // Wave-19 — threads (chat-style multi-run grouping over runs.thread_id).
  app.route('/', threadsRoutes(deps));
  // Wave-4 (Tier-4) — prompts as first-class entities. Closes Vellum
  // (entire product) + LangSmith Hub. Versioned prompt bodies, diff,
  // playground; agent specs gain an additive `promptRef` slot.
  // MISSING_PIECES.md #5 — wire the real gateway behind /v1/prompts/:id/test.
  // The runner falls back to a deterministic echo when no providers are
  // wired (dev / test harness), so the existing prompts test surface
  // keeps passing without code changes.
  app.route('/', promptsRoutes(deps, { runner: createGatewayPromptRunner(deps) }));
  // Wave-iter-3 — public newsletter capture. POST is on the
  // bearer-auth allow-list (`apps/api/src/auth/middleware.ts`).
  app.route('/', newsletterRoutes(deps));

  app.onError(errorHandler);
  app.notFound((c) =>
    c.json(
      { error: { code: 'not_found', message: `no route: ${c.req.method} ${c.req.path}` } },
      404,
    ),
  );

  return app;
}

/**
 * Best-effort client IP extraction. Reads the standard proxy headers
 * (Fly forwards `Fly-Client-IP`, every other proxy uses
 * `X-Forwarded-For`); falls back to a stable string so unknown
 * sources still get rate-limited as a single bucket.
 */
function extractIp(c: import('hono').Context): string | null {
  const fly = c.req.header('fly-client-ip');
  if (typeof fly === 'string' && fly.length > 0) return fly;
  const xff = c.req.header('x-forwarded-for');
  if (typeof xff === 'string' && xff.length > 0) {
    return xff.split(',')[0]?.trim() ?? null;
  }
  return null;
}

/**
 * Resolve the per-plan rate-limit policy for a tenant. Reads the
 * subscription row to pick the plan; falls back to `trial`.
 *
 * Wave-16: this is hit on EVERY request, so we keep it deliberately
 * cheap — one indexed SELECT against the subscriptions table.
 */
async function resolveRateLimitPolicy(
  deps: Deps,
  tenantId: string,
): Promise<{ capacity: number | null; refillPerSec: number | null }> {
  let plan: string | null = null;
  try {
    const sub = await deps.subscriptionStore.getByTenantId(tenantId);
    plan = sub?.plan ?? null;
  } catch {
    plan = null;
  }
  return rateLimitForPlan(plan);
}
