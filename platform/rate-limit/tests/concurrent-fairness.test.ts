/**
 * Concurrent fairness — N parallel `tryConsume` calls against the same
 * (tenant, scope) bucket cannot grant more than `capacity` allows.
 *
 * pglite is single-process WASM, so there's no "real" parallelism the
 * way a multi-Fly-machine production deploy would have — but the
 * SqlClient interleaves promises through one connection, and ON
 * CONFLICT DO UPDATE serialises the writes deterministically. The
 * test asserts the post-condition (sum of allowed === capacity), which
 * is the load-bearing guarantee.
 */

import { type SqlClient, fromDatabaseUrl, migrate } from '@aldo-ai/storage';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { tryConsume } from '../src/postgres-store.js';

const TENANT = '00000000-0000-0000-0000-000000000000';

let db: SqlClient;

beforeAll(async () => {
  db = await fromDatabaseUrl({ driver: 'pglite' });
  await migrate(db);
});

afterAll(async () => {
  await db.close();
});

describe('concurrent fairness', () => {
  it('allows exactly `capacity` parallel cost-1 calls when refill is 0', async () => {
    const scope = 'concurrent:cap-10';
    const capacity = 10;
    const attempts = 50; // 5x oversubscribed.
    const results = await Promise.all(
      Array.from({ length: attempts }, () =>
        tryConsume(db, {
          tenantId: TENANT,
          scope,
          cost: 1,
          capacity,
          refillPerSec: 0,
          now: 8_000_000,
        }),
      ),
    );
    const allowed = results.filter((r) => r.ok).length;
    const denied = results.filter((r) => !r.ok).length;
    expect(allowed).toBe(capacity);
    expect(denied).toBe(attempts - capacity);
  });

  it('denied calls all report Infinity retry-after when refill is 0', async () => {
    const scope = 'concurrent:no-refill-deny';
    const capacity = 5;
    const attempts = 20;
    const results = await Promise.all(
      Array.from({ length: attempts }, () =>
        tryConsume(db, {
          tenantId: TENANT,
          scope,
          cost: 1,
          capacity,
          refillPerSec: 0,
          now: 9_000_000,
        }),
      ),
    );
    const denied = results.filter((r) => !r.ok);
    expect(denied.length).toBe(attempts - capacity);
    for (const d of denied) {
      expect(d.retryAfterMs).toBe(Number.POSITIVE_INFINITY);
    }
  });

  it('two concurrent batches against the same bucket reconcile to a single capacity', async () => {
    const scope = 'concurrent:two-batches';
    const capacity = 8;
    const batch1 = Array.from({ length: 6 }, () =>
      tryConsume(db, {
        tenantId: TENANT,
        scope,
        cost: 1,
        capacity,
        refillPerSec: 0,
        now: 10_000_000,
      }),
    );
    const batch2 = Array.from({ length: 6 }, () =>
      tryConsume(db, {
        tenantId: TENANT,
        scope,
        cost: 1,
        capacity,
        refillPerSec: 0,
        now: 10_000_000,
      }),
    );
    const all = await Promise.all([...batch1, ...batch2]);
    const allowed = all.filter((r) => r.ok).length;
    expect(allowed).toBe(capacity);
  });
});
