/**
 * Wave 17 — projects.
 *
 * Inside a tenant, customers group their work into named **projects**.
 * Hierarchy is `tenant -> project`, no intermediate workspace. The
 * slug is unique within a tenant; URLs resolve `<slug>` against the
 * caller's tenant from the session, never globally.
 *
 * Projects are populated foundation only in this wave: the entity
 * exists end-to-end (DB → API → UI list/create), but agents/runs/
 * datasets/etc. are NOT yet scoped by `project_id`. Retrofitting
 * those scopings happens in follow-up migrations, one entity at a
 * time, behind a per-tenant feature flag.
 */

import { z } from 'zod';

export const Project = z.object({
  id: z.string(),
  tenantId: z.string(),
  slug: z.string(),
  name: z.string(),
  description: z.string(),
  archivedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Project = z.infer<typeof Project>;

export const ListProjectsResponse = z.object({
  projects: z.array(Project),
});
export type ListProjectsResponse = z.infer<typeof ListProjectsResponse>;

export const ProjectEnvelope = z.object({ project: Project });
export type ProjectEnvelope = z.infer<typeof ProjectEnvelope>;

/**
 * Slug shape: lowercase letters, digits, dashes. Length 1..64. The DB
 * uniqueness constraint is per-tenant; we enforce shape at the API.
 */
const ProjectSlug = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/, 'slug must be lowercase letters, digits, or dashes');

export const CreateProjectRequest = z.object({
  slug: ProjectSlug,
  name: z.string().min(1).max(160),
  description: z.string().max(2000).default(''),
});
export type CreateProjectRequest = z.infer<typeof CreateProjectRequest>;

export const UpdateProjectRequest = z.object({
  slug: ProjectSlug.optional(),
  name: z.string().min(1).max(160).optional(),
  description: z.string().max(2000).optional(),
  archived: z.boolean().optional(),
});
export type UpdateProjectRequest = z.infer<typeof UpdateProjectRequest>;
