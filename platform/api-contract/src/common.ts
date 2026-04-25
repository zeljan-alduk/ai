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
