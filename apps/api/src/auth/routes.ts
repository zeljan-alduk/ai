/**
 * `/v1/auth/...` — wave-10 auth surface.
 *
 *   POST /v1/auth/signup           create user + tenant + owner membership
 *   POST /v1/auth/login            verify password, issue JWT
 *   POST /v1/auth/switch-tenant    switch the active tenant on a session
 *   POST /v1/auth/logout           stateless — exists for client ergonomics
 *   GET  /v1/auth/me               echo back the session + memberships
 *
 * Every route here returns the standard `ApiError` envelope on failures.
 * The signup/login endpoints are deliberately on the auth-middleware's
 * allow-list — they need to run BEFORE we have a token.
 *
 * Wire format: shapes are validated through Zod schemas defined in
 * this file (NOT in @aldo-ai/api-contract for now — wave 10 keeps the
 * contract package focused on the cross-package surfaces; auth is an
 * internal-to-the-API concern). Engineer N's frontend will mirror the
 * same shapes, and we lift them into api-contract once the surface
 * stabilises.
 */

import { randomUUID } from 'node:crypto';
import type { ApiError } from '@aldo-ai/api-contract';
import type { SqlClient } from '@aldo-ai/storage';
import { Hono } from 'hono';
import { z } from 'zod';
import { seedDefaultDashboards } from '../dashboards/seed-defaults.js';
import type { Deps } from '../deps.js';
import { HttpError, validationError } from '../middleware/error.js';
import { createProject } from '../projects-store.js';
import { type SessionAuth, type SessionTokenClaims, signSessionToken } from './jwt.js';
import { forbidden, getAuth } from './middleware.js';
import { assertPasswordPolicy, hashPassword, verifyPassword } from './passwords.js';
import {
  type MembershipRecord,
  createTenantAndOwner,
  findTenantBySlug,
  findUserByEmail,
  findUserById,
  getMembership,
  listMemberships,
  tenantSlugExists,
  userEmailExists,
} from './store.js';

// Tell TypeScript about the typed error envelope that we return.
void (undefined as ApiError | undefined);

// ---------------------------------------------------------------------------
// Wire schemas
// ---------------------------------------------------------------------------

/**
 * Loose RFC-5322 sanity check — we don't try to validate every legal
 * email here, just reject obvious garbage. Real verification happens
 * out-of-band (a future wave adds confirmation emails).
 */
const EmailSchema = z
  .string()
  .min(3)
  .max(254)
  .regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'invalid email');

const SignupRequest = z.object({
  email: EmailSchema,
  password: z.string().min(1),
  tenantName: z.string().min(1).max(120),
  /** Optional: the URL/CLI slug. Derived from `tenantName` when omitted. */
  tenantSlug: z
    .string()
    .min(2)
    .max(64)
    .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/, 'slug must be kebab-case [a-z0-9-]')
    .optional(),
});

const LoginRequest = z.object({
  email: EmailSchema,
  password: z.string().min(1),
});

const SwitchTenantRequest = z.object({
  tenantSlug: z.string().min(1),
});

// ---------------------------------------------------------------------------
// Wire response shapes — kept in this module for now (see header).
// ---------------------------------------------------------------------------

interface AuthSessionPayload {
  readonly token: string;
  readonly expiresIn: number;
  readonly user: { readonly id: string; readonly email: string };
  readonly tenant: {
    readonly id: string;
    readonly slug: string;
    readonly name: string;
    // Wave-13: TenantRole now includes 'viewer'.
    readonly role: 'owner' | 'admin' | 'member' | 'viewer';
  };
  readonly memberships: readonly {
    readonly tenantId: string;
    readonly tenantSlug: string;
    readonly tenantName: string;
    readonly role: 'owner' | 'admin' | 'member' | 'viewer';
  }[];
}

