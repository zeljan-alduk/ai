/**
 * Tests for `/v1/design-partners/...` and `/v1/admin/design-partner-applications/...`.
 *
 * Wave 11 — covers:
 *   - Public apply endpoint (no auth required), happy path + validation.
 *   - Rate-limit firing after the 5/h cap.
 *   - Idempotent (email, useCase) submission within 5 min.
 *   - Mailer fire-and-forget (asserts the stub was called; a thrown
 *     mailer does NOT break the apply request).
 *   - Admin-only read (default-tenant owner = OK; member of default
 *     = 403; owner of another tenant = 403; unauthenticated = 401).
 *   - Admin-only patch (status + adminNotes; reviewed_by/_at stamped;
 *     non-admin = 403).
 *
 * The harness reuses `setupTestEnv()` but plumbs a capturing
 * `CapturingMailer` through `createDeps()` so the assertions can
 * inspect every send.
 */

import { randomBytes } from 'node:crypto';
import {
  ApiError,
  type DesignPartnerApplication,
  DesignPartnerApplyResponse,
  ListDesignPartnerApplicationsResponse,
} from '@aldo-ai/api-contract';
import type { Mailer, MailerSendOptions, MailerSendResult } from '@aldo-ai/billing';
import { AgentRegistry, PostgresStorage } from '@aldo-ai/registry';
import { InMemorySecretStore } from '@aldo-ai/secrets';
import { fromDatabaseUrl, migrate } from '@aldo-ai/storage';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { signSessionToken } from '../src/auth/jwt.js';
import { type Deps, SEED_TENANT_UUID, createDeps } from '../src/deps.js';
import { _resetDesignPartnerRateLimit } from '../src/routes/design-partners.js';

class CapturingMailer implements Mailer {
  public readonly sends: MailerSendOptions[] = [];
  public throwOnSend = false;
  async send(opts: MailerSendOptions): Promise<MailerSendResult> {
    if (this.throwOnSend) {
      throw new Error('mailer is broken');
    }
    this.sends.push(opts);
    return { ok: true, id: `cap-${this.sends.length}` };
  }
}

interface Harness {
  readonly app: ReturnType<typeof buildApp>;
  readonly deps: Deps;
  readonly mailer: CapturingMailer;
  readonly defaultOwnerHeader: { readonly Authorization: string };
  readonly defaultMemberHeader: { readonly Authorization: string };
  readonly otherTenantOwnerHeader: { readonly Authorization: string };
  teardown(): Promise<void>;
}

