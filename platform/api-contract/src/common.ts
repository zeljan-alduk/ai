import { z } from 'zod';

/** Pagination — cursor-based for stable infinite scroll. */
export const PaginationQuery = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type PaginationQuery = z.infer<typeof PaginationQuery>;

export const PaginatedMeta = z.object({
  nextCursor: z.string().nullable(),
  hasMore: z.boolean(),
});
export type PaginatedMeta = z.infer<typeof PaginatedMeta>;

/**
 * Stable error codes the API may return. Open-ended (z.string() preserves
 * forwards-compat with future codes) but the canonical list lives here so
 * clients can switch on them without grep'ing the server.
 *
 * Wave 8 additions:
 *   - `privacy_tier_unroutable` — the requested run can't reach a model
 *     consistent with the agent's `privacy_tier` against the live catalog.
 *     Returned by `POST /v1/runs` (and any run-creation surface) instead
 *     of a generic 500. The detail payload carries the same trace as
 *     `POST /v1/agents/:name/check` so operators can drill in.
 */
export const KNOWN_API_ERROR_CODES = [
  'not_found',
  'validation_error',
  'http_error',
  'internal_error',
  'privacy_tier_unroutable',
  // Wave 10 — auth.
  // `unauthenticated` is the canonical 401 code: the request has no
  // valid bearer token. The web middleware turns this into a redirect
  // to /login?next=<path>; CLI clients prompt for a login.
  'unauthenticated',
  // `forbidden` is the canonical 403 code: the caller is authenticated
  // but the current tenant/role can't reach the resource. Distinct from
  // `unauthenticated` so clients don't bounce a logged-in user back to
  // /login on a routine permission check.
  'forbidden',
  // `tenant_not_found` (404) — a tenant slug couldn't be resolved
  // (e.g. `POST /v1/auth/switch-tenant` against a slug the user has
  // never been a member of, or a typo on the CLI).
  'tenant_not_found',
  // `cross_tenant_access` (403) — caller authenticated as tenant A
  // attempted to read/write a row that belongs to tenant B by id.
  // Most cross-tenant lookups return 404 ("the row does not exist
  // for you" — the safer disclosure stance), but a small set of
  // endpoints where the slug/id is part of the URL itself surface
  // this code so the client can report a real "wrong tenant" UI.
  'cross_tenant_access',
  // Wave 11 — billing.
  // `not_configured` (503) — the requested endpoint depends on a
  // Stripe wiring (env vars) that the current deploy doesn't have.
  // Surfaces under `/v1/billing/*` when STRIPE_* env vars are unset
  // or empty. The web client switches on this code to render a calm
  // placeholder banner rather than an error UI; the trial-gate is
  // permissive in this state so users keep working.
  'not_configured',
  // `trial_expired` (402) — the tenant's 14-day trial has ended and
  // no paid subscription is in place. Returned by the trial-gate
  // middleware on mutating routes (POST /v1/runs, etc) when billing
  // IS configured. The detail payload carries an `upgradeUrl` the
  // client can redirect to.
  'trial_expired',
  // `payment_required` (402) — generic billing-block: subscription
  // was past_due, unpaid, or otherwise unable to charge. Distinct
  // from `trial_expired` so the upgrade UI can render a "fix your
  // card" CTA instead of a "pick a plan" CTA.
  'payment_required',
] as const;
export type KnownApiErrorCode = (typeof KNOWN_API_ERROR_CODES)[number];

/** Standard error envelope. The server returns this on any non-2xx. */
export const ApiError = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});
export type ApiError = z.infer<typeof ApiError>;

/** Privacy tier — mirrors @aldo-ai/types but re-declared for client use. */
export const PrivacyTier = z.enum(['public', 'internal', 'sensitive']);
export type PrivacyTier = z.infer<typeof PrivacyTier>;

export const RunStatus = z.enum(['queued', 'running', 'completed', 'failed', 'cancelled']);
export type RunStatus = z.infer<typeof RunStatus>;
