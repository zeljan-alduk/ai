/**
 * MISSING_PIECES §12.4 — customer engagement surface wire types.
 *
 * Threads grouped runs by `thread_id` but lacked engagement-shaped
 * semantics: no sign-off, no milestone tracking, no SOW alignment.
 * The /v1/engagements API ships those as first-class entities.
 *
 * LLM-agnostic: these schemas don't reference any model field.
 */

import { z } from 'zod';

export const EngagementStatus = z.enum(['active', 'paused', 'complete', 'archived']);
export type EngagementStatus = z.infer<typeof EngagementStatus>;

export const Engagement = z.object({
  id: z.string(),
  tenantId: z.string(),
  slug: z.string(),
  name: z.string(),
  description: z.string(),
  status: EngagementStatus,
  createdAt: z.string(),
  updatedAt: z.string(),
  archivedAt: z.string().nullable(),
});
export type Engagement = z.infer<typeof Engagement>;

export const ListEngagementsResponse = z.object({
  engagements: z.array(Engagement),
});
export type ListEngagementsResponse = z.infer<typeof ListEngagementsResponse>;

export const GetEngagementResponse = z.object({
  engagement: Engagement,
});
export type GetEngagementResponse = z.infer<typeof GetEngagementResponse>;

export const CreateEngagementRequest = z.object({
  slug: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9][a-z0-9-]*$/, 'slug must be lowercase kebab-case'),
  name: z.string().min(1).max(120),
  description: z.string().max(4000).optional(),
});
export type CreateEngagementRequest = z.infer<typeof CreateEngagementRequest>;

export const UpdateEngagementRequest = z.object({
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(4000).optional(),
  status: EngagementStatus.optional(),
});
export type UpdateEngagementRequest = z.infer<typeof UpdateEngagementRequest>;

export const MilestoneStatus = z.enum(['pending', 'in_review', 'signed_off', 'rejected']);
export type MilestoneStatus = z.infer<typeof MilestoneStatus>;

export const Milestone = z.object({
  id: z.string(),
  engagementId: z.string(),
  tenantId: z.string(),
  title: z.string(),
  description: z.string(),
  status: MilestoneStatus,
  dueAt: z.string().nullable(),
  signedOffBy: z.string().nullable(),
  signedOffAt: z.string().nullable(),
  rejectedReason: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Milestone = z.infer<typeof Milestone>;

export const ListMilestonesResponse = z.object({
  milestones: z.array(Milestone),
});
export type ListMilestonesResponse = z.infer<typeof ListMilestonesResponse>;

export const CreateMilestoneRequest = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(4000).optional(),
  dueAt: z.string().datetime().nullable().optional(),
});
export type CreateMilestoneRequest = z.infer<typeof CreateMilestoneRequest>;

export const RejectMilestoneRequest = z.object({
  reason: z.string().min(1).max(2000),
});
export type RejectMilestoneRequest = z.infer<typeof RejectMilestoneRequest>;

export const MilestoneResponse = z.object({
  milestone: Milestone,
});
export type MilestoneResponse = z.infer<typeof MilestoneResponse>;

export const CommentKind = z.enum(['comment', 'change_request', 'architecture_decision']);
export type CommentKind = z.infer<typeof CommentKind>;

export const Comment = z.object({
  id: z.string(),
  engagementId: z.string(),
  tenantId: z.string(),
  runId: z.string().nullable(),
  authorUserId: z.string().nullable(),
  body: z.string(),
  kind: CommentKind,
  at: z.string(),
});
export type Comment = z.infer<typeof Comment>;

export const ListCommentsResponse = z.object({
  comments: z.array(Comment),
});
export type ListCommentsResponse = z.infer<typeof ListCommentsResponse>;

export const CreateCommentRequest = z.object({
  body: z.string().min(1).max(8000),
  kind: CommentKind.optional(),
  runId: z.string().min(1).optional(),
});
export type CreateCommentRequest = z.infer<typeof CreateCommentRequest>;

export const CommentResponse = z.object({
  comment: Comment,
});
export type CommentResponse = z.infer<typeof CommentResponse>;