async function setup(): Promise<Harness> {
  _resetDesignPartnerRateLimit();
  const db = await fromDatabaseUrl({ driver: 'pglite' });
  await migrate(db);
  const registry = new AgentRegistry({ storage: new PostgresStorage({ client: db }) });
  const secrets = { store: new InMemorySecretStore() };
  const signingKey = new Uint8Array(randomBytes(32));
  const mailer = new CapturingMailer();
  const deps = await createDeps(
    { DATABASE_URL: '', ALDO_LOCAL_DISCOVERY: 'none' },
    { db, registry, secrets, signingKey, mailer },
  );
  const app = buildApp(deps, { log: false });

  // Default-tenant owner — should be the only one passing the admin
  // gate. Migration 006 already seeded the tenants row; we add a
  // user + membership so the JWT resolves.
  await db.query(
    `INSERT INTO users (id, email, password_hash) VALUES ('owner-1', 'owner1@aldo.test', 'h')
     ON CONFLICT (id) DO NOTHING`,
  );
  await db.query(
    `INSERT INTO tenant_members (tenant_id, user_id, role)
     VALUES ($1, 'owner-1', 'owner') ON CONFLICT DO NOTHING`,
    [SEED_TENANT_UUID],
  );
  const ownerToken = await signSessionToken(
    { sub: 'owner-1', tid: SEED_TENANT_UUID, slug: 'default', role: 'owner' },
    signingKey,
  );

  // Default-tenant member — same tenant, wrong role.
  await db.query(
    `INSERT INTO users (id, email, password_hash) VALUES ('member-1', 'member1@aldo.test', 'h')
     ON CONFLICT (id) DO NOTHING`,
  );
  await db.query(
    `INSERT INTO tenant_members (tenant_id, user_id, role)
     VALUES ($1, 'member-1', 'member') ON CONFLICT DO NOTHING`,
    [SEED_TENANT_UUID],
  );
  const memberToken = await signSessionToken(
    { sub: 'member-1', tid: SEED_TENANT_UUID, slug: 'default', role: 'member' },
    signingKey,
  );

  // Owner of a different tenant — wrong slug.
  const otherTenantId = '11111111-1111-1111-1111-111111111111';
  await db.query(
    `INSERT INTO tenants (id, slug, name) VALUES ($1, 'other', 'Other Inc.')
     ON CONFLICT DO NOTHING`,
    [otherTenantId],
  );
  await db.query(
    `INSERT INTO users (id, email, password_hash) VALUES ('owner-other', 'oo@aldo.test', 'h')
     ON CONFLICT (id) DO NOTHING`,
  );
  await db.query(
    `INSERT INTO tenant_members (tenant_id, user_id, role)
     VALUES ($1, 'owner-other', 'owner') ON CONFLICT DO NOTHING`,
    [otherTenantId],
  );
  const otherToken = await signSessionToken(
    { sub: 'owner-other', tid: otherTenantId, slug: 'other', role: 'owner' },
    signingKey,
  );

  return {
    app,
    deps,
    mailer,
    defaultOwnerHeader: { Authorization: `Bearer ${ownerToken}` },
    defaultMemberHeader: { Authorization: `Bearer ${memberToken}` },
    otherTenantOwnerHeader: { Authorization: `Bearer ${otherToken}` },
    async teardown() {
      await deps.close();
    },
  };
}

let h: Harness;
beforeAll(async () => {
  h = await setup();
});
afterAll(async () => {
  await h.teardown();
});

beforeEach(() => {
  // Each test starts with a fresh rate-limit bucket + mailer log so
  // they're order-independent. The DB is shared and rows accumulate
  // — assertions account for that by querying with a filter.
  _resetDesignPartnerRateLimit();
  h.mailer.sends.length = 0;
  h.mailer.throwOnSend = false;
});

const goodPayload = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  name: 'Ada Lovelace',
  email: 'ada@example.com',
  company: 'Analytical Engines Ltd',
  role: 'Engineer',
  repoUrl: 'https://github.com/example/repo',
  useCase:
    'We have a multi-tenant agent platform and want to compare local vs cloud routing for sensitive workloads.',
  teamSize: '6-20',
  ...overrides,
});

