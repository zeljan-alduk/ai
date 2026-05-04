/**
 * MISSING_PIECES #9 — API plumbing for approve/reject routes.
 *
 * The engine-level integration tests in
 * `platform/engine/tests/approval-controller.test.ts` already prove
 * the controller mechanics end-to-end. This suite asserts the API
 * surface boundaries:
 *
 *   - GET  /v1/runs/:id/approvals       returns an empty list when no
 *                                       approvals are pending.
 *   - POST /v1/runs/:id/approve         400 on bad body / missing
 *                                       callId; 404 when nothing is
 *                                       pending for the supplied
 *                                       (runId, callId).
 *   - POST /v1/runs/:id/reject          requires `reason` — empty body
 *                                       and missing-reason flow to 400.
 *
 * Authn + scope enforcement is delegated to the existing middleware
 * (covered by other test files); these tests piggyback on the default
 * authHeader from setupTestEnv.
 */

import { ApiError, ListPendingApprovalsResponse } from '@aldo-ai/api-contract';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type TestEnv, setupTestEnv } from './_setup.js';

let env: TestEnv;

beforeAll(async () => {
  env = await setupTestEnv();
});

afterAll(async () => {
  await env.teardown();
});

describe('GET /v1/runs/:id/approvals', () => {
  it('returns an empty approvals list when nothing is pending', async () => {
    const res = await env.app.request('/v1/runs/non-existent/approvals');
    expect(res.status).toBe(200);
    const body = ListPendingApprovalsResponse.parse(await res.json());
    expect(body.approvals).toEqual([]);
  });
});

describe('POST /v1/runs/:id/approve', () => {
  it('rejects a malformed body with 400 validation_error', async () => {
    const res = await env.app.request('/v1/runs/r1/approve', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'not-json',
    });
    expect(res.status).toBe(400);
    const body = ApiError.parse(await res.json());
    expect(body.error.code).toBe('validation_error');
  });

  it('rejects an empty body with 400 (callId is required)', async () => {
    const res = await env.app.request('/v1/runs/r1/approve', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    const body = ApiError.parse(await res.json());
    expect(body.error.code).toBe('validation_error');
  });

  it('returns 404 not_found when no pending approval matches the (runId, callId)', async () => {
    const res = await env.app.request('/v1/runs/r1/approve', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ callId: 'nonexistent-call' }),
    });
    expect(res.status).toBe(404);
    const body = ApiError.parse(await res.json());
    expect(body.error.code).toBe('not_found');
    expect(body.error.message).toContain('nonexistent-call');
  });
});

describe('POST /v1/runs/:id/reject', () => {
  it('requires a non-empty reason — body without reason returns 400', async () => {
    const res = await env.app.request('/v1/runs/r1/reject', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ callId: 'c1' }),
    });
    expect(res.status).toBe(400);
    const body = ApiError.parse(await res.json());
    expect(body.error.code).toBe('validation_error');
  });

  it('rejects a missing callId with 400', async () => {
    const res = await env.app.request('/v1/runs/r1/reject', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reason: 'too risky' }),
    });
    expect(res.status).toBe(400);
    const body = ApiError.parse(await res.json());
    expect(body.error.code).toBe('validation_error');
  });

  it('returns 404 not_found when no pending approval matches the (runId, callId)', async () => {
    const res = await env.app.request('/v1/runs/r1/reject', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ callId: 'nonexistent-call', reason: 'no thanks' }),
    });
    expect(res.status).toBe(404);
    const body = ApiError.parse(await res.json());
    expect(body.error.code).toBe('not_found');
  });
});
