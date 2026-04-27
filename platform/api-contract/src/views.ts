/**
 * Wave-13 — saved views.
 *
 * A saved view is a named, JSON-shaped filter set bound to one of the
 * platform surfaces (runs / agents / eval / observability). The web
 * UI renders them as pinned dropdown shortcuts; clicking a view
 * pushes its `query` into the URL and re-runs the surface's list call.
 *
 * Tenancy: every view belongs to (tenant_id, user_id). The
 * `is_shared` flag exposes the view to other members of the SAME
 * tenant (read-only); cross-tenant sharing is intentionally out of
 * scope.
 *
 * LLM-agnostic: the `query` JSONB column carries opaque filter keys —
 * the schema never enumerates a specific model or provider name.
 */

import { z } from 'zod';

export const SavedViewSurface = z.enum(['runs', 'agents', 'eval', 'observability']);
export type SavedViewSurface = z.infer<typeof SavedViewSurface>;

export const SavedView = z.object({
  id: z.string(),
  name: z.string(),
  surface: SavedViewSurface,
  /** Free-shape filter payload. The web client owns the contents. */
  query: z.record(z.unknown()),
  /** Visible to other members of the same tenant when true. */
  isShared: z.boolean(),
  /** ISO timestamp the view was first saved. */
  createdAt: z.string(),
  /** ISO timestamp of the most recent edit (rename / re-save). */
  updatedAt: z.string(),
  /**
   * Optional sentinel — `true` iff the authenticated user authored the
   * row. Distinct from `isShared` so the UI can distinguish "my view"
   * from "shared by a teammate" without an extra round-trip.
   */
  ownedByMe: z.boolean().optional(),
});
export type SavedView = z.infer<typeof SavedView>;

export const ListSavedViewsQuery = z.object({
  surface: SavedViewSurface,
});
export type ListSavedViewsQuery = z.infer<typeof ListSavedViewsQuery>;

export const ListSavedViewsResponse = z.object({
  views: z.array(SavedView),
});
export type ListSavedViewsResponse = z.infer<typeof ListSavedViewsResponse>;

export const CreateSavedViewRequest = z.object({
  name: z.string().min(1).max(120),
  surface: SavedViewSurface,
  query: z.record(z.unknown()),
  isShared: z.boolean().optional(),
});
export type CreateSavedViewRequest = z.infer<typeof CreateSavedViewRequest>;

export const UpdateSavedViewRequest = z.object({
  name: z.string().min(1).max(120).optional(),
  query: z.record(z.unknown()).optional(),
  isShared: z.boolean().optional(),
});
export type UpdateSavedViewRequest = z.infer<typeof UpdateSavedViewRequest>;
