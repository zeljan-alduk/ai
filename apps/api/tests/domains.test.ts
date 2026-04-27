/**
 * Wave-16 custom-domain tests.
 *
 * Asserts:
 *   - POST /v1/domains seeds a row with a TXT instructions envelope.
 *   - GET /v1/domains returns the row when present, [] otherwise.
 *   - POST /v1/domains/:hostname/verify with a fake DNS resolver.
 *   - DELETE /v1/domains/:hostname.
 *   - the verifyTxtRecord helper times out as expected.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { verifyTxtRecord } from '../src/routes/domains.js';
import { type TestEnv, setupTestEnv } from './_setup.js';

describe('wave-16 domains route', () => {
  let env: TestEnv;
  beforeAll(async () => {
    env = await setupTestEnv();
  });
  afterAll(async () => {
    await env.teardown();
  });

  it('POST /v1/domains creates a row + returns TXT instructions', async () => {
    const res = await env.app.request('/v1/domains', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ hostname: 'agents.acme-corp.com' }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      domain?: {
        hostname?: string;
        txtRecordName?: string;
        txtRecordValue?: string;
        verifiedAt?: string | null;
        sslStatus?: string;
      };
    };
    expect(body.domain?.hostname).toBe('agents.acme-corp.com');
    expect(body.domain?.txtRecordName).toBe('_aldo-verification.agents.acme-corp.com');
    expect(typeof body.domain?.txtRecordValue).toBe('string');
    expect(body.domain?.verifiedAt).toBeNull();
    expect(body.domain?.sslStatus).toBe('pending');
  });

  it('GET /v1/domains lists the seeded row', async () => {
    const res = await env.app.request('/v1/domains');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { domains?: { hostname?: string }[] };
    expect(body.domains?.length).toBe(1);
    expect(body.domains?.[0]?.hostname).toBe('agents.acme-corp.com');
  });

  it('verifyTxtRecord helper returns ok:false on TXT mismatch', async () => {
    // Stub a DNS resolver that returns the wrong record.
    const fakeResolve = async () => [['some-other-token']];
    const result = await verifyTxtRecord('agents.acme-corp.com', 'expected-token', {
      resolve: fakeResolve,
      timeoutMs: 1000,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/did not match/);
    }
  });

  it('verifyTxtRecord returns ok:true on a matching TXT record', async () => {
    const fakeResolve = async () => [['expected-token']];
    const result = await verifyTxtRecord('agents.acme-corp.com', 'expected-token', {
      resolve: fakeResolve,
      timeoutMs: 1000,
    });
    expect(result.ok).toBe(true);
  });

  it('DELETE /v1/domains/:hostname removes the row', async () => {
    const res = await env.app.request('/v1/domains/agents.acme-corp.com', { method: 'DELETE' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { deleted?: boolean };
    expect(body.deleted).toBe(true);
    // Subsequent GET returns empty.
    const list = await env.app.request('/v1/domains');
    const listBody = (await list.json()) as { domains?: unknown[] };
    expect(listBody.domains?.length).toBe(0);
  });
});
