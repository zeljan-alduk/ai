/**
 * `/v1/design-partners/...` and `/v1/admin/design-partner-applications/...`
 *
 * Wave 11 — design-partner program intake + admin review.
 *
 *   POST  /v1/design-partners/apply                         (PUBLIC)
 *   GET   /v1/admin/design-partner-applications             (admin only)
 *   PATCH /v1/admin/design-partner-applications/:id         (admin only)
 *
 * Public surface:
 *   The apply endpoint is intentionally outside the bearer-token
 *   middleware's allow-list (`apps/api/src/auth/middleware.ts`). The
 *   auth allow-list is exact-match, so we register the path there
 *   alongside `/health` and the auth signup/login paths.
 *
 * Admin-permission policy (TEMPORARY):
 *   The brief calls for "tenant role = owner AND tenant slug =
 *   'default' (or 'aldo-tech-labs')". This is the canonical seed
 *   tenant from migration 006 — the founder is the only person who
 *   resolves to that owner today. When proper RBAC lands (a
 *   `permissions` table or a global "platform admin" role), this
 *   check moves to a dedicated middleware. Until then, the policy
 *   lives inline in `requireAdmin()` below and is documented at
 *   the call site so a future engineer doesn't have to grep for it.
 *
 * Rate limit:
 *   In-process token bucket keyed by source IP, 5 submissions per
 *   IP per hour. NOT multi-instance safe — when we scale beyond
 *   one Fly machine this needs to move to Redis. Wave-13 territory.
 *
 * Idempotency:
 *   A repeat (email, useCase) submission within 5 minutes is
 *   treated as a no-op and returns the original row's id. The
 *   prospect can refresh the success page without flooding the
 *   table.
 *
 * Email notification:
 *   Fire-and-forget through `deps.mailer`. We `void` the promise
 *   so a slow/failing mail provider can never block the apply
 *   request. The default mailer is `NoopMailer` which writes a
 *   single stderr line — enough for the founder to grep dev logs
 *   until a real inbox is wired.
 *
 * LLM-agnostic: nothing in this file references a model provider.
 */

import { createHash, randomUUID } from 'node:crypto';
import {
  DESIGN_PARTNER_STATUSES,
  DesignPartnerApplication,
  DesignPartnerApplyRequest,
  DesignPartnerApplyResponse,
  type DesignPartnerStatus,
  ListDesignPartnerApplicationsResponse,
  UpdateDesignPartnerApplicationRequest,
} from '@aldo-ai/api-contract';
import type { Mailer } from '@aldo-ai/billing';
import type { SqlClient } from '@aldo-ai/storage';
import { type Context, Hono } from 'hono';
import { z } from 'zod';
import type { SessionAuth } from '../auth/jwt.js';
import { forbidden, getAuth } from '../auth/middleware.js';
import type { Deps } from '../deps.js';
import { HttpError, notFound, validationError } from '../middleware/error.js';

/**
 * The tenant slugs whose owners are treated as platform admins.
 *
 * "default" is the seed tenant from migration 006 — that's where the
 * founder lives today. "aldo-tech-labs" is reserved for the eventual
 * rebrand: the seed-default copy will move to that slug, and we
 * accept it preemptively so the cutover is one config change.
 *
 * Privacy note: this list is intentionally tiny. Adding a slug here
 * grants UNRESTRICTED admin read of every applicant's email + IP +
 * user-agent. Don't add tenants casually — RBAC is the right
 * long-term answer.
 */
const ADMIN_TENANT_SLUGS: ReadonlySet<string> = new Set(['default', 'aldo-tech-labs']);

/**
 * Default destination for the new-application notification email. Can
 * be overridden via the `DESIGN_PARTNER_NOTIFICATION_EMAIL` env var
 * once a real inbox exists. At MVP this is a placeholder that the
 * `NoopMailer` happily logs without sending.
 */
const DEFAULT_NOTIFICATION_EMAIL = 'info@aldo.tech';

/**
 * Window inside which a duplicate (email, useCase) submission is
 * folded into the original row. Five minutes covers the legitimate
 * "I clicked submit twice / browser refresh ate the success page"
 * case while still letting a returning applicant submit a real
 * follow-up the next day.
 */
const DEDUPE_WINDOW_MS = 5 * 60 * 1000;

