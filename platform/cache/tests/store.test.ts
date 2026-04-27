/**
 * CacheStore — in-memory + Postgres CRUD coverage.
 *
 * The Postgres path runs against pglite + migration 017; the
 * in-memory path runs as a parallel suite to assert behaviour parity.
 */

import { type SqlClient, fromDatabaseUrl, migrate } from '@aldo-ai/storage';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type CacheStore,
  type CachedEntry,
  InMemoryCacheStore,
  PostgresCacheStore,
} from '../src/index.js';

const TENANT = '00000000-0000-0000-0000-000000000000';

function makeEntry(
  overrides: Partial<
    Omit<CachedEntry, 'createdAt' | 'hitCount' | 'costSavedUsd' | 'lastHitAt' | 'expiresAt'>
  > = {},
) {
  return {
    model: 'm-1',
    deltas: [{ textDelta: 'hello' }],
    text: 'hello',
    finishReason: 'stop' as const,
    usage: {
      provider: 'openai-compat',
      model: 'm-1',
      tokensIn: 10,
      tokensOut: 20,
      usd: 0.0123,
    },
    ...overrides,
  };
}

function suite(
  name: string,
  build: () => Promise<{ store: CacheStore; cleanup?: () => Promise<void> }>,
) {
  describe(name, () => {
    let store: CacheStore;
    let cleanup: (() => Promise<void>) | undefined;

    beforeAll(async () => {
      const built = await build();
      store = built.store;
      cleanup = built.cleanup;
    });

    afterAll(async () => {
      if (cleanup) await cleanup();
    });

    it('miss returns null', async () => {
      const got = await store.get(TENANT, 'no-such-key');
      expect(got).toBeNull();
    });

    it('set then get round-trips the entry', async () => {
      await store.set(TENANT, 'k1', makeEntry());
      const got = await store.get(TENANT, 'k1');
      expect(got).not.toBeNull();
      expect(got?.text).toBe('hello');
      expect(got?.usage.usd).toBeCloseTo(0.0123, 6);
      expect(got?.hitCount).toBe(0);
    });

    it('recordHit increments hit count + accumulates savings', async () => {
      await store.set(TENANT, 'k2', makeEntry());
      const h1 = await store.recordHit(TENANT, 'k2', 0.01);
      const h2 = await store.recordHit(TENANT, 'k2', 0.02);
      expect(h1).toBe(1);
      expect(h2).toBe(2);
      const got = await store.get(TENANT, 'k2');
      expect(got?.hitCount).toBe(2);
      expect(got?.costSavedUsd).toBeCloseTo(0.03, 6);
      expect(got?.lastHitAt).not.toBeNull();
    });

    it('recordHit on missing key returns 0', async () => {
      const out = await store.recordHit(TENANT, 'nope', 1);
      expect(out).toBe(0);
    });

    it('set with ttlSeconds expires the entry on read after TTL', async () => {
      await store.set(TENANT, 'k-ttl', makeEntry(), { ttlSeconds: 1 });
      const beforeExpiry = await store.get(TENANT, 'k-ttl');
      expect(beforeExpiry).not.toBeNull();
      // Wait for the entry to expire — TTL is 1 second.
      await new Promise((r) => setTimeout(r, 1100));
      const afterExpiry = await store.get(TENANT, 'k-ttl');
      expect(afterExpiry).toBeNull();
    });

    it('purge by predicate removes only matching rows', async () => {
      await store.set(TENANT, 'p1', makeEntry({ model: 'gpt' }));
      await store.set(TENANT, 'p2', makeEntry({ model: 'llama' }));
      const removed = await store.purge(TENANT, (row) => row.model === 'gpt');
      expect(removed).toBe(1);
      expect(await store.get(TENANT, 'p1')).toBeNull();
      expect(await store.get(TENANT, 'p2')).not.toBeNull();
    });

    it('tenant isolation — read against a different tenant returns null', async () => {
      const otherTenant = '11111111-2222-3333-4444-555555555555';
      // For Postgres, the FK requires the row to exist; the
      // in-memory store doesn't care. We ensure isolation by
      // writing under TENANT and reading under otherTenant.
      await store.set(TENANT, 'iso-key', makeEntry());
      const cross = await store.get(otherTenant, 'iso-key');
      expect(cross).toBeNull();
    });

    it('stats aggregates hits + savings since the cutoff', async () => {
      // Reset everything for this tenant to keep arithmetic simple.
      await store.purgeAll(TENANT);
      await store.set(TENANT, 's1', makeEntry({ model: 'gpt' }));
      await store.set(TENANT, 's2', makeEntry({ model: 'gpt' }));
      await store.set(TENANT, 's3', makeEntry({ model: 'llama' }));
      await store.recordHit(TENANT, 's1', 0.05);
      await store.recordHit(TENANT, 's1', 0.05);
      await store.recordHit(TENANT, 's2', 0.1);
      await store.recordHit(TENANT, 's3', 0.2);
      const stats = await store.stats(TENANT, new Date(Date.now() - 60_000));
      expect(stats.hitCount).toBe(4);
      expect(stats.totalSavedUsd).toBeCloseTo(0.4, 5);
      const gpt = stats.byModel.find((m) => m.model === 'gpt');
      const llama = stats.byModel.find((m) => m.model === 'llama');
      expect(gpt?.hits).toBe(3);
      expect(gpt?.savedUsd).toBeCloseTo(0.2, 5);
      expect(llama?.hits).toBe(1);
      expect(llama?.savedUsd).toBeCloseTo(0.2, 5);
    });

    it('sweepExpired removes only the rows past expiry', async () => {
      await store.purgeAll(TENANT);
      // Past:
      await store.set(TENANT, 'sw-old', makeEntry(), { ttlSeconds: 1 });
      await new Promise((r) => setTimeout(r, 1100));
      // Future:
      await store.set(TENANT, 'sw-new', makeEntry(), { ttlSeconds: 60 });
      const removed = await store.sweepExpired(TENANT);
      expect(removed).toBe(1);
      expect(await store.get(TENANT, 'sw-new')).not.toBeNull();
    });

    it('purgeAll clears the tenant', async () => {
      await store.set(TENANT, 'pa-1', makeEntry());
      await store.set(TENANT, 'pa-2', makeEntry());
      const n = await store.purgeAll(TENANT);
      expect(n).toBeGreaterThanOrEqual(2);
      expect(await store.get(TENANT, 'pa-1')).toBeNull();
    });
  });
}

suite('InMemoryCacheStore', async () => ({ store: new InMemoryCacheStore() }));

suite('PostgresCacheStore', async () => {
  const db: SqlClient = await fromDatabaseUrl({ driver: 'pglite' });
  await migrate(db);
  return {
    store: new PostgresCacheStore({ client: db }),
    async cleanup() {
      await db.close();
    },
  };
});