describe('POST /v1/design-partners/apply (public)', () => {
  it('accepts a valid submission without an Authorization header', async () => {
    const res = await h.app.request('/v1/design-partners/apply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(goodPayload({ email: 'test1@example.com' })),
    });
    expect(res.status).toBe(200);
    const body = DesignPartnerApplyResponse.parse(await res.json());
    expect(body.id).toMatch(/[0-9a-f-]{36}/);
  });

  it('400s on a missing email', async () => {
    // Build the payload without `email` at all rather than setting it
    // to `undefined` — `exactOptionalPropertyTypes` rejects an
    // explicit `undefined` for an optional property.
    const { email: _drop, ...payload } = goodPayload({ email: 'test2@example.com' });
    void _drop;
    const res = await h.app.request('/v1/design-partners/apply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    expect(res.status).toBe(400);
    const err = ApiError.parse(await res.json());
    expect(err.error.code).toBe('validation_error');
  });

  it('400s when useCase is shorter than 50 chars', async () => {
    const res = await h.app.request('/v1/design-partners/apply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(goodPayload({ email: 'test3@example.com', useCase: 'too short' })),
    });
    expect(res.status).toBe(400);
    const err = ApiError.parse(await res.json());
    expect(err.error.code).toBe('validation_error');
  });

  it('rate-limits a flooding IP after 5 submissions in an hour', async () => {
    const ip = '203.0.113.42';
    let lastStatus = 0;
    for (let i = 0; i < 5; i++) {
      const res = await h.app.request('/v1/design-partners/apply', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-forwarded-for': ip,
        },
        body: JSON.stringify(goodPayload({ email: `flood${i}@example.com` })),
      });
      lastStatus = res.status;
      expect(res.status).toBe(200);
    }
    expect(lastStatus).toBe(200);
    const sixth = await h.app.request('/v1/design-partners/apply', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-forwarded-for': ip,
      },
      body: JSON.stringify(goodPayload({ email: 'flood-final@example.com' })),
    });
    expect(sixth.status).toBe(429);
    const err = ApiError.parse(await sixth.json());
    expect(err.error.code).toBe('rate_limited');
  });

  it('idempotent — same (email, useCase) within 5 min returns the same id', async () => {
    const payload = goodPayload({ email: 'idempo@example.com' });
    const first = await h.app.request('/v1/design-partners/apply', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-forwarded-for': '198.51.100.1',
      },
      body: JSON.stringify(payload),
    });
    expect(first.status).toBe(200);
    const firstBody = DesignPartnerApplyResponse.parse(await first.json());

    const second = await h.app.request('/v1/design-partners/apply', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-forwarded-for': '198.51.100.2',
      },
      body: JSON.stringify(payload),
    });
    expect(second.status).toBe(200);
    const secondBody = DesignPartnerApplyResponse.parse(await second.json());
    expect(secondBody.id).toBe(firstBody.id);
  });

  it('fires the mailer with a notification (fire-and-forget)', async () => {
    const res = await h.app.request('/v1/design-partners/apply', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-forwarded-for': '198.51.100.3',
      },
      body: JSON.stringify(goodPayload({ email: 'notify@example.com' })),
    });
    expect(res.status).toBe(200);
    // Allow the queued microtask to drain.
    await new Promise((r) => setImmediate(r));
    expect(h.mailer.sends.length).toBe(1);
    const send = h.mailer.sends[0];
    expect(send?.to).toBeTruthy();
    expect(send?.subject).toContain('design-partner');
    expect(send?.text).toContain('notify@example.com');
  });

  it('apply succeeds even when the mailer throws (errors swallowed)', async () => {
    h.mailer.throwOnSend = true;
    const res = await h.app.request('/v1/design-partners/apply', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-forwarded-for': '198.51.100.4',
      },
      body: JSON.stringify(goodPayload({ email: 'broken-mailer@example.com' })),
    });
    expect(res.status).toBe(200);
    DesignPartnerApplyResponse.parse(await res.json());
  });
});

