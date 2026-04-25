/**
 * SubscriptionStore — tenant-scoped CRUD for `subscriptions` (mig 008).
 *
 * Two implementations:
 *
 *   * `InMemorySubscriptionStore` — used by the billing tests and by
 *     hosts that want to exercise the trial-gate without a database
 *     (CLI, smoke tests).
 *
 *   * `PostgresSubscriptionStore` — backs the live API. Reads/writes
 *     the `subscriptions` table 1:1; every webhook event hits exactly
 *     one row, keyed on `tenant_id`.
 *
 * The store is intentionally small — it's a typed wrapper around
 * `subscriptions`. Trial-gate logic lives in `trial-gate.ts`; webhook
 * dispatch in `webhook.ts`. This separation keeps each concern
 * unit-testable in isolation.
 *
 * Mirrors the wave-7 SecretStore pattern (interface + InMemory + Postgres).
 *
 * LLM-agnostic: nothing in this module references a model or provider.
 */

import type { SqlClient } from '@aldo-ai/storage';
import type { Plan, Subscription, SubscriptionStatus } from './types.js';

/**
 * Inputs to `upsertFromStripeEvent`. The webhook switchboard normalises
 * Stripe payloads into this shape (one shape per event family), then
 * the store writes it. Keeps the SQL layer ignorant of Stripe object
 * variants.
 */
export interface UpsertFromStripeInput {
  readonly tenantId: string;
  readonly plan: Plan;
  readonly status: SubscriptionStatus;
  readonly stripeCustomerId: string | null;
  readonly stripeSubscriptionId: string | null;
  readonly trialEnd: string | null;
  readonly currentPeriodEnd: string | null;
  readonly cancelledAt: string | null;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface SubscriptionStore {
  /** Read the row for `tenantId`. Returns null when missing. */
  getByTenantId(tenantId: string): Promise<Subscription | null>;

  /**
   * Initialize the trial row at signup time. Idempotent — `ON CONFLICT
   * DO NOTHING` semantics so a retried signup doesn't blow away an
   * already-populated row (e.g. if the user signed up again after
   * checkout completed).
   */
  initTrial(input: {
    readonly tenantId: string;
    readonly trialDays: number;
    readonly now?: Date;
  }): Promise<Subscription>;

  /**
   * Upsert by tenant_id. The webhook switchboard normalises every
   * Stripe event family into the same input shape; the store applies it
   * with last-write-wins semantics.
   */
  upsertFromStripeEvent(input: UpsertFromStripeInput): Promise<Subscription>;

  /**
   * Direct status-only mutation (used when we need to flip e.g.
   * `past_due` -> `unpaid` after a manual operator action).
   */
  setStatus(
    tenantId: string,
    status: SubscriptionStatus,
    opts?: { readonly cancelledAt?: string | null },
  ): Promise<Subscription | null>;
}

// ───────────────────────────────────────────────── InMemorySubscriptionStore

export class InMemorySubscriptionStore implements SubscriptionStore {
  private readonly rows = new Map<string, Subscription>();

  async getByTenantId(tenantId: string): Promise<Subscription | null> {
    return this.rows.get(tenantId) ?? null;
  }

  async initTrial(input: {
    readonly tenantId: string;
    readonly trialDays: number;
    readonly now?: Date;
  }): Promise<Subscription> {
    const existing = this.rows.get(input.tenantId);
    if (existing !== undefined) return existing;
    const now = (input.now ?? new Date()).toISOString();
    const trialEnd = new Date(
      (input.now ?? new Date()).getTime() + input.trialDays * 24 * 60 * 60 * 1000,
    ).toISOString();
    const row: Subscription = {
      tenantId: input.tenantId,
      plan: 'trial',
      status: 'trialing',
      stripeCustomerId: null,
      stripeSubscriptionId: null,
      trialEnd,
      currentPeriodEnd: null,
      cancelledAt: null,
      metadata: {},
      createdAt: now,
      updatedAt: now,
    };
    this.rows.set(input.tenantId, row);
    return row;
  }

  async upsertFromStripeEvent(input: UpsertFromStripeInput): Promise<Subscription> {
    const now = new Date().toISOString();
    const existing = this.rows.get(input.tenantId);
    const row: Subscription = {
      tenantId: input.tenantId,
      plan: input.plan,
      status: input.status,
      stripeCustomerId: input.stripeCustomerId,
      stripeSubscriptionId: input.stripeSubscriptionId,
      trialEnd: input.trialEnd,
      currentPeriodEnd: input.currentPeriodEnd,
      cancelledAt: input.cancelledAt,
      metadata: input.metadata ?? {},
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    this.rows.set(input.tenantId, row);
    return row;
  }

  async setStatus(
    tenantId: string,
    status: SubscriptionStatus,
    opts?: { readonly cancelledAt?: string | null },
  ): Promise<Subscription | null> {
    const existing = this.rows.get(tenantId);
    if (existing === undefined) return null;
    const next: Subscription = {
      ...existing,
      status,
      cancelledAt: opts?.cancelledAt !== undefined ? opts.cancelledAt : existing.cancelledAt,
      updatedAt: new Date().toISOString(),
    };
    this.rows.set(tenantId, next);
    return next;
  }
}

// ───────────────────────────────────────────────── PostgresSubscriptionStore

interface SubRow {
  readonly tenant_id: string;
  readonly stripe_customer_id: string | null;
  readonly stripe_subscription_id: string | null;
  readonly plan: string;
  readonly status: string;
  readonly trial_end: string | Date | null;
  readonly current_period_end: string | Date | null;
  readonly cancelled_at: string | Date | null;
  readonly metadata: unknown;
  readonly created_at: string | Date;
  readonly updated_at: string | Date;
  readonly [k: string]: unknown;
}

export class PostgresSubscriptionStore implements SubscriptionStore {
  private readonly db: SqlClient;
  constructor(opts: { readonly client: SqlClient }) {
    this.db = opts.client;
  }