function membershipsToWire(rows: readonly MembershipRecord[]): AuthSessionPayload['memberships'] {
  return rows.map((m) => ({
    tenantId: m.tenantId,
    tenantSlug: m.tenantSlug,
    tenantName: m.tenantName,
    role: m.role,
  }));
}

// ---------------------------------------------------------------------------
// Route factory
// ---------------------------------------------------------------------------

export interface AuthRoutesDeps {
  readonly db: SqlClient;
  readonly signingKey: Uint8Array;
  /** Test seam — defaults to `Math.floor(Date.now()/1000)`. */
  readonly nowSeconds?: () => number;
}

/**
 * Build an `AuthRoutesDeps` from the same `Deps` bag the rest of the
 * API uses. The signing key is required at boot (see deps.ts) so by
 * the time this runs it's already on `deps`.
 */
export function authRoutesDeps(deps: Deps & { readonly signingKey: Uint8Array }): AuthRoutesDeps {
  return { db: deps.db, signingKey: deps.signingKey };
}

export function authRoutes(deps: AuthRoutesDeps): Hono {
  const app = new Hono();
  const now = deps.nowSeconds ?? (() => Math.floor(Date.now() / 1000));

  // ----- POST /v1/auth/signup -------------------------------------------

  app.post('/v1/auth/signup', async (c) => {
    const raw = await safeJson(c.req.raw);
    const parsed = SignupRequest.safeParse(raw);
    if (!parsed.success) {
      throw validationError('invalid signup payload', parsed.error.issues);
    }
    const { email, password, tenantName, tenantSlug } = parsed.data;
    try {
      assertPasswordPolicy(password);
    } catch (err) {
      throw validationError(err instanceof Error ? err.message : 'password policy violation');
    }
    if (await userEmailExists(deps.db, email)) {
      throw new HttpError(409, 'conflict', 'an account with that email already exists');
    }
    if (tenantSlug !== undefined && (await tenantSlugExists(deps.db, tenantSlug))) {
      throw new HttpError(409, 'conflict', `tenant slug already taken: ${tenantSlug}`);
    }
    const passwordHash = await hashPassword(password);
    const created = await createTenantAndOwner(deps.db, {
      email,
      passwordHash,
      tenantName,
      ...(tenantSlug !== undefined ? { tenantSlug } : {}),
    });
    const token = await signSessionToken(
      {
        sub: created.user.id,
        tid: created.tenant.id,
        slug: created.tenant.slug,
        role: created.role,
      },
      deps.signingKey,
      { nowSeconds: now() },
    );
    const memberships = await listMemberships(deps.db, created.user.id);
    // Wave 14: seed two default dashboards (Operations + Cost) so the
    // tenant has something to look at on first login. Best-effort: a
    // failure here MUST NOT block signup — we log and move on.
    try {
      await seedDefaultDashboards(deps.db, {
        tenantId: created.tenant.id,
        userId: created.user.id,
      });
    } catch (err) {
      console.error('[dashboards] default-dashboard seed failed', err);
    }
    // Wave 17: seed a Default project. The 019_projects.sql migration
    // backfills existing tenants but new tenants created after the
    // migration must be seeded at signup time. Same best-effort
    // pattern — never block signup. Discovered via post-signup e2e
    // on 2026-04-28; the /projects page came up empty for fresh
    // tenants.
    try {
      await createProject(deps.db, {
        id: randomUUID(),
        tenantId: created.tenant.id,
        slug: 'default',
        name: 'Default',
        description:
          'Auto-created on first launch. Rename or archive once you set up named projects.',
      });
    } catch (err) {
      console.error('[projects] default-project seed failed', err);
    }
    // Wave 13: audit signup (best-effort). We can't go through
    // `recordAudit(c)` here because the request hasn't been stamped
    // with `auth` yet — we synthesise the row directly.
    void writeAuthAudit(
      deps.db,
      c,
      created.tenant.id,
      created.user.id,
      'auth.signup',
      'user',
      created.user.id,
      {
        email: created.user.email,
        tenantSlug: created.tenant.slug,
      },
    );
    const body: AuthSessionPayload = {
      token,
      expiresIn: tokenTtlSeconds(),
      user: { id: created.user.id, email: created.user.email },
      tenant: {
        id: created.tenant.id,
        slug: created.tenant.slug,
        name: created.tenant.name,
        role: created.role,
      },
      memberships: membershipsToWire(memberships),
    };
    return c.json(body, 201);
  });

  // ----- POST /v1/auth/login --------------------------------------------

  app.post('/v1/auth/login', async (c) => {
    const raw = await safeJson(c.req.raw);
    const parsed = LoginRequest.safeParse(raw);
    if (!parsed.success) {
      throw validationError('invalid login payload', parsed.error.issues);
    }
    const { email, password } = parsed.data;
    const user = await findUserByEmail(deps.db, email);
    // We deliberately don't distinguish "no user" from "wrong password" —
    // both surface as the same generic 401 so an attacker can't enumerate
    // valid emails through this endpoint.
    if (user === null) {
      throw new HttpError(401, 'unauthenticated', 'invalid credentials');
    }
    const ok = await verifyPassword(user.passwordHash, password);
    if (!ok) {
      throw new HttpError(401, 'unauthenticated', 'invalid credentials');
    }
    const memberships = await listMemberships(deps.db, user.id);
    if (memberships.length === 0) {
      // A user with no tenant memberships shouldn't be able to do
      // anything useful; refuse rather than mint a tenant-less token.
      throw new HttpError(403, 'forbidden', 'user has no tenant memberships');
    }
    // The first membership is the most recently active — `listMemberships`
    // orders by `joined_at DESC, slug ASC`, which approximates "most
    // recently joined" until we add a `last_active_at` column.
    const primary = memberships[0] as MembershipRecord;
    const claims: SessionTokenClaims = {
      sub: user.id,
      tid: primary.tenantId,
      slug: primary.tenantSlug,
      role: primary.role,
    };
    const token = await signSessionToken(claims, deps.signingKey, { nowSeconds: now() });
    void writeAuthAudit(deps.db, c, primary.tenantId, user.id, 'auth.login', 'user', user.id, {
      email: user.email,
      tenantSlug: primary.tenantSlug,
    });
    const body: AuthSessionPayload = {
      token,
      expiresIn: tokenTtlSeconds(),
      user: { id: user.id, email: user.email },
      tenant: {
        id: primary.tenantId,
        slug: primary.tenantSlug,
        name: primary.tenantName,
        role: primary.role,
      },
      memberships: membershipsToWire(memberships),
    };
    return c.json(body, 200);
  });

  // ----- POST /v1/auth/switch-tenant ------------------------------------

  app.post('/v1/auth/switch-tenant', async (c) => {
    const auth = getAuth(c);
    const raw = await safeJson(c.req.raw);
    const parsed = SwitchTenantRequest.safeParse(raw);
    if (!parsed.success) {
      throw validationError('invalid switch-tenant payload', parsed.error.issues);
    }
    const tenant = await findTenantBySlug(deps.db, parsed.data.tenantSlug);
    if (tenant === null) {
      throw new HttpError(404, 'tenant_not_found', `tenant not found: ${parsed.data.tenantSlug}`);
    }
    const membership = await getMembership(deps.db, tenant.id, auth.userId);
    if (membership === null) {
      // Caller is authenticated but isn't a member of the target
      // tenant. Use `cross_tenant_access` so the client UI can render
      // a precise "you're not a member of <slug>" message — distinct
      // from "tenant doesn't exist".
      throw new HttpError(
        403,
        'cross_tenant_access',
        `not a member of tenant: ${parsed.data.tenantSlug}`,
      );
    }
    const memberships = await listMemberships(deps.db, auth.userId);
    const claims: SessionTokenClaims = {
      sub: auth.userId,
      tid: membership.tenantId,
      slug: membership.tenantSlug,
      role: membership.role,
    };
    const token = await signSessionToken(claims, deps.signingKey, { nowSeconds: now() });
    const user = await findUserById(deps.db, auth.userId);
    const body: AuthSessionPayload = {
      token,
      expiresIn: tokenTtlSeconds(),
      user: {
        id: auth.userId,
        email: user?.email ?? '',
      },
      tenant: {
        id: membership.tenantId,
        slug: membership.tenantSlug,
        name: membership.tenantName,
        role: membership.role,
      },
      memberships: membershipsToWire(memberships),
    };
    return c.json(body, 200);
  });

  // ----- POST /v1/auth/logout -------------------------------------------

  // Stateless: the client drops the token and the server forgets nothing
  // (no token blacklist in MVP — tokens expire in 14 days). The endpoint
  // exists so the web client can call a single canonical URL on logout
  // for analytics + future-proofing (when we add a revocation list).
  app.post('/v1/auth/logout', async (c) => {
    // We call getAuth() so accessing this endpoint without a session
    // also 401s — there's nothing to log out from when you weren't in.
    void getAuth(c);
    return c.body(null, 204);
  });

  // ----- GET /v1/auth/me ------------------------------------------------

  app.get('/v1/auth/me', async (c) => {
    const auth = getAuth(c);
    const [user, tenant, memberships] = await Promise.all([
      findUserById(deps.db, auth.userId),
      findTenantBySlug(deps.db, auth.tenantSlug),
      listMemberships(deps.db, auth.userId),
    ]);
    if (user === null) {
      // The token references a user that no longer exists — treat as a
      // forbidden state (client should re-login).
      throw forbidden('user no longer exists');
    }
    if (tenant === null) {
      // Tenant deleted out from under the session — the client should
      // pick a different tenant via /v1/auth/switch-tenant.
      throw new HttpError(404, 'tenant_not_found', 'tenant on session no longer exists');
    }
    const body = {
      user: { id: user.id, email: user.email },
      tenant: {
        id: tenant.id,
        slug: tenant.slug,
        name: tenant.name,
        role: auth.role,
      },
      memberships: membershipsToWire(memberships),
    };
    return c.json(body);
  });

  return app;
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

/** Seconds till expiry — surfaced in responses so clients schedule re-login. */
function tokenTtlSeconds(): number {
  return 14 * 24 * 60 * 60;
}

async function safeJson(req: Request): Promise<unknown> {
  try {
    return (await req.json()) as unknown;
  } catch {
    return {};
  }
}

// Re-export the SessionAuth type so route factories importing this
// module don't need a second import.
export type { SessionAuth };

/**
 * Best-effort audit row writer used inside auth routes BEFORE the
 * bearer-token middleware has stamped a session — we synthesise the
 * actor from the just-issued token's claims. Failures are logged to
 * stderr and swallowed (an audit-write failure must never regress an
 * auth flow).
 */
async function writeAuthAudit(
  db: SqlClient,
  c: import('hono').Context,
  tenantId: string,
  userId: string,
  verb: string,
  objectKind: string,
  objectId: string | null,
  metadata: Record<string, unknown>,
): Promise<void> {
  try {
    const ip =
      c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? c.req.header('x-real-ip') ?? null;
    const ua = c.req.header('user-agent') ?? null;
    const { randomUUID } = await import('node:crypto');
    await db.query(
      `INSERT INTO audit_log
         (id, tenant_id, actor_user_id, verb, object_kind, object_id, ip, user_agent, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)`,
      [
        randomUUID(),
        tenantId,
        userId,
        verb,
        objectKind,
        objectId,
        ip,
        ua,
        JSON.stringify(metadata),
      ],
    );
  } catch (err) {
    process.stderr.write(`[audit] auth-route audit failed: ${(err as Error).message}\n`);
  }
}