describe('GET /v1/admin/design-partner-applications', () => {
  it('401s when no Authorization header is supplied', async () => {
    const res = await h.app.request('/v1/admin/design-partner-applications');
    expect(res.status).toBe(401);
  });

  it('403s a default-tenant member (wrong role)', async () => {
    const res = await h.app.request('/v1/admin/design-partner-applications', {
      headers: h.defaultMemberHeader,
    });
    expect(res.status).toBe(403);
    const err = ApiError.parse(await res.json());
    expect(err.error.code).toBe('forbidden');
  });

  it('403s an owner of a non-default tenant (wrong slug)', async () => {
    const res = await h.app.request('/v1/admin/design-partner-applications', {
      headers: h.otherTenantOwnerHeader,
    });
    expect(res.status).toBe(403);
  });

  it('200s for the default-tenant owner and surfaces submitted rows newest-first', async () => {
    // Ensure at least one submission exists from the previous suite.
    await h.app.request('/v1/design-partners/apply', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-forwarded-for': '198.51.100.10',
      },
      body: JSON.stringify(goodPayload({ email: 'list-target@example.com' })),
    });
    const res = await h.app.request('/v1/admin/design-partner-applications', {
      headers: h.defaultOwnerHeader,
    });
    expect(res.status).toBe(200);
    const body = ListDesignPartnerApplicationsResponse.parse(await res.json());
    expect(body.applications.length).toBeGreaterThan(0);
    // Newest first.
    const ts = body.applications.map((a) => Date.parse(a.createdAt));
    for (let i = 1; i < ts.length; i++) {
      expect(ts[i - 1]).toBeGreaterThanOrEqual(ts[i] ?? 0);
    }
    // Must include our just-submitted email.
    expect(body.applications.find((a) => a.email === 'list-target@example.com')).toBeDefined();
  });

  it('filters by ?status=new', async () => {
    const res = await h.app.request('/v1/admin/design-partner-applications?status=new', {
      headers: h.defaultOwnerHeader,
    });
    expect(res.status).toBe(200);
    const body = ListDesignPartnerApplicationsResponse.parse(await res.json());
    for (const a of body.applications) {
      expect(a.status).toBe('new');
    }
  });

  it('400s on an invalid status filter', async () => {
    const res = await h.app.request('/v1/admin/design-partner-applications?status=banana', {
      headers: h.defaultOwnerHeader,
    });
    expect(res.status).toBe(400);
  });
});

describe('PATCH /v1/admin/design-partner-applications/:id', () => {
  let target: DesignPartnerApplication;

  beforeAll(async () => {
    // Submit a fresh row we'll mutate without polluting the listing
    // tests above.
    const apply = await h.app.request('/v1/design-partners/apply', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-forwarded-for': '198.51.100.20',
      },
      body: JSON.stringify(goodPayload({ email: 'patch-target@example.com' })),
    });
    expect(apply.status).toBe(200);
    const list = await h.app.request('/v1/admin/design-partner-applications', {
      headers: h.defaultOwnerHeader,
    });
    const body = ListDesignPartnerApplicationsResponse.parse(await list.json());
    const found = body.applications.find((a) => a.email === 'patch-target@example.com');
    if (!found) throw new Error('precondition failed — patch target not found');
    target = found;
  });

  it('403s a default-tenant member', async () => {
    const res = await h.app.request(`/v1/admin/design-partner-applications/${target.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...h.defaultMemberHeader },
      body: JSON.stringify({ status: 'contacted' }),
    });
    expect(res.status).toBe(403);
  });

  it('updates status + admin notes and stamps reviewed_by/_at', async () => {
    const res = await h.app.request(`/v1/admin/design-partner-applications/${target.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...h.defaultOwnerHeader },
      body: JSON.stringify({ status: 'contacted', adminNotes: 'looks legit' }),
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as DesignPartnerApplication;
    expect(json.status).toBe('contacted');
    expect(json.adminNotes).toBe('looks legit');
    expect(json.reviewedBy).toBe('owner-1');
    expect(json.reviewedAt).not.toBeNull();
  });

  it('400s on an empty body (must update at least one field)', async () => {
    const res = await h.app.request(`/v1/admin/design-partner-applications/${target.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...h.defaultOwnerHeader },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it('404s on an unknown id', async () => {
    const res = await h.app.request(
      '/v1/admin/design-partner-applications/00000000-0000-0000-0000-00000000ffff',
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...h.defaultOwnerHeader },
        body: JSON.stringify({ status: 'declined' }),
      },
    );
    expect(res.status).toBe(404);
  });

  it('400s on a malformed id', async () => {
    const res = await h.app.request('/v1/admin/design-partner-applications/not-a-uuid', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...h.defaultOwnerHeader },
      body: JSON.stringify({ status: 'declined' }),
    });
    expect(res.status).toBe(400);
  });
});