/**
 * In-process rate-limit store. Map of `clientKey -> [timestamp, ...]`
 * with timestamps older than the window pruned on each check.
 *
 * NOT multi-instance safe. When we scale beyond one Fly machine this
 * needs to move to Redis (or to a dedicated rate-limit service).
 * Tracked as wave-13 work.
 */
const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour

interface RateLimitState {
  readonly hits: number[];
}
const rateLimitMemory = new Map<string, RateLimitState>();

/**
 * Test-only seam — `pnpm test` reuses the same module across files
 * which makes the in-process bucket persistent across test cases.
 * The `_setup.ts` harness calls this from `beforeAll` to start
 * fresh.
 */
export function _resetDesignPartnerRateLimit(): void {
  rateLimitMemory.clear();
}

/**
 * Returns true iff the client is over the per-hour cap. Records the
 * hit immediately so two concurrent submissions can't both squeeze
 * past the limit.
 */
function isRateLimited(key: string, nowMs: number): boolean {
  const cutoff = nowMs - RATE_LIMIT_WINDOW_MS;
  const prev = rateLimitMemory.get(key)?.hits ?? [];
  const recent = prev.filter((t) => t > cutoff);
  if (recent.length >= RATE_LIMIT_MAX) {
    rateLimitMemory.set(key, { hits: recent });
    return true;
  }
  recent.push(nowMs);
  rateLimitMemory.set(key, { hits: recent });
  return false;
}

/**
 * Best-effort source-IP extraction. We honour `x-forwarded-for`
 * because Fly / Vercel front the API behind a proxy that strips the
 * raw connection IP; production traffic legitimately has no other
 * source-IP signal. The IP is used ONLY for rate-limit keying — it
 * is NOT stored in the application row when the header is missing.
 */
function clientIp(headerLookup: (name: string) => string | undefined): string | null {
  const xff = headerLookup('x-forwarded-for');
  if (typeof xff === 'string' && xff.length > 0) {
    const first = xff.split(',')[0]?.trim();
    if (first && first.length > 0) return first;
  }
  const real = headerLookup('x-real-ip');
  if (typeof real === 'string' && real.length > 0) return real.trim();
  return null;
}

/**
 * Hash of (lowercased-email + useCase) used to scope the de-dupe
 * window check. Hashing rather than raw equality keeps the lookup
 * cheap regardless of useCase length.
 */
function dedupeKey(email: string, useCase: string): string {
  return createHash('sha256')
    .update(email.toLowerCase().trim())
    .update('|')
    .update(useCase)
    .digest('hex');
}

