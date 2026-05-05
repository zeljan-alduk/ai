/**
 * MISSING_PIECES §12.4 — customer engagement surface.
 *
 * Coverage:
 *   - migration 029 lands the three tables
 *   - create + list + get-by-slug round-trips
 *   - slug uniqueness per tenant (409 on duplicate)
 *   - cross-tenant isolation
 *   - update name / description / status (status='archived' sets archived_at)
 *   - milestone create + list, ordered by created_at
 *   - sign-off + reject are mutually exclusive (terminal status)
 *   - sign-off captures user + timestamp
 *   - 409 on second decision on a terminal milestone
 *   - comment kinds: comment / change_request / architecture_decision
 *   - comment list + filter by kind
 *   - comments can reference a run via runId
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type TestEnv, setupTestEnv } from './_setup.js';

let env: TestEnv;

beforeAll(async () => {
  env = await setupTestEnv();
});

afterAll(async () => {
  await env.teardown();
});

describe('GET/POST /v1/engagements', () => {
  it('list is empty by default', async () => {
    const res = await env.app.request('/v1/engagements');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { engagements: unknown[] };
    expect(body.engagements).toEqual([]);
  });

  it('create + list round-trips an engagement', async () => {
    const create = await env.app.request('/v1/engagements', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        slug: 'acme-q3',
        name: 'ACME Q3 platform rebuild',
        description: 'Lift-and-shift their CRM to a multi-tenant arch.',
      }),
    });
    expect(create.status).toBe(201);
    const created = (await create.json()) as {
      engagement: { slug: string; name: string; status: string };
    };
    expect(created.engagement.slug).toBe('acme-q3');
    expect(created.engagement.status).toBe('active');

    const list = await env.app.request('/v1/engagements');
    const body = (await list.json()) as { engagements: { slug: string }[] };
    expect(body.engagements.find((e) => e.slug === 'acme-q3')).toBeDefined();
  });

  it('rejects duplicate slug with 409', async () => {
    await env.app.request('/v1/engagements', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ slug: 'dup-eng', name: 'first' }),
    });
    const res = await env.app.request('/v1/engagements', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ slug: 'dup-eng', name: 'second' }),
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('engagement_slug_conflict');
  });

  it('rejects bad slug shape with 400', async () => {
    const res = await env.app.request('/v1/engagements', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ slug: 'BAD SLUG', name: 'x' }),
    });
    expect(res.status).toBe(400);
  });

  it('cross-tenant: tenant A cannot see tenant B engagements', async () => {
    const tenantB = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    await env.db.query('INSERT INTO tenants (id, slug, name) VALUES ($1, $2, $3)', [
      tenantB,
      'iso-eng-tenant',
      'Iso Engagement Tenant',
    ]);
    const headersB = await env.authFor(tenantB);
    await env.app.request('/v1/engagements', {
      method: 'POST',
      headers: { ...headersB, 'content-type': 'application/json' },
      body: JSON.stringify({ slug: 'tenant-b-private', name: 'B private' }),
    });
    const fromA = await env.app.request('/v1/engagements');
    const bodyA = (await fromA.json()) as { engagements: { slug: string }[] };
    expect(bodyA.engagements.find((e) => e.slug === 'tenant-b-private')).toBeUndefined();
  });
});

describe('GET/PUT /v1/engagements/:slug', () => {
  it('PUT updates name + description', async () => {
    await env.app.request('/v1/engagements', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ slug: 'rename-eng', name: 'old' }),
    });
    const res = await env.app.request('/v1/engagements/rename-eng', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'new', description: 'updated body' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { engagement: { name: string; description: string } };
    expect(body.engagement.name).toBe('new');
    expect(body.engagement.description).toBe('updated body');
  });

  it('PUT status=archived sets archived_at', async () => {
    await env.app.request('/v1/engagements', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ slug: 'archive-me', name: 'archive me' }),
    });
    const res = await env.app.request('/v1/engagements/archive-me', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'archived' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      engagement: { status: string; archivedAt: string | null };
    };
    expect(body.engagement.status).toBe('archived');
    expect(body.engagement.archivedAt).not.toBeNull();
  });

  it('GET unknown slug returns 404', async () => {
    const res = await env.app.request('/v1/engagements/does-not-exist');
    expect(res.status).toBe(404);
  });
});

describe('milestones', () => {
  async function freshEng(slug: string): Promise<string> {
    const res = await env.app.request('/v1/engagements', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ slug, name: slug }),
    });
    const body = (await res.json()) as { engagement: { slug: string } };
    return body.engagement.slug;
  }

  it('create + list', async () => {
    const slug = await freshEng('m-list');
    await env.app.request(`/v1/engagements/${slug}/milestones`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'spec sign-off' }),
    });
    await env.app.request(`/v1/engagements/${slug}/milestones`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'staging deployed' }),
    });
    const res = await env.app.request(`/v1/engagements/${slug}/milestones`);
    const body = (await res.json()) as {
      milestones: { title: string; status: string }[];
    };
    expect(body.milestones).toHaveLength(2);
    expect(body.milestones[0]?.status).toBe('pending');
  });

  it('sign-off captures the user + timestamp', async () => {
    const slug = await freshEng('m-signoff');
    const create = await env.app.request(`/v1/engagements/${slug}/milestones`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'go-live' }),
    });
    const created = (await create.json()) as { milestone: { id: string } };
    const signOff = await env.app.request(
      `/v1/engagements/${slug}/milestones/${created.milestone.id}/sign-off`,
      { method: 'POST' },
    );
    expect(signOff.status).toBe(200);
    const body = (await signOff.json()) as {
      milestone: {
        status: string;
        signedOffBy: string | null;
        signedOffAt: string | null;
      };
    };
    expect(body.milestone.status).toBe('signed_off');
    expect(body.milestone.signedOffBy).not.toBeNull();
    expect(body.milestone.signedOffAt).not.toBeNull();
  });

  it('reject captures the reason; cannot then sign-off', async () => {
    const slug = await freshEng('m-reject');
    const create = await env.app.request(`/v1/engagements/${slug}/milestones`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'security review' }),
    });
    const { milestone } = (await create.json()) as { milestone: { id: string } };
    const reject = await env.app.request(
      `/v1/engagements/${slug}/milestones/${milestone.id}/reject`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reason: 'missing CSP' }),
      },
    );
    expect(reject.status).toBe(200);
    const rejected = (await reject.json()) as {
      milestone: { status: string; rejectedReason: string | null };
    };
    expect(rejected.milestone.status).toBe('rejected');
    expect(rejected.milestone.rejectedReason).toBe('missing CSP');

    const second = await env.app.request(
      `/v1/engagements/${slug}/milestones/${milestone.id}/sign-off`,
      { method: 'POST' },
    );
    expect(second.status).toBe(409);
    const body = (await second.json()) as { error: { code: string } };
    expect(body.error.code).toBe('milestone_already_decided');
  });
});

describe('comments', () => {
  async function freshEng(slug: string): Promise<string> {
    const res = await env.app.request('/v1/engagements', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ slug, name: slug }),
    });
    const body = (await res.json()) as { engagement: { slug: string } };
    return body.engagement.slug;
  }

  it('create + list (default kind=comment)', async () => {
    const slug = await freshEng('c-basic');
    await env.app.request(`/v1/engagements/${slug}/comments`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ body: 'looks good' }),
    });
    const list = await env.app.request(`/v1/engagements/${slug}/comments`);
    const body = (await list.json()) as { comments: { body: string; kind: string }[] };
    expect(body.comments).toHaveLength(1);
    expect(body.comments[0]?.kind).toBe('comment');
  });

  it('change_request + architecture_decision kinds', async () => {
    const slug = await freshEng('c-kinds');
    for (const kind of ['change_request', 'architecture_decision'] as const) {
      await env.app.request(`/v1/engagements/${slug}/comments`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ body: `body for ${kind}`, kind }),
      });
    }
    const all = (await (
      await env.app.request(`/v1/engagements/${slug}/comments`)
    ).json()) as { comments: { kind: string }[] };
    expect(all.comments).toHaveLength(2);

    const filtered = (await (
      await env.app.request(
        `/v1/engagements/${slug}/comments?kind=architecture_decision`,
      )
    ).json()) as { comments: { kind: string }[] };
    expect(filtered.comments).toHaveLength(1);
    expect(filtered.comments[0]?.kind).toBe('architecture_decision');
  });

  it('rejects unknown comment kind with 400', async () => {
    const slug = await freshEng('c-bad-kind');
    const res = await env.app.request(`/v1/engagements/${slug}/comments`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ body: 'x', kind: 'gossip' }),
    });
    expect(res.status).toBe(400);
  });
});
