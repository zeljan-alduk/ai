/**
 * Design-partner program wire types.
 *
 * Wave 11. The marketing site exposes /design-partner — a public form
 * where prospects pitch themselves for "$0 for 3 months in exchange
 * for a case study + bi-weekly call." The form lands on
 * `POST /v1/design-partners/apply` (PUBLIC, no auth) and a row goes
 * into `design_partner_applications` (migration 008).
 *
 * The founder reviews submissions through
 * `GET  /v1/admin/design-partner-applications` and
 * `PATCH /v1/admin/design-partner-applications/:id` — both gated by a
 * temporary "owner of the default tenant" check until proper RBAC
 * lands in a later wave.
 *
 * LLM-agnostic: nothing in this file references a model provider.
 */

import { z } from 'zod';

/**
 * Email pattern shared by client + server. Loose by design — RFC 5321
 * compliant validation is famously brittle; we just want a single `@`,
 * a non-empty local part, and a domain with at least one dot. The
 * authoritative check is "the founder reaches out and the email
 * bounces or it doesn't".
 */
export const DESIGN_PARTNER_EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Bounded options for the optional "what's your role?" dropdown. */
export const DESIGN_PARTNER_ROLES = ['Engineer', 'Founder', 'Researcher', 'Other'] as const;
export type DesignPartnerRole = (typeof DESIGN_PARTNER_ROLES)[number];

/** Bounded options for the team-size radio. */
export const DESIGN_PARTNER_TEAM_SIZES = ['1-5', '6-20', '21-100', '100+'] as const;
export type DesignPartnerTeamSize = (typeof DESIGN_PARTNER_TEAM_SIZES)[number];

/**
 * Statuses for the workflow column. `new` is the seed state set by the
 * apply endpoint; `contacted | accepted | declined` are the founder-side
 * transitions in the admin UI.
 */
export const DESIGN_PARTNER_STATUSES = ['new', 'contacted', 'accepted', 'declined'] as const;
export type DesignPartnerStatus = (typeof DESIGN_PARTNER_STATUSES)[number];

/* ----------------------------- Apply (public) ---------------------------- */

/**
 * Apply request body. `useCase` is the load-bearing free-text field —
 * the founder reads it to decide whether to reach out, so we cap it
 * at 50-500 chars to keep submissions thoughtful (and to keep the
 * row size bounded).
 */
export const DesignPartnerApplyRequest = z.object({
  name: z.string().min(1).max(120),
  email: z.string().min(1).max(254).regex(DESIGN_PARTNER_EMAIL_REGEX, { message: 'invalid email' }),
  company: z.string().max(120).optional(),
  role: z.enum(DESIGN_PARTNER_ROLES).optional(),
  repoUrl: z.string().url().max(500).optional(),
  useCase: z.string().min(50).max(500),
  teamSize: z.enum(DESIGN_PARTNER_TEAM_SIZES).optional(),
});
export type DesignPartnerApplyRequest = z.infer<typeof DesignPartnerApplyRequest>;

/**
 * Apply response — just the new row's id. The applicant uses this as
 * a reference number when they email back in. The web page shows it
 * as `ref: <id>` on the thank-you card.
 */
export const DesignPartnerApplyResponse = z.object({
  id: z.string().min(1),
});
export type DesignPartnerApplyResponse = z.infer<typeof DesignPartnerApplyResponse>;

/* --------------------------- Admin (auth + role) ------------------------- */

/**
 * Wire shape of one application row as seen by the admin list/detail.
 * Mirrors the DB row 1:1 except `ip` and `userAgent` which we keep
 * server-side only for now (privacy: don't render fingerprintable
 * data in the admin UI when we don't have to).
 */
export const DesignPartnerApplication = z.object({
  id: z.string(),
  createdAt: z.string(),
  name: z.string(),
  email: z.string(),
  company: z.string().nullable(),
  role: z.string().nullable(),
  repoUrl: z.string().nullable(),
  useCase: z.string(),
  teamSize: z.string().nullable(),
  status: z.enum(DESIGN_PARTNER_STATUSES),
  reviewedBy: z.string().nullable(),
  reviewedAt: z.string().nullable(),
  adminNotes: z.string().nullable(),
});
export type DesignPartnerApplication = z.infer<typeof DesignPartnerApplication>;

export const ListDesignPartnerApplicationsResponse = z.object({
  applications: z.array(DesignPartnerApplication),
});
export type ListDesignPartnerApplicationsResponse = z.infer<
  typeof ListDesignPartnerApplicationsResponse
>;

/**
 * PATCH body. Both fields are optional so the admin UI can update
 * either status or notes alone. An empty body is rejected so the
 * server never wastes a `reviewed_at` bump on a no-op.
 */
export const UpdateDesignPartnerApplicationRequest = z
  .object({
    status: z.enum(DESIGN_PARTNER_STATUSES).optional(),
    adminNotes: z.string().max(4000).optional(),
  })
  .refine((v) => v.status !== undefined || v.adminNotes !== undefined, {
    message: 'one of {status, adminNotes} is required',
  });
export type UpdateDesignPartnerApplicationRequest = z.infer<
  typeof UpdateDesignPartnerApplicationRequest
>;