  async getByTenantId(tenantId: string): Promise<Subscription | null> {
    const res = await this.db.query<SubRow>(
      `SELECT tenant_id, stripe_customer_id, stripe_subscription_id,
              plan, status, trial_end, current_period_end, cancelled_at,
              metadata, created_at, updated_at
         FROM subscriptions
        WHERE tenant_id = $1`,
      [tenantId],
    );
    const row = res.rows[0];
    return row !== undefined ? rowToSub(row) : null;
  }

  async initTrial(input: {
    readonly tenantId: string;
    readonly trialDays: number;
    readonly now?: Date;
  }): Promise<Subscription> {
    const now = input.now ?? new Date();
    const trialEnd = new Date(now.getTime() + input.trialDays * 24 * 60 * 60 * 1000);
    // ON CONFLICT DO NOTHING — the wave-10 signup transaction inserts
    // the tenant row first, then this; a retry that re-inserts an
    // already-present row is a no-op rather than an error.
    await this.db.query(
      `INSERT INTO subscriptions (tenant_id, plan, status, trial_end, created_at, updated_at)
       VALUES ($1, 'trial', 'trialing', $2, $3, $3)
       ON CONFLICT (tenant_id) DO NOTHING`,
      [input.tenantId, trialEnd.toISOString(), now.toISOString()],
    );
    const after = await this.getByTenantId(input.tenantId);
    if (after === null) {
      throw new Error(
        `subscriptions.initTrial post-condition failed: row for ${input.tenantId} not visible after insert`,
      );
    }
    return after;
  }

  async upsertFromStripeEvent(input: UpsertFromStripeInput): Promise<Subscription> {
    const metadataJson = JSON.stringify(input.metadata ?? {});
    await this.db.query(
      `INSERT INTO subscriptions (
         tenant_id, stripe_customer_id, stripe_subscription_id,
         plan, status, trial_end, current_period_end, cancelled_at,
         metadata, updated_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, now())
       ON CONFLICT (tenant_id) DO UPDATE SET
         stripe_customer_id     = EXCLUDED.stripe_customer_id,
         stripe_subscription_id = EXCLUDED.stripe_subscription_id,
         plan                   = EXCLUDED.plan,
         status                 = EXCLUDED.status,
         trial_end              = EXCLUDED.trial_end,
         current_period_end     = EXCLUDED.current_period_end,
         cancelled_at           = EXCLUDED.cancelled_at,
         metadata               = EXCLUDED.metadata,
         updated_at             = now()`,
      [
        input.tenantId,
        input.stripeCustomerId,
        input.stripeSubscriptionId,
        input.plan,
        input.status,
        input.trialEnd,
        input.currentPeriodEnd,
        input.cancelledAt,
        metadataJson,
      ],
    );
    const after = await this.getByTenantId(input.tenantId);
    if (after === null) {
      throw new Error('subscriptions.upsertFromStripeEvent post-condition failed');
    }
    return after;
  }

  async setStatus(
    tenantId: string,
    status: SubscriptionStatus,
    opts?: { readonly cancelledAt?: string | null },
  ): Promise<Subscription | null> {
    const cancelledAt = opts?.cancelledAt;
    if (cancelledAt !== undefined) {
      await this.db.query(
        `UPDATE subscriptions
            SET status = $2, cancelled_at = $3, updated_at = now()
          WHERE tenant_id = $1`,
        [tenantId, status, cancelledAt],
      );
    } else {
      await this.db.query(
        `UPDATE subscriptions
            SET status = $2, updated_at = now()
          WHERE tenant_id = $1`,
        [tenantId, status],
      );
    }
    return this.getByTenantId(tenantId);
  }
}

// ───────────────────────────────────────────────── helpers

function rowToSub(row: SubRow): Subscription {
  let metadata: Readonly<Record<string, unknown>> = {};
  if (typeof row.metadata === 'string') {
    try {
      const parsed = JSON.parse(row.metadata) as unknown;
      if (parsed !== null && typeof parsed === 'object') {
        metadata = parsed as Readonly<Record<string, unknown>>;
      }
    } catch {
      // Malformed JSON on disk — surface as empty metadata rather than
      // failing the read. The webhook handler always writes valid JSON;
      // the only path to malformed is direct DB tampering.
      metadata = {};
    }
  } else if (row.metadata !== null && typeof row.metadata === 'object') {
    metadata = row.metadata as Readonly<Record<string, unknown>>;
  }
  return {
    tenantId: row.tenant_id,
    plan: row.plan as Plan,
    status: row.status as SubscriptionStatus,
    stripeCustomerId: row.stripe_customer_id,
    stripeSubscriptionId: row.stripe_subscription_id,
    trialEnd: toIsoOrNull(row.trial_end),
    currentPeriodEnd: toIsoOrNull(row.current_period_end),
    cancelledAt: toIsoOrNull(row.cancelled_at),
    metadata,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

function toIso(v: unknown): string {
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'string') {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? v : d.toISOString();
  }
  return new Date(0).toISOString();
}

function toIsoOrNull(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  return toIso(v);
}
