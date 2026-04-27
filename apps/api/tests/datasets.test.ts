/**
 * Wave-16 — `/v1/datasets/*` route tests.
 *
 * Covers CRUD on datasets and their examples, the bulk-import path
 * (JSON + CSV + dedup), and tenant isolation. Tests run against the
 * shared pglite harness from `_setup.ts`.
 */

import {
  ApiError,
  BulkCreateDatasetExamplesResponse,
  Dataset,
  DatasetExample,
  ListDatasetExamplesResponse,
  ListDatasetsResponse,
} from '@aldo-ai/api-contract';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type TestEnv, setupTestEnv } from './_setup.js';

let env: TestEnv;

beforeAll(async () => {
  env = await setupTestEnv();
});

afterAll(async () => {
  await env.teardown();
});

async function createDataset(name = 'reviewer-quality'): Promise<string> {
  const res = await env.app.request('/v1/datasets', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, description: 'smoke', tags: ['smoke'] }),
  });
  expect(res.status).toBe(201);
  const body = Dataset.parse(await res.json());
  return body.id;
}

describe('/v1/datasets — CRUD', () => {
  it('creates a dataset and lists it (tenant-scoped)', async () => {
    const id = await createDataset(`ds-create-${Date.now()}`);
    const list = await env.app.request('/v1/datasets');
    expect(list.status).toBe(200);
    const body = ListDatasetsResponse.parse(await list.json());
    expect(body.datasets.some((d) => d.id === id)).toBe(true);
  });

  it('reads a dataset by id', async () => {
    const id = await createDataset(`ds-read-${Date.now()}`);
    const res = await env.app.request(`/v1/datasets/${id}`);
    expect(res.status).toBe(200);
    const body = Dataset.parse(await res.json());
    expect(body.id).toBe(id);
    expect(body.exampleCount).toBe(0);
  });

  it('returns 404 for an unknown dataset', async () => {
    const res = await env.app.request('/v1/datasets/ds_does-not-exist');
    expect(res.status).toBe(404);
    const body = ApiError.parse(await res.json());
    expect(body.error.code).toBe('not_found');
  });

  it('rejects an invalid create body with 400 validation_error', async () => {
    const res = await env.app.request('/v1/datasets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '' }),
    });
    expect(res.status).toBe(400);
    const body = ApiError.parse(await res.json());
    expect(body.error.code).toBe('validation_error');
  });

  it('updates a dataset and surfaces the new metadata', async () => {
    const id = await createDataset(`ds-update-${Date.now()}`);
    const res = await env.app.request(`/v1/datasets/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'renamed', tags: ['renamed'] }),
    });
    expect(res.status).toBe(200);
    const body = Dataset.parse(await res.json());
    expect(body.name).toBe('renamed');
    expect(body.tags).toEqual(['renamed']);
  });

  it('deletes a dataset (cascades examples) — second DELETE returns 404', async () => {
    const id = await createDataset(`ds-delete-${Date.now()}`);
    const r1 = await env.app.request(`/v1/datasets/${id}`, { method: 'DELETE' });
    expect(r1.status).toBe(204);
    const r2 = await env.app.request(`/v1/datasets/${id}`);
    expect(r2.status).toBe(404);
  });

  it('isolates datasets across tenants', async () => {
    const id = await createDataset(`ds-iso-${Date.now()}`);
    const otherTenantHeader = await env.authFor('11111111-1111-1111-1111-111111111111');
    const res = await env.app.request(`/v1/datasets/${id}`, {
      headers: otherTenantHeader,
    });
    expect(res.status).toBe(404);
  });

  it('rejects writes from a viewer-role caller', async () => {
    // Build a viewer-role JWT for the seeded tenant by re-signing.
    const { signSessionToken } = await import('../src/auth/jwt.js');
    const token = await signSessionToken(
      { sub: 'viewer-user', tid: env.tenantId, slug: 'default', role: 'viewer' },
      env.signingKey,
    );
    // The `users` row needs to exist for `getAuth` to resolve the user.
    await env.db.query(
      `INSERT INTO users (id, email, password_hash) VALUES ($1, 'viewer@aldo.test', 'x')
       ON CONFLICT (id) DO NOTHING`,
      ['viewer-user'],
    );
    const res = await env.app.request('/v1/datasets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ name: 'forbidden' }),
    });
    expect(res.status).toBe(403);
  });
});

describe('/v1/datasets/:id/examples — single-row CRUD', () => {
  it('appends an example and lists it', async () => {
    const id = await createDataset(`ds-ex-list-${Date.now()}`);
    const ins = await env.app.request(`/v1/datasets/${id}/examples`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: 'hi', expected: 'hello', split: 'train' }),
    });
    expect(ins.status).toBe(201);
    const created = DatasetExample.parse(await ins.json());
    expect(created.split).toBe('train');

    const list = await env.app.request(`/v1/datasets/${id}/examples?limit=10`);
    expect(list.status).toBe(200);
    const body = ListDatasetExamplesResponse.parse(await list.json());
    expect(body.examples.some((e) => e.id === created.id)).toBe(true);
  });

  it('paginates with cursor + filters by split', async () => {
    const id = await createDataset(`ds-ex-page-${Date.now()}`);
    for (let i = 0; i < 5; i++) {
      const r = await env.app.request(`/v1/datasets/${id}/examples`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: `q-${i}`, expected: `a-${i}`, split: 'eval' }),
      });
      expect(r.status).toBe(201);
    }
    const page1 = await env.app.request(`/v1/datasets/${id}/examples?split=eval&limit=2`);
    expect(page1.status).toBe(200);
    const b1 = ListDatasetExamplesResponse.parse(await page1.json());
    expect(b1.examples).toHaveLength(2);
    expect(b1.nextCursor).toBeTypeOf('string');
    const page2 = await env.app.request(
      `/v1/datasets/${id}/examples?split=eval&limit=2&cursor=${encodeURIComponent(
        b1.nextCursor ?? '',
      )}`,
    );
    expect(page2.status).toBe(200);
    const b2 = ListDatasetExamplesResponse.parse(await page2.json());
    expect(b2.examples).toHaveLength(2);
    expect(b2.examples[0]?.id).not.toBe(b1.examples[0]?.id);
  });

  it('updates an example inline (sets a label)', async () => {
    const id = await createDataset(`ds-ex-update-${Date.now()}`);
    const ins = await env.app.request(`/v1/datasets/${id}/examples`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: 'q', expected: 'a' }),
    });
    const created = DatasetExample.parse(await ins.json());
    const upd = await env.app.request(`/v1/datasets/${id}/examples/${created.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label: 'good' }),
    });
    expect(upd.status).toBe(200);
    const body = DatasetExample.parse(await upd.json());
    expect(body.label).toBe('good');
  });

  it('deletes an example (subsequent DELETE 404s)', async () => {
    const id = await createDataset(`ds-ex-delete-${Date.now()}`);
    const ins = await env.app.request(`/v1/datasets/${id}/examples`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: 'q', expected: 'a' }),
    });
    const created = DatasetExample.parse(await ins.json());
    const r1 = await env.app.request(`/v1/datasets/${id}/examples/${created.id}`, {
      method: 'DELETE',
    });
    expect(r1.status).toBe(204);
    const r2 = await env.app.request(`/v1/datasets/${id}/examples/${created.id}`, {
      method: 'DELETE',
    });
    expect(r2.status).toBe(404);
  });
});

