/**
 * Wave-14C — outbound integrations wire types.
 *
 * Additive. The /v1/integrations surface is owners + admins only;
 * members read; viewers cannot see secrets at all (the API redacts
 * the `config` blob for non-admins).
 *
 * Schemas mirror the runners' per-kind config in @aldo-ai/integrations
 * but live here so the web client can validate the form payload before
 * it leaves the browser.
 *
 * LLM-agnostic: nothing here references a model provider. Events are
 * platform concepts (run lifecycle, sweep lifecycle, guards block,
 * budget threshold, invitation received).
 */

import { z } from 'zod';

export const IntegrationKindContract = z.enum([
  'slack',
  'github',
  'webhook',
  'discord',
  // MISSING_PIECES §14-B — approval-from-anywhere channels.
  'telegram',
  'email',
]);
export type IntegrationKindContract = z.infer<typeof IntegrationKindContract>;

export const IntegrationEventContract = z.enum([
  'run_completed',
  'run_failed',
  'sweep_completed',
  'guards_blocked',
  'budget_threshold',
  'invitation_received',
  // §14-B
  'approval_requested',
]);
export type IntegrationEventContract = z.infer<typeof IntegrationEventContract>;

/**
 * Wire envelope for a single integration row.
 *
 * `config` is per-kind. The API redacts secrets (Slack/Discord webhook
 * URLs are returned with the path part replaced by `…`; GitHub tokens
 * are dropped entirely; webhook signing secrets are dropped entirely).
 * Owners/admins can post a fresh config via PUT to rotate it.
 */
export const IntegrationContract = z.object({
  id: z.string(),
  kind: IntegrationKindContract,
  name: z.string(),
  /** Per-kind config — secrets are redacted on read. */
  config: z.record(z.unknown()),
  events: z.array(IntegrationEventContract),
  enabled: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
  lastFiredAt: z.string().nullable(),
});
export type IntegrationContract = z.infer<typeof IntegrationContract>;

export const ListIntegrationsResponse = z.object({
  integrations: z.array(IntegrationContract),
});
export type ListIntegrationsResponse = z.infer<typeof ListIntegrationsResponse>;

export const CreateIntegrationRequest = z.object({
  kind: IntegrationKindContract,
  name: z.string().min(1).max(100),
  /** Validated per-kind by the API via the runner registry. */
  config: z.record(z.unknown()),
  events: z.array(IntegrationEventContract).min(1),
  enabled: z.boolean().default(true),
});
export type CreateIntegrationRequest = z.infer<typeof CreateIntegrationRequest>;

export const UpdateIntegrationRequest = z.object({
  name: z.string().min(1).max(100).optional(),
  config: z.record(z.unknown()).optional(),
  events: z.array(IntegrationEventContract).min(1).optional(),
  enabled: z.boolean().optional(),
});
export type UpdateIntegrationRequest = z.infer<typeof UpdateIntegrationRequest>;

export const IntegrationResponse = z.object({
  integration: IntegrationContract,
});
export type IntegrationResponse = z.infer<typeof IntegrationResponse>;

/**
 * Wire envelope for a synthetic test-fire result. The API runs the
 * integration's runner against a hardcoded sample event and returns
 * whatever the runner reports (status code, error text). Useful for
 * "did my Slack URL actually work" without forcing the operator to
 * trigger a real run.
 */
export const TestFireResponse = z.object({
  ok: z.boolean(),
  statusCode: z.number().int().optional(),
  error: z.string().optional(),
  timedOut: z.boolean().optional(),
});
export type TestFireResponse = z.infer<typeof TestFireResponse>;
