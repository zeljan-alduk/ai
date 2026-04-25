/**
 * Resolver tests — both forms (`secret://X` and `${secret://X}`),
 * recursive walk through arbitrary JSON-shaped values, audit logging,
 * and the unknown-secret error path.
 */

import { describe, expect, it } from 'vitest';
import {
  hasRefs,
  InMemorySecretStore,
  resolveInArgs,
  resolveRefs,
  UnknownSecretError,
} from '../src/index.js';

describe('resolveRefs', () => {
  it('substitutes plain secret://NAME', async () => {
    const store = new InMemorySecretStore();
    await store.set('t', 'API_KEY', 'sk-1234');
    const out = await resolveRefs('Bearer secret://API_KEY', store, {
      tenantId: 't',
      caller: 'reviewer',
    });
    expect(out).toBe('Bearer sk-1234');
  });

  it('substitutes interpolated ${secret://NAME}', async () => {
    const store = new InMemorySecretStore();
    await store.set('t', 'API_KEY', 'sk-1234');
    const out = await resolveRefs('Bearer ${secret://API_KEY}', store, {
      tenantId: 't',
      caller: 'reviewer',
    });
    expect(out).toBe('Bearer sk-1234');
  });

  it('substitutes multiple references in one string', async () => {
    const store = new InMemorySecretStore();
    await store.set('t', 'A', 'aa');
    await store.set('t', 'B', 'bb');
    const out = await resolveRefs('${secret://A}-secret://B-${secret://A}', store, {
      tenantId: 't',
      caller: 'reviewer',
    });
    expect(out).toBe('aa-bb-aa');
  });

  it('throws UnknownSecretError on unresolved references', async () => {
    const store = new InMemorySecretStore();
    await expect(
      resolveRefs('secret://NOPE', store, { tenantId: 't', caller: 'reviewer' }),
    ).rejects.toBeInstanceOf(UnknownSecretError);
  });

  it('writes one audit row per textual occurrence', async () => {
    const store = new InMemorySecretStore();
    await store.set('t', 'A', 'aa');
    await resolveRefs('${secret://A}-secret://A', store, {
      tenantId: 't',
      caller: 'reviewer',
      runId: 'run-1',
    });
    const rows = (await store.recentAudit?.('t', 'A', 10)) ?? [];
    expect(rows.length).toBe(2);
    for (const r of rows) {
      expect(r.caller).toBe('reviewer');
      expect(r.runId).toBe('run-1');
    }
  });

  it('returns the original string unchanged when there are no refs', async () => {
    const store = new InMemorySecretStore();
    const text = 'plain text without any references';
    expect(await resolveRefs(text, store, { tenantId: 't', caller: 'x' })).toBe(text);
  });
});

describe('resolveInArgs', () => {
  it('walks objects + arrays + strings recursively', async () => {
    const store = new InMemorySecretStore();
    await store.set('t', 'API_KEY', 'sk-zzzz');
    const args = {
      headers: { Authorization: 'Bearer ${secret://API_KEY}' },
      params: ['q', 'secret://API_KEY'],
      n: 7,
      ok: true,
      empty: null,
    };
    const resolved = (await resolveInArgs(args, store, {
      tenantId: 't',
      caller: 'reviewer',
    })) as typeof args;
    expect(resolved.headers.Authorization).toBe('Bearer sk-zzzz');
    expect(resolved.params).toEqual(['q', 'sk-zzzz']);
    expect(resolved.n).toBe(7);
    expect(resolved.ok).toBe(true);
    expect(resolved.empty).toBeNull();
  });

  it('passes non-string leaves through unchanged', async () => {
    const store = new InMemorySecretStore();
    expect(await resolveInArgs(42, store, { tenantId: 't', caller: 'x' })).toBe(42);
    expect(await resolveInArgs(null, store, { tenantId: 't', caller: 'x' })).toBeNull();
    expect(await resolveInArgs(false, store, { tenantId: 't', caller: 'x' })).toBe(false);
  });
});

describe('hasRefs', () => {
  it('detects refs nested in arbitrary structures', () => {
    expect(hasRefs('secret://A')).toBe(true);
    expect(hasRefs({ a: { b: ['x', 'secret://Y'] } })).toBe(true);
    expect(hasRefs({ a: 1, b: 'plain' })).toBe(false);
  });
});
