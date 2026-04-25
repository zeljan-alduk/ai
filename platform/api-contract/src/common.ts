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

export const RunStatus = z.enum([
  'queued',
  'running',
  'completed',
  'failed',
  'cancelled',
]);
export type RunStatus = z.infer<typeof RunStatus>;
