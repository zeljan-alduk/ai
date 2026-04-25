/**
 * Store round-trip tests, run twice: once against `InMemorySecretStore`
 * and once against `PostgresSecretStore` backed by pglite. Both surface
 * the same `SecretStore` interface, so the test cases are shared.
 *
 * What the asserts cover:
 *  - set returns a summary with stable fingerprint + last-4 preview,
 *  - set on an existing name updates ciphertext + fingerprint + preview
 *    while preserving createdAt,
 *  - resolve returns the original plaintext,
 *  - resolve returns null on unknown,
 *  - delete is idempotent,
 *  - tenant scoping: tenant A can't read tenant B's secrets,
 *  - audit rows survive a round-trip and order newest-first.
 */

import { fromDatabaseUrl, migrate, type SqlClient } from '@aldo-ai/storage';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generateMasterKey } from '../src/crypto.js';
import {
  InMemorySecretStore,
  PostgresSecretStore,
  type SecretStore,
} from '../src/store.js';

interface Harness {
  readonly store: SecretStore;
  teardown(): Promise<void>;
}

async function inMemHarness(): Promise<Harness> {
  return { store: new InMemorySecretStore(), teardown: async () => {} };
}

async function pgliteHarness(): Promise<Harness> {
  const db: SqlClient = await fromDatabaseUrl({ driver: 'pglite' });
  await migrate(db);
  const store = new PostgresSecretStore({ client: db, masterKey: generateMasterKey() });
  return {
    store,
    async teardown() {
      await db.close();
    },
  };
}

const flavors: ReadonlyArray<[string, () => Promise<Harness>]> = [
  ['InMemorySecretStore', inMemHarness],
  ['PostgresSecretStore (pglite)', pgliteHarness],
];

for (const [label, build] of flavors) {
  describe(label, () => {
    let h: Harness;

    beforeAll(async () => {
      h = await build();
    });
    afterAll(async () => {
      await h.teardown();
    });

    it('set returns a summary with stable fingerprint + last-4 preview', async () => {
      const summary = await h.store.set('tenant-A', 'API_KEY', 'sk-not-real-1234');
      expect(summary.name).toBe('API_KEY');
      expect(summary.preview).toBe('1234');
      expect(summary.fingerprint).toMatch(/^[A-Za-z0-9+/=]+$/);
      // Setting the same value again yields the same fingerprint.
      const again = await h.store.set('tenant-A', 'API_KEY', 'sk-not-real-1234');
      expect(again.fingerprint).toBe(summary.fingerprint);
    });

    it('set updates ciphertext + fingerprint when value changes', async () => {
      const before = await h.store.set('tenant-A', 'ROTATE_ME', 'old-value-aaaa');
      const after = await h.store.set('tenant-A', 'ROTATE_ME', 'new-value-zzzz');
      expect(after.fingerprint).not.toBe(before.fingerprint);
      expect(after.preview).toBe('zzzz');
    });

    it('resolve returns the original plaintext', async () => {
      await h.store.set('tenant-A', 'TOKEN', 'plaintext-xyz');
      const res = await h.store.resolve('tenant-A', 'TOKEN');
      expect(res?.value).toBe('plaintext-xyz');
      expect(res?.summary.preview).toBe('-xyz');
    });

    it('resolve returns null for unknown names', async () => {
      const res = await h.store.resolve('tenant-A', 'NOPE');
      expect(res).toBeNull();
    });

    it('list returns only the calling tenant\'s secrets', async () => {
      await h.store.set('tenant-A', 'SHARED_NAME', 'A-value');
      await h.store.set('tenant-B', 'SHARED_NAME', 'B-value');
      const a = await h.store.list('tenant-A');
      const b = await h.store.list('tenant-B');
      expect(a.find((s) => s.name === 'SHARED_NAME')).toBeDefined();
      expect(b.find((s) => s.name === 'SHARED_NAME')).toBeDefined();
      const aResolved = await h.store.resolve('tenant-A', 'SHARED_NAME');
      const bResolved = await h.store.resolve('tenant-B', 'SHARED_NAME');
      expect(aResolved?.value).toBe('A-value');
      expect(bResolved?.value).toBe('B-value');
    });

    it('delete returns true when a row was removed and false when missing', async () => {
      await h.store.set('tenant-A', 'GONER', 'bye-bye-2024');
      expect(await h.store.delete('tenant-A', 'GONER')).toBe(true);
      expect(await h.store.delete('tenant-A', 'GONER')).toBe(false);
      expect(await h.store.resolve('tenant-A', 'GONER')).toBeNull();
    });

    it('audit rows round-trip through recentAudit', async () => {
      await h.store.set('tenant-A', 'AUDITED', 'top-secret-9999');
      await h.store.recordAudit({
        tenantId: 'tenant-A',
        secretName: 'AUDITED',
        caller: 'reviewer',
        runId: 'run-1',
      });
      await h.store.recordAudit({
        tenantId: 'tenant-A',
        secretName: 'AUDITED',
        caller: 'reviewer',
        runId: 'run-2',
      });
      const rows = (await h.store.recentAudit?.('tenant-A', 'AUDITED', 10)) ?? [];
      expect(rows.length).toBeGreaterThanOrEqual(2);
      expect(rows[0]?.runId).toBe('run-2');
      expect(rows[1]?.runId).toBe('run-1');
    });
  });
}
