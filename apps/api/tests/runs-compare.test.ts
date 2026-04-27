/**
 * Wave-13 — `/v1/runs/compare?a=&b=` tests.
 *
 *   1. Compares two valid same-tenant runs and returns the wire shape +
 *      a server-derived diff (event-count delta, model-changed flag,
 *      cost / duration / same-agent fields).
 *   2. Returns 404 when either id is missing OR belongs to another
 *      tenant — same disclosure stance as `/v1/runs/:id`.
 *   3. Refuses `a == b` with a 400 validation_error.
 *   4. Refuses missing query params with 400 validation_error.
 */

import { ApiError, RunCompareResponse } from '@aldo-ai/api-contract';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type TestEnv, seedRun, setupTestEnv } from './_setup.js';

let env: TestEnv;

beforeAll(async () => {
  env = await setupTestEnv();
  // Two completed runs in the seed tenant.
  await seedRun(env.db, {
    id: 'cmp-a',
    agentName: 'reviewer',
    agentVersion: '1.0.0',
    startedAt: '2026-04-25T10:00:00.000Z',
    endedAt: '2026-04-25T10:00:30.000Z',
    status: 'completed',
    events: [
      { id: 'a-evt-1', type: 'run.started', payload: {}, at: '2026-04-25T10:00:00.000Z' },
      {
        id: 'a-evt-2',
        type: 'run.completed',
        payload: { ok: true },
        at: '2026-04-25T10:00:30.000Z',
      },
    ],
    usage: [
      {
        provider: 'opaque-cloud',
        model: 'opaque-large',
        tokensIn: 1000,
        tokensOut: 500,
        usd: 0.05,
        at: '2026-04-25T10:00:10.000Z',
      },
    ],
  });
  await seedRun(env.db, {
    id: 'cmp-b',
    agentName: 'reviewer',
    agentVersion: '1.0.0',
    startedAt: '2026-04-26T10:00:00.000Z',
    endedAt: '2026-04-26T10:00:50.000Z',
    status: 'completed',
    events: [
      { id: 'b-evt-1', type: 'run.started', payload: {}, at: '2026-04-26T10:00:00.000Z' },
      { id: 'b-evt-2', type: 'message', payload: { foo: 1 }, at: '2026-04-26T10:00:10.000Z' },
      { id: 'b-evt-3', type: 'message', payload: { foo: 2 }, at: '2026-04-26T10:00:20.000Z' },
      {
        id: 'b-evt-4',
        type: 'run.completed',
        payload: { ok: true },
        at: '2026-04-26T10:00:50.000Z',
      },
    ],
    usage: [
      {
        provider: 'opaque-local',
        model: 'opaque-small',
        tokensIn: 800,
        tokensOut: 400,
        usd: 0.01,
        at: '2026-04-26T10:00:25.000Z',
      },
    ],
  });
});

afterAll(async () => {
  await env.teardown();
});

describe('GET /v1/runs/compare', () => {
  it('returns both runs + a server-derived diff payload', async () => {
    const res = await env.app.request('/v1/runs/compare?a=cmp-a&b=cmp-b');
    expect(res.status).toBe(200);
    const body = RunCompareResponse.parse(await res.json());
    expect(body.a.id).toBe('cmp-a');
    expect(body.b.id).toBe('cmp-b');
    expect(body.a.events.length).toBe(2);
    expect(body.b.events.length).toBe(4);
    // Diff fields.
    expect(body.diff.eventCountDiff).toBe(2);
    expect(body.diff.modelChanged).toBe(true);
    expect(body.diff.sameAgent).toBe(true);
    // costDiff = b.totalUsd - a.totalUsd = 0.01 - 0.05 = -0.04.
    expect(body.diff.costDiff).toBeCloseTo(-0.04, 6);
    // durationDiff = 50000 - 30000 = 20000.
    expect(body.diff.durationDiff).toBe(20_000);
  });

  it('returns 404 when one of the ids does not exist', async () => {
    const res = await env.app.request('/v1/runs/compare?a=cmp-a&b=does-not-exist');
    expect(res.status).toBe(404);
    const body = ApiError.parse(await res.json());
    expect(body.error.code).toBe('not_found');
  });

  it('returns 404 when an id belongs to a different tenant', async () => {
    // Seed a run under another tenant id; the default authHeader is
    // bound to SEED_TENANT_UUID, so this row should NOT be visible.
    const otherTenant = '11111111-1111-1111-1111-111111111111';
    // authFor synthesises the tenant row so the FK target exists
    // before we seed the cross-tenant run.
    await env.authFor(otherTenant);
    await seedRun(env.db, {
      id: 'cmp-other',
      tenantId: otherTenant,
      agentName: 'reviewer',
      startedAt: '2026-04-26T11:00:00.000Z',
      status: 'completed',
    });
    const res = await env.app.request('/v1/runs/compare?a=cmp-a&b=cmp-other');
    expect(res.status).toBe(404);
    const body = ApiError.parse(await res.json());
    expect(body.error.code).toBe('not_found');
  });

  it('returns 400 validation_error when a==b or query params are missing', async () => {
    const same = await env.app.request('/v1/runs/compare?a=cmp-a&b=cmp-a');
    expect(same.status).toBe(400);
    const sb = ApiError.parse(await same.json());
    expect(sb.error.code).toBe('validation_error');

    const missing = await env.app.request('/v1/runs/compare?a=cmp-a');
    expect(missing.status).toBe(400);
    const mb = ApiError.parse(await missing.json());
    expect(mb.error.code).toBe('validation_error');
  });
});
