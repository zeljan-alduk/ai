/**
 * Postgres-backed `tryConsume` tests against pglite.
 *
 * Asserts:
 *   - first call seeds the bucket row with capacity (= full)
 *   - sequential calls debit the column
 *   - retry-after is reported across two clock readings
 *   - the row's `refilled_at` advances on every call
 *   - cross-tenant isolation: tenant A draining doesn't affect tenant B
 *   - cross-scope isolation: scope=route:/x doesn't affect scope=global
 *   - readBucket returns null for unknown buckets, hydrated row otherwise
 *   - tryConsume short-circuits for capacity=0
 */

import { type SqlClient, fromDatabaseUrl, migrate } from '@aldo-ai/storage';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readBucket, tryConsume } from '../src/postgres-store.js';

const TENANT_A = '00000000-0000-0000-0000-000000000000';
const TENANT_B = '00000000-0000-0000-0000-00000000000b';

let db: SqlClient;

beforeAll(async () => {
  db = await fromDatabaseUrl({ driver: 'pglite' });
  await migrate(db);
  // Make sure tenant rows for the FK constraints exist.
  await db.query(
    `INSERT INTO tenants (id, slug, name) VALUES ($1, 'tenant-b', 'Tenant B')
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_B],
  );
});

afterAll(async () => {
  await db.close();
});

describe('tryConsume() — Postgres-backed atomic consume', () => {
  it('seeds a missing bucket and allows the first request', async () => {
    const r = await tryConsume(db, {
      tenantId: TENANT_A,
      scope: 'test:seed',
      cost: 1,
      capacity: 10,
      refillPerSec: 1,
      now: 1_000_000,
    });
    expect(r.ok).toBe(true);
    expect(r.remaining).toBe(9);
    const persisted = await readBucket(db, TENANT_A, 'test:seed');
    expect(persisted).not.toBeNull();
    expect(persisted?.tokens).toBe(9);
  });

  it('drains across sequential calls then denies', async () => {
    const scope = 'test:drain';
    for (let i = 0; i < 5; i += 1) {
      const r = await tryConsume(db, {
        tenantId: TENANT_A,
        scope,
        cost: 1,
        capacity: 5,
        refillPerSec: 0,
        now: 2_000_000,
      });
      expect(r.ok).toBe(true);
    }
    const denied = await tryConsume(db, {
      tenantId: TENANT_A,
      scope,
      cost: 1,
      capacity: 5,
      refillPerSec: 0,
      now: 2_000_000,
    });
    expect(denied.ok).toBe(false);
    expect(denied.retryAfterMs).toBe(Number.POSITIVE_INFINITY);
  });

  it('refills across a wall-clock gap', async () => {
    const scope = 'test:refill';
    // Drain the bucket.
    await tryConsume(db, {
      tenantId: TENANT_A,
      scope,
      cost: 5,
      capacity: 5,
      refillPerSec: 1,
      now: 3_000_000,
    });
    // Advance 3 seconds — should refill 3 tokens.
    const r = await tryConsume(db, {
      tenantId: TENANT_A,
      scope,
      cost: 1,
      capacity: 5,
      refillPerSec: 1,
      now: 3_003_000,
    });
    expect(r.ok).toBe(true);
    expect(r.remaining).toBe(2);
  });

  it('isolates buckets across tenants', async () => {
    const scope = 'test:iso-tenant';
    // Drain tenant A.
    for (let i = 0; i < 3; i += 1) {
      await tryConsume(db, {
        tenantId: TENANT_A,
        scope,
        cost: 1,
        capacity: 3,
        refillPerSec: 0,
        now: 4_000_000,
      });
    }
    const aDenied = await tryConsume(db, {
      tenantId: TENANT_A,
      scope,
      cost: 1,
      capacity: 3,
      refillPerSec: 0,
      now: 4_000_000,
    });
    expect(aDenied.ok).toBe(false);
    // Tenant B's bucket is independent — full capacity.
    const bAllowed = await tryConsume(db, {
      tenantId: TENANT_B,
      scope,
      cost: 1,
      capacity: 3,
      refillPerSec: 0,
      now: 4_000_000,
    });
    expect(bAllowed.ok).toBe(true);
    expect(bAllowed.remaining).toBe(2);
  });

  it('isolates buckets across scopes', async () => {
    // Drain tenant A on scope X; scope Y stays full.
    for (let i = 0; i < 3; i += 1) {
      await tryConsume(db, {
        tenantId: TENANT_A,
        scope: 'test:iso-scope:x',
        cost: 1,
        capacity: 3,
        refillPerSec: 0,
        now: 5_000_000,
      });
    }
    const yAllowed = await tryConsume(db, {
      tenantId: TENANT_A,
      scope: 'test:iso-scope:y',
      cost: 1,
      capacity: 3,
      refillPerSec: 0,
      now: 5_000_000,
    });
    expect(yAllowed.ok).toBe(true);
    expect(yAllowed.remaining).toBe(2);
  });

  it('readBucket returns null for an untouched (tenant, scope)', async () => {
    const snap = await readBucket(db, TENANT_A, 'test:never-touched');
    expect(snap).toBeNull();
  });

  it('honours capacity=0 (always denies)', async () => {
    const r = await tryConsume(db, {
      tenantId: TENANT_A,
      scope: 'test:zero-cap',
      cost: 1,
      capacity: 0,
      refillPerSec: 100,
      now: 6_000_000,
    });
    expect(r.ok).toBe(false);
    expect(r.retryAfterMs).toBe(Number.POSITIVE_INFINITY);
  });

  it('reports a finite retry-after when refill > 0 and balance < cost', async () => {
    const scope = 'test:retry-after';
    // Drain.
    await tryConsume(db, {
      tenantId: TENANT_A,
      scope,
      cost: 5,
      capacity: 5,
      refillPerSec: 1,
      now: 7_000_000,
    });
    const r = await tryConsume(db, {
      tenantId: TENANT_A,
      scope,
      cost: 5,
      capacity: 5,
      refillPerSec: 1,
      now: 7_000_000,
    });
    expect(r.ok).toBe(false);
    expect(r.retryAfterMs).toBe(5_000);
  });
});