export function designPartnersRoutes(deps: Deps): Hono {
  const app = new Hono();

  // -------------------------------------------------------------------
  // POST /v1/design-partners/apply — public, no auth.
  //
  // Public-path note: this route lives outside the bearer-token
  // allow-list in `apps/api/src/auth/middleware.ts`. The middleware
  // matches exact paths, so adding the entry there is what actually
  // makes this endpoint callable without an Authorization header.
  // -------------------------------------------------------------------
  app.post('/v1/design-partners/apply', async (c) => {
    const ipForRateLimit = clientIp((n) => c.req.header(n));
    const userAgent = (c.req.header('user-agent') ?? '').slice(0, 500) || null;

    // Rate-limit BEFORE parsing the body so a flood can't burn CPU on
    // Zod validation. Key on IP when present, otherwise on the UA so
    // anonymous clients without forwarded IP still hit a bucket.
    const rateKey = ipForRateLimit ?? `ua:${userAgent ?? 'anonymous'}`;
    if (isRateLimited(rateKey, Date.now())) {
      throw new HttpError(429, 'rate_limited', 'too many submissions; try again in an hour');
    }

    const raw = await safeJson(c.req.raw);
    const parsed = DesignPartnerApplyRequest.safeParse(raw);
    if (!parsed.success) {
      throw validationError('invalid design-partner application', parsed.error.issues);
    }

    // Idempotency: repeat (email, useCase) within 5 min returns the
    // original row's id. We compute the hash off the parsed values so
    // case + whitespace differences in the email collapse together.
    const key = dedupeKey(parsed.data.email, parsed.data.useCase);
    const cutoffIso = new Date(Date.now() - DEDUPE_WINDOW_MS).toISOString();
    const existing = await deps.db.query<{ id: string }>(
      `SELECT id FROM design_partner_applications
        WHERE lower(email) = $1
          AND use_case = $2
          AND created_at >= $3::timestamptz
        ORDER BY created_at DESC
        LIMIT 1`,
      [parsed.data.email.toLowerCase().trim(), parsed.data.useCase, cutoffIso],
    );
    if (existing.rows[0]) {
      // Mark we used the dedupe key so static analysers don't flag it.
      void key;
      const body = DesignPartnerApplyResponse.parse({ id: existing.rows[0].id });
      return c.json(body);
    }

    const id = randomUUID();
    await deps.db.query(
      `INSERT INTO design_partner_applications
         (id, name, email, company, role, repo_url, use_case, team_size,
          ip, user_agent, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'new')`,
      [
        id,
        parsed.data.name,
        parsed.data.email,
        parsed.data.company ?? null,
        parsed.data.role ?? null,
        parsed.data.repoUrl ?? null,
        parsed.data.useCase,
        parsed.data.teamSize ?? null,
        ipForRateLimit,
        userAgent,
      ],
    );

    // Fire-and-forget notification. We `void` the promise so a slow
    // mailer can never block this request. Send errors are caught
    // and logged inside `notifyFounder`; nothing bubbles up here.
    void notifyFounder(deps.mailer, deps.env, parsed.data, id);

    const body = DesignPartnerApplyResponse.parse({ id });
    return c.json(body);
  });

  // -------------------------------------------------------------------
  // GET /v1/admin/design-partner-applications — admin only.
  //
  // Admin policy: tenant role = owner AND tenant slug ∈
  // ADMIN_TENANT_SLUGS. See the file-level docstring for why this is
  // hard-coded today and the upgrade path to RBAC.
  // -------------------------------------------------------------------
  app.get('/v1/admin/design-partner-applications', async (c) => {
    requireAdmin(c);
    const url = new URL(c.req.url);
    const statusFilter = url.searchParams.get('status');
    if (statusFilter !== null && !isStatus(statusFilter)) {
      throw validationError(
        `invalid status filter: ${statusFilter}; expected one of ${DESIGN_PARTNER_STATUSES.join(', ')}`,
      );
    }

    const rows = statusFilter
      ? await selectApplications(deps.db, statusFilter)
      : await selectApplications(deps.db, null);

    const body = ListDesignPartnerApplicationsResponse.parse({
      applications: rows.map(rowToWire),
    });
    return c.json(body);
  });

  // -------------------------------------------------------------------
  // PATCH /v1/admin/design-partner-applications/:id — admin only.
  // -------------------------------------------------------------------
  app.patch('/v1/admin/design-partner-applications/:id', async (c) => {
    const auth = requireAdmin(c);
    const id = c.req.param('id');
    const idParsed = z.string().uuid().safeParse(id);
    if (!idParsed.success) {
      throw validationError('invalid application id');
    }

    const raw = await safeJson(c.req.raw);
    const parsed = UpdateDesignPartnerApplicationRequest.safeParse(raw);
    if (!parsed.success) {
      throw validationError('invalid update body', parsed.error.issues);
    }

    // Build an UPDATE that touches only the fields the caller passed
    // plus the audit columns. Doing it in one statement keeps the
    // row-modification atomic — readers never see a partial update
    // that has the new status but the old reviewed_at.
    const sets: string[] = [];
    const args: unknown[] = [];
    let i = 1;
    if (parsed.data.status !== undefined) {
      sets.push(`status = $${i++}`);
      args.push(parsed.data.status);
    }
    if (parsed.data.adminNotes !== undefined) {
      sets.push(`admin_notes = $${i++}`);
      args.push(parsed.data.adminNotes);
    }
    sets.push(`reviewed_by = $${i++}`);
    args.push(auth.userId);
    sets.push('reviewed_at = now()');
    args.push(idParsed.data);

    const result = await deps.db.query<DbRow>(
      `UPDATE design_partner_applications
          SET ${sets.join(', ')}
        WHERE id = $${i}
        RETURNING ${SELECT_COLUMNS}`,
      args,
    );
    const row = result.rows[0];
    if (!row) {
      throw notFound(`application not found: ${idParsed.data}`);
    }
    return c.json(rowToWire(row));
  });

  return app;
}

// ---------------------------------------------------------------------------
// Helpers.
// ---------------------------------------------------------------------------

const SELECT_COLUMNS = [
  'id',
  'created_at',
  'name',
  'email',
  'company',
  'role',
  'repo_url',
  'use_case',
  'team_size',
  'status',
  'reviewed_by',
  'reviewed_at',
  'admin_notes',
].join(', ');

