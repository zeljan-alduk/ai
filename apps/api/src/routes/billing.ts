/**
 * `/v1/billing/*` — Stripe-backed commerce endpoints.
 *
 * Wave 11 — placeholder mode supported. Every endpoint here returns a
 * typed `not_configured` (HTTP 503) ApiError when the host has no
 * Stripe env vars set; flipping the env switches and redeploying is
 * the entire path from "placeholder" to "live".
 *
 *   POST /v1/billing/checkout      mint Checkout URL for {plan}
 *   POST /v1/billing/portal        mint Billing-Portal URL
 *   POST /v1/billing/webhook       Stripe -> us; raw-body signature
 *   GET  /v1/billing/subscription  caller's tenant subscription row
 *
 * The webhook is intentionally on the auth-middleware allow-list:
 * Stripe doesn't have a JWT. It's authenticated by HMAC over the raw
 * body (`Stripe-Signature` header) — `verifyAndParse` enforces that.
 *
 * IMPORTANT — webhook raw body. Stripe's signature verifier hashes the
 * exact bytes the request arrived with. We MUST read `c.req.raw.text()`
 * BEFORE any JSON-parsing middleware sees the request. Hono's
 * per-route handlers are last-mile, so as long as we don't `c.req.json()`
 * first the bytes survive intact.
 *
 * LLM-agnostic: nothing here references a model or provider.
 */

import type { ApiError } from '@aldo-ai/api-contract';
import {
  type BillingUsagePeriod,
  BillingUsageQuery,
  BillingUsageResponse,
  CheckoutRequest,
  CheckoutResponse,
  GetSubscriptionResponse,
  PortalRequest,
  PortalResponse,
  type Subscription as WireSubscription,
} from '@aldo-ai/api-contract';
import {
  CheckoutSessionError,
  PortalSessionError,
  type StripeWebhookEvent,
  type Subscription,
  WebhookSignatureError,
  createCheckoutSession,
  createPortalSession,
  handleEvent,
  trialDaysRemaining,
  verifyAndParse,
} from '@aldo-ai/billing';
import { Hono } from 'hono';
import { getAuth } from '../auth/middleware.js';
import type { Deps } from '../deps.js';
import { HttpError, validationError } from '../middleware/error.js';

// `ApiError` is the typed envelope every non-2xx returns. Reference it
// here so a future drift in the wire shape lights up at the call site.
void (undefined as ApiError | undefined);

/**
 * The web app's base URL used for checkout success / cancel redirects.
 * Pulled from the deploy env so test/staging/prod each get their own
 * origin without code changes. Falls back to localhost so dev works
 * out of the box.
 */
function webOrigin(deps: Deps): string {
  const fromEnv = deps.env.WEB_ORIGIN;
  if (typeof fromEnv === 'string' && fromEnv.length > 0) return fromEnv;
  return 'http://localhost:3000';
}

/**
 * Compose a redirect URL. `path` may already be absolute (Stripe
 * accepts either); we only prepend the web origin when it's a relative
 * path so callers can pass full URLs through `returnTo`.
 */
