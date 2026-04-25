import { z } from 'zod';
import { PaginatedMeta, PaginationQuery, PrivacyTier } from './common.js';

export const AgentSummary = z.object({
  name: z.string(),
  owner: z.string(),
  /** Most recent promoted version, or the latest version if none promoted. */
  latestVersion: z.string(),
  /** Whether `latestVersion` is the promoted pointer. */
  promoted: z.boolean(),
  description: z.string(),
  privacyTier: PrivacyTier,
  team: z.string(),
  tags: z.array(z.string()),
});
export type AgentSummary = z.infer<typeof AgentSummary>;

export const ListAgentsQuery = PaginationQuery.extend({
  team: z.string().optional(),
  owner: z.string().optional(),
});
export type ListAgentsQuery = z.infer<typeof ListAgentsQuery>;

export const ListAgentsResponse = z.object({
  agents: z.array(AgentSummary),
  meta: PaginatedMeta,
});
export type ListAgentsResponse = z.infer<typeof ListAgentsResponse>;

export const AgentVersionEntry = z.object({
  version: z.string(),
  promoted: z.boolean(),
  createdAt: z.string(),
});
export type AgentVersionEntry = z.infer<typeof AgentVersionEntry>;

/** AgentDetail intentionally returns the raw spec as `unknown` — the
 *  fully-typed AgentSpec lives in @aldo-ai/types and is too deep for the
 *  contract to mirror. Clients re-validate via @aldo-ai/registry if they
 *  need a typed spec. */
export const AgentDetail = AgentSummary.extend({
  versions: z.array(AgentVersionEntry),
  spec: z.unknown(),
});
export type AgentDetail = z.infer<typeof AgentDetail>;

export const GetAgentResponse = z.object({
  agent: AgentDetail,
});
export type GetAgentResponse = z.infer<typeof GetAgentResponse>;