describe('/v1/datasets/:id/examples/bulk — bulk import', () => {
  it('imports JSON examples and dedups via SHA-1', async () => {
    const id = await createDataset(`ds-bulk-json-${Date.now()}`);
    const body = {
      examples: [
        { input: 'q1', expected: 'a1' },
        { input: 'q2', expected: 'a2' },
        { input: 'q1', expected: 'a1' }, // duplicate by canonical hash
      ],
    };
    const r = await env.app.request(`/v1/datasets/${id}/examples/bulk`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    expect(r.status).toBe(200);
    const result = BulkCreateDatasetExamplesResponse.parse(await r.json());
    expect(result.inserted).toBe(2);
    expect(result.skipped).toBe(1);
    expect(result.errors).toEqual([]);

    // Re-importing the SAME payload skips everything (cross-call dedup).
    const r2 = await env.app.request(`/v1/datasets/${id}/examples/bulk`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const result2 = BulkCreateDatasetExamplesResponse.parse(await r2.json());
    expect(result2.inserted).toBe(0);
    expect(result2.skipped).toBe(3);
  });

  it('imports CSV examples (header row + input/expected/label/split)', async () => {
    const id = await createDataset(`ds-bulk-csv-${Date.now()}`);
    const csv = ['input,expected,label,split', 'hi,hello,greet,train', 'bye,goodbye,,eval'].join(
      '\n',
    );
    const r = await env.app.request(`/v1/datasets/${id}/examples/bulk`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/csv' },
      body: csv,
    });
    expect(r.status).toBe(200);
    const body = BulkCreateDatasetExamplesResponse.parse(await r.json());
    expect(body.inserted).toBe(2);
    const list = await env.app.request(`/v1/datasets/${id}/examples?limit=10`);
    const lb = ListDatasetExamplesResponse.parse(await list.json());
    expect(lb.examples.find((e) => e.label === 'greet')).toBeDefined();
    expect(lb.examples.find((e) => e.split === 'eval')).toBeDefined();
  });
});