function joinUrl(origin: string, path: string): string {
  if (/^https?:\/\//.test(path)) return path;
  const sep = path.startsWith('/') ? '' : '/';
  return `${origin}${sep}${path}`;
}

export function billingRoutes(deps: Deps): Hono {
  const app = new Hono();

  // ─── POST /v1/billing/checkout ───────────────────────────────────

  app.post('/v1/billing/checkout', async (c) => {
    if (!deps.billing.configured) {
      throw notConfigured('checkout');
    }
    const auth = getAuth(c);
    const raw = await safeJson(c.req.raw);
    const parsed = CheckoutRequest.safeParse(raw);
    if (!parsed.success) {
      throw validationError('invalid checkout payload', parsed.error.issues);
    }
    const origin = webOrigin(deps);
    const successPath = parsed.data.returnTo ?? '/billing?checkout=success';
    const cancelPath = '/billing?checkout=cancel';
    // Read the existing customer id so re-checkout reuses payment
    // methods. New tenants don't have one yet — that's fine, Stripe
    // creates one as part of the checkout flow.
    const existing = await deps.subscriptionStore.getByTenantId(auth.tenantId);
    const stripeCustomerId = existing?.stripeCustomerId ?? undefined;
    let session: { url: string };
    try {
      session = await createCheckoutSession(deps.billing, {
        tenantId: auth.tenantId,
        plan: parsed.data.plan,
        successUrl: joinUrl(origin, successPath),
        cancelUrl: joinUrl(origin, cancelPath),
        ...(stripeCustomerId !== undefined ? { stripeCustomerId } : {}),
      });
    } catch (err) {
      if (err instanceof CheckoutSessionError) {
        throw new HttpError(502, 'billing_provider_error', err.message);
      }
      throw err;
    }
    const body = CheckoutResponse.parse({ url: session.url });
    return c.json(body);
  });

  // ─── POST /v1/billing/portal ─────────────────────────────────────

  app.post('/v1/billing/portal', async (c) => {
    if (!deps.billing.configured) {
      throw notConfigured('portal');
    }
    const auth = getAuth(c);
    const raw = await safeJson(c.req.raw);
    const parsed = PortalRequest.safeParse(raw);
    if (!parsed.success) {
      throw validationError('invalid portal payload', parsed.error.issues);
    }
    const subscription = await deps.subscriptionStore.getByTenantId(auth.tenantId);
    if (subscription === null || subscription.stripeCustomerId === null) {
      // No Stripe customer means the tenant has never completed
      // checkout — the portal can't open for them. Surface the same
      // 402 the trial-gate would so the UI can render an Upgrade CTA.
      throw new HttpError(
        402,
        'payment_required',
        'no Stripe customer for this tenant; complete checkout first',
        { upgradeUrl: '/billing' },
      );
    }
    const returnUrl = joinUrl(
      webOrigin(deps),
      parsed.data.returnTo ?? deps.billing.portalReturnUrl,
    );
    let session: { url: string };
    try {
      session = await createPortalSession(deps.billing, {
        stripeCustomerId: subscription.stripeCustomerId,
        returnUrl,
      });
    } catch (err) {
      if (err instanceof PortalSessionError) {
        throw new HttpError(502, 'billing_provider_error', err.message);
      }
      throw err;
    }
    const body = PortalResponse.parse({ url: session.url });
    return c.json(body);
  });

  // ─── POST /v1/billing/webhook ────────────────────────────────────
  //
  // Public — Stripe doesn't have a JWT. Authentication is HMAC over
  // the raw body. The auth-middleware allow-list MUST include this
  // path for that to work (see app.ts).

  app.post('/v1/billing/webhook', async (c) => {
    if (!deps.billing.configured) {
      throw notConfigured('webhook');
    }
    // CRITICAL: read the raw bytes BEFORE any JSON middleware sees
    // them. `c.req.raw.text()` returns the unparsed body; that's what
    // Stripe's HMAC was computed over. Hono per-route handlers don't
    // pre-parse, so as long as we don't call `c.req.json()` first the
    // body survives intact.
    const rawBody = await c.req.raw.text();
    const sig = c.req.header('Stripe-Signature') ?? c.req.header('stripe-signature');
    if (sig === undefined || sig.length === 0) {
      throw new HttpError(400, 'invalid_signature', 'missing Stripe-Signature header');
    }
    let event: StripeWebhookEvent;
    try {
      event = await verifyAndParse(deps.billing, rawBody, sig);
    } catch (err) {
      if (err instanceof WebhookSignatureError) {
        throw new HttpError(400, 'invalid_signature', err.message);
      }
      throw err;
    }
    const result = await handleEvent(event, deps.subscriptionStore);
    return c.json({ received: true, handled: result.handled, reason: result.reason });
  });

  // ─── GET /v1/billing/usage ───────────────────────────────────────
  //
  // Aggregated cost analytics. ORTHOGONAL to subscription state — runs
  // happen and accumulate usage even when Stripe isn't configured. The
  // /billing page renders these charts in placeholder mode too.
  //
  // Tenant-scoped: every aggregate is filtered by `runs.tenant_id` so
  // a tenant only sees its own spend.
  //
  // LLM-agnostic: rolls up by the opaque `model` and `agent_name`
  // strings recorded at write time; never branches on a provider enum.
  app.get('/v1/billing/usage', async (c) => {
    const auth = getAuth(c);
    const parsed = BillingUsageQuery.safeParse(
      Object.fromEntries(new URL(c.req.url).searchParams.entries()),
    );
    if (!parsed.success) {
      throw validationError('invalid usage query', parsed.error.issues);
    }
    const period: BillingUsagePeriod = parsed.data.period ?? '7d';
    const usage = await aggregateBillingUsage(deps.db, auth.tenantId, period);
    const body = BillingUsageResponse.parse(usage);
    return c.json(body);
  });

  // ─── GET /v1/billing/subscription ────────────────────────────────

  app.get('/v1/billing/subscription', async (c) => {
    const auth = getAuth(c);
    const sub = await deps.subscriptionStore.getByTenantId(auth.tenantId);
    // When no row exists for this tenant (a pre-wave-11 tenant that
    // never went through a wave-11 signup), surface a synthetic trial
    // entry so the web /billing page renders cleanly. We DON'T write
    // it back — the trial-gate is permissive for missing rows so this
    // is purely a render shape.
    const wire = sub === null ? syntheticTrialWire() : subscriptionToWire(sub);
    const body = GetSubscriptionResponse.parse({ subscription: wire });
    return c.json(body);
  });

  return app;
}

// ─────────────────────────────────────────────── helpers

/**
 * Surface the wire shape from the in-process `Subscription`. Drops the
 * Stripe-internal IDs — they're operator-only data; the browser
 * doesn't need them and shouldn't see them.
 */
function subscriptionToWire(sub: Subscription): WireSubscription {
  return {
    plan: sub.plan,
    status: sub.status,
    trialEnd: sub.trialEnd,
    currentPeriodEnd: sub.currentPeriodEnd,
    cancelledAt: sub.cancelledAt,
    trialDaysRemaining: trialDaysRemaining(sub),
  };
}

function syntheticTrialWire(): WireSubscription {
  return {
    plan: 'trial',
    status: 'trialing',
    trialEnd: null,
    currentPeriodEnd: null,
    cancelledAt: null,
    trialDaysRemaining: null,
  };
}

/** Build the typed `not_configured` HttpError (HTTP 503). */
function notConfigured(endpoint: string): HttpError {
  return new HttpError(
    503,
    'not_configured',
    `billing ${endpoint} is not configured in this environment; set STRIPE_SECRET_KEY and the STRIPE_PRICE_* env vars to enable`,
  );
}

async function safeJson(req: Request): Promise<unknown> {
  try {
    return (await req.json()) as unknown;
  } catch {
    return {};
  }
}

// ─────────────────────────────────────────────── usage aggregation

const PERIOD_TO_DAYS: Record<BillingUsagePeriod, number> = {
  '24h': 1,
  '7d': 7,
  '30d': 30,
};

interface BillingUsageAggregateRow {
  readonly bucket: string | Date;
  readonly model: string | null;
  readonly agent_name: string | null;
  readonly usd: string | number | null;
  readonly [k: string]: unknown;
}

/**
 * Pull every (model, agent, day) bucket of usage in the requested
 * window and reshape into the wire shape. Single round-trip; the
 * GROUP BY is pushed into SQL so the API never reads a bottomless
 * stream of usage_records into memory.
 *
 * IMPORTANT — the `runs r` join is what binds usage to a tenant. The
 * `usage_records` table doesn't carry tenant_id directly (FK to runs),
 * so we MUST filter on `r.tenant_id = $1` to keep cross-tenant
 * isolation tight.
 */
export async function aggregateBillingUsage(
  db: import('@aldo-ai/storage').SqlClient,
  tenantId: string,
  period: BillingUsagePeriod,
): Promise<{
  readonly period: BillingUsagePeriod;
  readonly totalUsd: number;
  readonly byDay: ReadonlyArray<{ readonly date: string; readonly usd: number }>;
  readonly byModel: ReadonlyArray<{ readonly model: string; readonly usd: number }>;
  readonly byAgent: ReadonlyArray<{ readonly agent: string; readonly usd: number }>;
  readonly monthlyProjectionUsd: number | null;
}> {
  const days = PERIOD_TO_DAYS[period];
  const now = Date.now();
  const since = new Date(now - days * 86400_000).toISOString();

  // One query per axis is simpler than one big GROUP BY GROUPING SETS
  // (pglite's planner doesn't optimise grouping sets well, and the
  // intent is clearer this way).
  const dayRes = await db.query<BillingUsageAggregateRow>(
    `SELECT
        to_char(date_trunc('day', u.at AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS bucket,
        COALESCE(SUM(u.usd), 0)::text AS usd
       FROM usage_records u
       JOIN runs r ON r.id = u.run_id
      WHERE r.tenant_id = $1
        AND u.at >= $2::timestamptz
      GROUP BY 1
      ORDER BY 1 ASC`,
    [tenantId, since],
  );

  const modelRes = await db.query<BillingUsageAggregateRow>(
    `SELECT u.model AS model, COALESCE(SUM(u.usd), 0)::text AS usd
       FROM usage_records u
       JOIN runs r ON r.id = u.run_id
      WHERE r.tenant_id = $1
        AND u.at >= $2::timestamptz
      GROUP BY u.model
      ORDER BY SUM(u.usd) DESC`,
    [tenantId, since],
  );

  const agentRes = await db.query<BillingUsageAggregateRow>(
    `SELECT r.agent_name AS agent_name, COALESCE(SUM(u.usd), 0)::text AS usd
       FROM usage_records u
       JOIN runs r ON r.id = u.run_id
      WHERE r.tenant_id = $1
        AND u.at >= $2::timestamptz
      GROUP BY r.agent_name
      ORDER BY SUM(u.usd) DESC`,
    [tenantId, since],
  );

  const byDay = dayRes.rows.map((r) => ({
    date: typeof r.bucket === 'string' ? r.bucket : new Date(r.bucket).toISOString().slice(0, 10),
    usd: Number(r.usd ?? 0),
  }));
  const byModel = modelRes.rows
    .filter((r): r is BillingUsageAggregateRow & { model: string } => typeof r.model === 'string')
    .map((r) => ({ model: r.model, usd: Number(r.usd ?? 0) }));
  const byAgent = agentRes.rows
    .filter(
      (r): r is BillingUsageAggregateRow & { agent_name: string } =>
        typeof r.agent_name === 'string',
    )
    .map((r) => ({ agent: r.agent_name, usd: Number(r.usd ?? 0) }));

  const totalUsd = byModel.reduce((acc, b) => acc + b.usd, 0);
  const monthlyProjectionUsd = projectMonthly(byDay, days);

  return {
    period,
    totalUsd,
    byDay,
    byModel,
    byAgent,
    monthlyProjectionUsd,
  };
}

/**
 * Naive linear projection: average daily spend across the observed
 * window times the number of days in the current calendar month.
 * Returns null when there's no usage history in the window — better an
 * empty card than a confidently-wrong forecast.
 */
function projectMonthly(
  byDay: ReadonlyArray<{ readonly date: string; readonly usd: number }>,
  windowDays: number,
): number | null {
  if (byDay.length === 0) return null;
  const total = byDay.reduce((acc, d) => acc + d.usd, 0);
  if (total === 0) return null;
  const perDay = total / Math.max(1, windowDays);
  const now = new Date();
  const daysInMonth = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0),
  ).getUTCDate();
  return Number((perDay * daysInMonth).toFixed(6));
}
