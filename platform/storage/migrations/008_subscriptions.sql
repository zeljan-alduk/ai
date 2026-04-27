-- Wave 11 — Stripe-backed subscriptions (placeholder mode supported).
--
-- One row per tenant, written:
--   * implicitly at signup (the auth-routes signup transaction now also
--     inserts the matching subscriptions row with plan='trial' and
--     status='trialing', trial_end = now() + 14 days), so every tenant
--     starts a 14-day trial without operator intervention,
--   * on every Stripe webhook (`checkout.session.completed`,
--     `customer.subscription.{created,updated,deleted}`,
--     `invoice.payment_failed`) — the @aldo-ai/billing webhook switchboard
--     upserts the row by stripe_subscription_id keyed on tenant_id.
--
-- `tenant_id` is the primary key — there is exactly one billing
-- relationship per tenant. Multi-seat / per-user billing isn't part of
-- the MVP; if we ever need it, it will be a separate `seats` table that
-- references this row.
--
-- Plan + status mirror Stripe's subscription model with two MVP-only
-- additions:
--   * plan='trial' (no Stripe row yet — trial is enforced application
--     side until checkout completes) and plan='cancelled' (terminal).
--   * status='trialing' tracks the local trial; once Stripe activates a
--     subscription the status flips to 'active' (or 'past_due', etc).
--
-- Idempotency: the trial-bootstrap insert at signup is `ON CONFLICT
-- (tenant_id) DO NOTHING` so a partial signup retry doesn't double-insert.
-- The webhook upserts use ON CONFLICT (tenant_id) DO UPDATE so a
-- re-delivery is a no-op once the row reflects the same Stripe event.
--
-- LLM-agnostic: nothing here references a model, provider, or token
-- count. The subscription row exists strictly for billing-tier gating;
-- usage metering lives elsewhere.

CREATE TABLE IF NOT EXISTS subscriptions (
  tenant_id              TEXT PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  stripe_customer_id     TEXT,
  stripe_subscription_id TEXT,
  -- 'trial' | 'solo' | 'team' | 'enterprise' | 'cancelled'
  plan                   TEXT NOT NULL DEFAULT 'trial',
  -- 'trialing' | 'active' | 'past_due' | 'cancelled' | 'unpaid' | 'incomplete'
  status                 TEXT NOT NULL DEFAULT 'trialing',
  trial_end              TIMESTAMPTZ,
  current_period_end     TIMESTAMPTZ,
  cancelled_at           TIMESTAMPTZ,
  metadata               JSONB DEFAULT '{}'::jsonb,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_status
  ON subscriptions (status);

CREATE INDEX IF NOT EXISTS idx_subscriptions_stripe_customer
  ON subscriptions (stripe_customer_id);