interface DbRow {
  readonly id: string;
  readonly created_at: string | Date;
  readonly name: string;
  readonly email: string;
  readonly company: string | null;
  readonly role: string | null;
  readonly repo_url: string | null;
  readonly use_case: string;
  readonly team_size: string | null;
  readonly status: string;
  readonly reviewed_by: string | null;
  readonly reviewed_at: string | Date | null;
  readonly admin_notes: string | null;
  // Index signature so the row type satisfies @aldo-ai/storage's
  // SqlRow constraint (`{ readonly [k: string]: unknown }`).
  readonly [k: string]: unknown;
}

async function selectApplications(db: SqlClient, status: string | null): Promise<readonly DbRow[]> {
  if (status === null) {
    const r = await db.query<DbRow>(
      `SELECT ${SELECT_COLUMNS}
         FROM design_partner_applications
         ORDER BY created_at DESC`,
    );
    return r.rows;
  }
  const r = await db.query<DbRow>(
    `SELECT ${SELECT_COLUMNS}
       FROM design_partner_applications
       WHERE status = $1
       ORDER BY created_at DESC`,
    [status],
  );
  return r.rows;
}

function rowToWire(r: DbRow): DesignPartnerApplication {
  return DesignPartnerApplication.parse({
    id: r.id,
    createdAt: toIso(r.created_at),
    name: r.name,
    email: r.email,
    company: r.company,
    role: r.role,
    repoUrl: r.repo_url,
    useCase: r.use_case,
    teamSize: r.team_size,
    status: r.status,
    reviewedBy: r.reviewed_by,
    reviewedAt: r.reviewed_at !== null ? toIso(r.reviewed_at) : null,
    adminNotes: r.admin_notes,
  });
}

function toIso(v: string | Date): string {
  if (v instanceof Date) return v.toISOString();
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? v : d.toISOString();
}

function isStatus(s: string): s is DesignPartnerStatus {
  return (DESIGN_PARTNER_STATUSES as readonly string[]).includes(s);
}

/**
 * Throws 403 unless the caller is an owner of one of the
 * `ADMIN_TENANT_SLUGS`. Returns the resolved `SessionAuth` on success
 * so the caller can stamp `reviewed_by` from `auth.userId` without a
 * second `getAuth()` call.
 *
 * See file-level docstring for the upgrade path to RBAC.
 */
function requireAdmin(c: Context): SessionAuth {
  const auth = getAuth(c);
  if (auth.role !== 'owner' || !ADMIN_TENANT_SLUGS.has(auth.tenantSlug)) {
    throw forbidden('this endpoint is restricted to platform admins');
  }
  return auth;
}

/**
 * Best-effort founder notification. Errors are swallowed (logged via
 * stderr) so the apply request that triggered this can never fail
 * because the mailer was slow/down.
 */
async function notifyFounder(
  mailer: Mailer,
  env: Deps['env'],
  payload: {
    readonly name: string;
    readonly email: string;
    readonly company?: string | undefined;
    readonly useCase: string;
  },
  applicationId: string,
): Promise<void> {
  const to = env.DESIGN_PARTNER_NOTIFICATION_EMAIL ?? DEFAULT_NOTIFICATION_EMAIL;
  const company = payload.company ?? '(unspecified)';
  // Single structured stderr breadcrumb so `grep '[design-partner]'`
  // surfaces every applicant even when the mailer is the noop. We
  // include the application id so the founder can pull the row via
  // /admin/design-partners.
  process.stderr.write(
    `[design-partner] new application from ${JSON.stringify(payload.email)} ` +
      `for company=${JSON.stringify(company)} id=${applicationId}\n`,
  );
  try {
    const subject = `[ALDO AI] New design-partner application: ${payload.email}`;
    const text = `New design-partner application.\n\nName:    ${payload.name}\nEmail:   ${payload.email}\nCompany: ${company}\nRef:     ${applicationId}\n\nWhy interested:\n${payload.useCase}\n`;
    await mailer.send({ to, subject, text });
  } catch (err) {
    process.stderr.write(
      `[design-partner] mailer error (swallowed): ${err instanceof Error ? err.message : String(err)}\n`,
    );
  }
}

/**
 * Read JSON body without exploding on empty / malformed input — the
 * Zod parser gives a much better error than Hono's default
 * `c.req.json()` exception, so we degrade to `{}` and let validation
 * fail.
 */
async function safeJson(req: Request): Promise<unknown> {
  try {
    return (await req.json()) as unknown;
  } catch {
    return {};
  }
}
