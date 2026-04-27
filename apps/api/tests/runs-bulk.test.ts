/**
 * `POST /v1/runs/bulk` — Wave-13 bulk-action tests.
 *
 * Covers: archive / unarchive / add-tag / remove-tag, and tenant
 * isolation — bulk action body that contains another tenant's run id
 * silently no-ops on those rows.
 */

import { ApiError, BulkRunActionResponse } from '@aldo-ai/api-contract';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type TestEnv, seedRun, setupTestEnv } from './_setup.js';

const TENANT_OTHER = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';

let env: TestEnv;

beforeAll(async () => {
  env = await setupTestEnv();
  for (const i of [1, 2, 3]) {
    await seedRun(env.db, {
      id: `bulk-${i}`,
      agentName: 'reviewer',
      startedAt: new Date(Date.UTC(2026, 3, 20 + i)).toISOString(),
      endedAt: new Date(Date.UTC(2026, 3, 20 + i, 0, 0, 30)).toISOString(),
      status: 'completed',
    });
  }
  await env.authFor(TENANT_OTHER); // synthesise the tenant row so seedRun's FK lands.
  await seedRun(env.db, {
    id: 'bulk-other',
    agentName: 'reviewer',
    tenantId: TENANT_OTHER,
    startedAt: '2026-04-26T10:00:00.000Z',
    endedAt: '2026-04-26T10:00:30.000Z',
    status: 'completed',
  });
});

afterAll(async () => {
  await env.teardown();
});

describe('POST /v1/runs/bulk', () => {
  it('archive marks the rows; idempotent re-run reports 0 affected', async () => {
    const r1 = await env.app.request('/v1/runs/bulk', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ runIds: ['bulk-1', 'bulk-2'], action: 'archive' }),
    });
    expect(r1.status).toBe(200);
    const b1 = BulkRunActionResponse.parse(await r1.json());
    expect(b1.affected).toBe(2);

    const r2 = await env.app.request('/v1/runs/bulk', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ runIds: ['bulk-1', 'bulk-2'], action: 'archive' }),
    });
    const b2 = BulkRunActionResponse.parse(await r2.json());
    expect(b2.affected).toBe(0); // already archived

    // unarchive flips them back.
    const r3 = await env.app.request('/v1/runs/bulk', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ runIds: ['bulk-1', 'bulk-2'], action: 'unarchive' }),
    });
    const b3 = BulkRunActionResponse.parse(await r3.json());
    expect(b3.affected).toBe(2);
  });

  it('add-tag attaches the tag, remove-tag removes it', async () => {
    const r1 = await env.app.request('/v1/runs/bulk', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        runIds: ['bulk-1', 'bulk-2'],
        action: 'add-tag',
        tag: 'flaky',
      }),
    });
    expect(r1.status).toBe(200);
    expect(BulkRunActionResponse.parse(await r1.json()).affected).toBe(2);

    const r2 = await env.app.request('/v1/runs/bulk', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        runIds: ['bulk-1', 'bulk-2'],
        action: 'remove-tag',
        tag: 'flaky',
      }),
    });
    expect(BulkRunActionResponse.parse(await r2.json()).affected).toBe(2);
  });

  it('rejects add-tag without tag field with 400 validation_error', async () => {
    const res = await env.app.request('/v1/runs/bulk', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ runIds: ['bulk-1'], action: 'add-tag' }),
    });
    expect(res.status).toBe(400);
    const body = ApiError.parse(await res.json());
    expect(body.error.code).toBe('validation_error');
  });

  it('cross-tenant id silently no-ops; affected only counts caller-owned rows', async () => {
    const res = await env.app.request('/v1/runs/bulk', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        runIds: ['bulk-3', 'bulk-other'],
        action: 'archive',
      }),
    });
    expect(res.status).toBe(200);
    const body = BulkRunActionResponse.parse(await res.json());
    expect(body.affected).toBe(1); // bulk-3 only
  });
});
