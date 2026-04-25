/**
 * Subscription-store tests — InMemory + Postgres parity.
 *
 * The Postgres tests run against pglite (the storage package's
 * test-driver fallback) so CI doesn't need a live Postgres. Migration
 * 008 must apply on a fresh pglite db — that's asserted in
 * @aldo-ai/storage's migrate test as well as here.
 */

import { fromDatabaseUrl, migrate } from '@aldo-ai/storage';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  InMemorySubscriptionStore,
  PostgresSubscriptionStore,
  type SubscriptionStore,
} from '../src/index.js';

const TEST_TENANT = '00000000-0000-0000-0000-000000000000';

describe.each<{
  name: string;
  build: () => Promise<{ store: SubscriptionStore; close: () => Promise<void> }>;
}>([
  {
    name: 'InMemorySubscriptionStore',
    build: async () => ({
      store: new InMemorySubscriptionStore(),
      close: async () => {
        /* noop */
      },
    }),
  },
  {
    name: 'PostgresSubscriptionStore',
    build: async () => {
      const db = await fromDatabaseUrl({ driver: 'pglite' });
      await migrate(db);
      // Make sure the FK target exists — migration 006 seeds the
      // canonical default tenant row.
      const store = new PostgresSubscriptionStore({ client: db });
      return {
        store,
        close: async () => {
          await db.close();
        },
      };
    },
  },
])('SubscriptionStore — $name', ({ build }) => {
  let store: SubscriptionStore;
  let close: () => Promise<void>;

  beforeAll(async () => {
    const built = await build();
    store = built.store;
    close = built.close;
  });

  afterAll(async () => {
    await close();
  });

  it('returns null for a tenant with no row', async () => {
    const got = await store.getByTenantId(TEST_TENANT);
    expect(got).toBeNull();
  });

  it('initTrial creates a trialing row with a future trial_end', async () => {
    const now = new Date('2026-04-25T00:00:00Z');
    const created = await store.initTrial({ tenantId: TEST_TENANT, trialDays: 14, now });
    expect(created.tenantId).toBe(TEST_TENANT);
    expect(created.plan).toBe('trial');
    expect(created.status).toBe('trialing');
    expect(created.stripeCustomerId).toBeNull();
    expect(created.trialEnd).not.toBeNull();
    if (created.trialEnd !== null) {
      const end = new Date(created.trialEnd).getTime();
      // 14 days = 14 * 86400_000 ms.
      const expected = now.getTime() + 14 * 24 * 60 * 60 * 1000;
      // Allow drift up to 1s for the SQL `now()` round-trip.
      expect(Math.abs(end - expected)).toBeLessThanOrEqual(1000);
    }
  });

  it('initTrial is idempotent — second call returns existing row', async () => {
    const second = await store.initTrial({
      tenantId: TEST_TENANT,
      trialDays: 30, // intentionally different to prove no overwrite
      now: new Date('2026-05-01T00:00:00Z'),
    });
    // Existing row stays — we don't widen the trial on retry.
    expect(second.plan).toBe('trial');
    // The trial_end MUST still reflect the original 14-day window,
    // not the 30-day retry — DO NOTHING semantics.
    if (second.trialEnd !== null) {
      const end = new Date(second.trialEnd).getTime();
      const original = new Date('2026-04-25T00:00:00Z').getTime() + 14 * 24 * 60 * 60 * 1000;
      expect(Math.abs(end - original)).toBeLessThanOrEqual(1000);
    }
  });

  it('upsertFromStripeEvent flips a trial row to active', async () => {
    const upserted = await store.upsertFromStripeEvent({
      tenantId: TEST_TENANT,
      plan: 'solo',
      status: 'active',
      stripeCustomerId: 'cus_test_x',
      stripeSubscriptionId: 'sub_test_x',
      trialEnd: null,
      currentPeriodEnd: '2026-05-25T00:00:00.000Z',
      cancelledAt: null,
      metadata: { sourceEvent: 'checkout.session.completed' },
    });
    expect(upserted.plan).toBe('solo');
    expect(upserted.status).toBe('active');
    expect(upserted.stripeCustomerId).toBe('cus_test_x');
    expect(upserted.stripeSubscriptionId).toBe('sub_test_x');
    expect(upserted.currentPeriodEnd).not.toBeNull();
    expect(upserted.metadata.sourceEvent).toBe('checkout.session.completed');
  });

  it('upsertFromStripeEvent is last-write-wins', async () => {
    await store.upsertFromStripeEvent({
      tenantId: TEST_TENANT,
      plan: 'team',
      status: 'past_due',
      stripeCustomerId: 'cus_test_x',
      stripeSubscriptionId: 'sub_test_x',
      trialEnd: null,
      currentPeriodEnd: '2026-05-25T00:00:00.000Z',
      cancelledAt: null,
    });
    const got = await store.getByTenantId(TEST_TENANT);
    expect(got?.plan).toBe('team');
    expect(got?.status).toBe('past_due');
  });

  it('setStatus flips status without touching the rest of the row', async () => {
    const before = await store.getByTenantId(TEST_TENANT);
    const after = await store.setStatus(TEST_TENANT, 'active');
    expect(after?.status).toBe('active');
    expect(after?.plan).toBe(before?.plan);
    expect(after?.stripeCustomerId).toBe(before?.stripeCustomerId);
  });

  it('setStatus with cancelled_at writes the cancellation timestamp', async () => {
    const cancelledAt = '2026-06-01T00:00:00.000Z';
    const after = await store.setStatus(TEST_TENANT, 'cancelled', { cancelledAt });
    expect(after?.status).toBe('cancelled');
    expect(after?.cancelledAt).toBe(cancelledAt);
  });

  it('setStatus on an unknown tenant returns null', async () => {
    const got = await store.setStatus('11111111-1111-1111-1111-111111111111', 'active');
    expect(got).toBeNull();
  });
});
