/**
 * `POST /v1/gallery/fork` — wave-3 per-template fork.
 *
 * Coverage:
 *   1. happy path — known templateId forks cleanly into the caller's
 *      Default project, returns the right wire shape, and the agent
 *      now appears in `GET /v1/agents`.
 *   2. slug collision — re-forking the same template auto-suffixes the
 *      name with `-2`, `-3`, … so the second fork doesn't clobber the
 *      first.
 *   3. explicit name override — caller-supplied `name` lands verbatim
 *      (and bypasses collision rotation).
 *   4. unknown template → 404 `template_not_found`.
 *   5. unknown projectSlug → 404 `not_found`.
 *   6. malformed body → 400 `validation_error`.
 *   7. audit log → `gallery.fork` row appears for the actor.
 *
 * The harness points the route at `tests/fixtures/gallery-agency/`,
 * which carries two minimal-but-valid agent.v1 YAMLs.
 *
 * LLM-agnostic: the test never asserts on a provider name; the spec
 * declares capability + privacy_tier and that's it.
 */

import { fileURLToPath } from 'node:url';
import { ApiError, GalleryForkResponse, ListAgentsResponse } from '@aldo-ai/api-contract';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type TestEnv, setupTestEnv } from './_setup.js';

const FIXTURE_DIR = fileURLToPath(new URL('./fixtures/gallery-agency', import.meta.url));

let env: TestEnv;

beforeAll(async () => {
  env = await setupTestEnv({}, { agencyDir: FIXTURE_DIR });
});

afterAll(async () => {
  await env.teardown();
});

describe('POST /v1/gallery/fork', () => {
  it('forks a known template into the caller’s Default project', async () => {
    const res = await env.app.request('/v1/gallery/fork', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ templateId: 'sample-engineer' }),
    });
    expect(res.status, 'happy-path fork should return 201').toBe(201);
    const body = GalleryForkResponse.parse(await res.json());
    expect(body.agentName).toBe('sample-engineer');
    expect(body.version).toBe('0.1.0');
    expect(body.projectSlug).toBe('default');
    expect(body.projectId).toBeTruthy();

    // The forked row must be visible via the standard list endpoint.
    const list = await env.app.request('/v1/agents');
    expect(list.status).toBe(200);
    const listBody = ListAgentsResponse.parse(await list.json());
    const found = listBody.agents.find((a) => a.name === 'sample-engineer');
    expect(found, 'forked agent must appear in /v1/agents').toBeDefined();
    expect(found?.team).toBe('delivery');
    expect(found?.privacyTier).toBe('internal');
    expect(found?.projectId).toBe(body.projectId);
  });

  it('appends -2 on slug collision', async () => {
    // The previous test already forked sample-engineer. A second fork
    // without a name override must rotate to `sample-engineer-2`.
    const res = await env.app.request('/v1/gallery/fork', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ templateId: 'sample-engineer' }),
    });
    expect(res.status).toBe(201);
    const body = GalleryForkResponse.parse(await res.json());
    expect(body.agentName).toBe('sample-engineer-2');

    // A third fork rotates to `-3`.
    const third = await env.app.request('/v1/gallery/fork', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ templateId: 'sample-engineer' }),
    });
    expect(third.status).toBe(201);
    const thirdBody = GalleryForkResponse.parse(await third.json());
    expect(thirdBody.agentName).toBe('sample-engineer-3');
  });

  it('respects an explicit name override', async () => {
    const res = await env.app.request('/v1/gallery/fork', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        templateId: 'sample-reviewer',
        name: 'my-custom-reviewer',
      }),
    });
    expect(res.status).toBe(201);
    const body = GalleryForkResponse.parse(await res.json());
    expect(body.agentName).toBe('my-custom-reviewer');
    expect(body.version).toBe('0.2.0');

    // The detail endpoint should now return the renamed agent with the
    // correct team/privacy tier copied from the template.
    const detail = await env.app.request('/v1/agents/my-custom-reviewer');
    expect(detail.status).toBe(200);
    const detailBody = (await detail.json()) as {
      agent: { team: string; privacyTier: string; spec: { identity: { name: string } } };
    };
    expect(detailBody.agent.team).toBe('support');
    expect(detailBody.agent.privacyTier).toBe('sensitive');
    // The PERSISTED spec should also carry the renamed identity — not
    // the template's original name. This is what makes a re-validate
    // (e.g. a CLI export) round-trip cleanly.
    expect(detailBody.agent.spec.identity.name).toBe('my-custom-reviewer');
  });

  it('returns 404 for an unknown templateId', async () => {
    const res = await env.app.request('/v1/gallery/fork', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ templateId: 'does-not-exist' }),
    });
    expect(res.status).toBe(404);
    const body = ApiError.parse(await res.json());
    expect(body.error.code).toBe('template_not_found');
  });

  it('returns 404 for an unknown projectSlug', async () => {
    const res = await env.app.request('/v1/gallery/fork', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        templateId: 'sample-engineer',
        projectSlug: 'no-such-project',
      }),
    });
    expect(res.status).toBe(404);
    const body = ApiError.parse(await res.json());
    expect(body.error.code).toBe('not_found');
  });

  it('rejects a malformed body with 400 validation_error', async () => {
    const res = await env.app.request('/v1/gallery/fork', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // templateId missing.
      body: JSON.stringify({ projectSlug: 'default' }),
    });
    expect(res.status).toBe(400);
    const body = ApiError.parse(await res.json());
    expect(body.error.code).toBe('validation_error');
  });

  it('rejects a templateId with disallowed characters before touching the FS', async () => {
    // `..` would let a careless implementation walk out of the agency
    // tree. The Zod regex blocks the request before the route's
    // forkGalleryTemplate ever runs.
    const res = await env.app.request('/v1/gallery/fork', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ templateId: '../etc/passwd' }),
    });
    expect(res.status).toBe(400);
    const body = ApiError.parse(await res.json());
    expect(body.error.code).toBe('validation_error');
  });

  it('records a gallery.fork audit row for the successful fork', async () => {
    // Read the audit log directly. We don't require an admin role for
    // this — we want to assert the WRITER side fired, not the read
    // surface. The list endpoint is owner-gated; the test harness's
    // default actor is owner-role on the SEED tenant.
    const rows = await env.db.query<{ verb: string; object_id: string | null }>(
      "SELECT verb, object_id FROM audit_log WHERE verb = 'gallery.fork' ORDER BY at",
    );
    expect(rows.rows.length).toBeGreaterThan(0);
    const objectIds = rows.rows.map((r) => r.object_id);
    // At least one audit entry must point at the first (un-suffixed)
    // forked agent — that's the happy-path test above.
    expect(objectIds).toContain('sample-engineer');
  });
});

describe('POST /v1/gallery/fork without a wired agencyDir', () => {
  it('returns 503 gallery_unavailable', async () => {
    // Spin up a SEPARATE harness with no agencyDir wired so we exercise
    // the deploy-misconfiguration branch in isolation.
    const local = await setupTestEnv();
    try {
      const res = await local.app.request('/v1/gallery/fork', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ templateId: 'sample-engineer' }),
      });
      expect(res.status).toBe(503);
      const body = ApiError.parse(await res.json());
      expect(body.error.code).toBe('gallery_unavailable');
    } finally {
      await local.teardown();
    }
  });
});
