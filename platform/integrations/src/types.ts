/**
 * `@aldo-ai/integrations` — outbound integration types.
 *
 * Wave-14C surface. The runners forward platform-level notification
 * events (run_completed, run_failed, sweep_completed, guards_blocked,
 * budget_threshold, invitation_received) to user-configured external
 * destinations (Slack, GitHub, Discord, generic webhook).
 *
 * The contract here is intentionally side-channel-shaped:
 *
 *   - `Integration` rows live in the `integrations` table (migration
 *     015). Each row binds a `kind` to a `config` JSON blob plus a
 *     subscription list of `IntegrationEvent`s.
 *
 *   - The `IntegrationRunner` interface is what each kind's module in
 *     `runners/<kind>.ts` implements. Runners take an event payload
 *     plus the integration's `config` and dispatch via `fetch`.
 *
 *   - The dispatcher (see `dispatcher.ts`) loads enabled integrations
 *     for a tenant, filters by event kind, and runs every matching
 *     integration with `Promise.allSettled` plus a per-integration
 *     5-second timeout so a slow Slack workspace can't stall a run.
 *
 * LLM-agnostic: nothing in this package references a model provider.
 * Events are platform concepts; the only strings the runner serialises
 * into HTTP payloads come from the platform's own labels (run id,
 * agent name, sweep id).
 */

import { z } from 'zod';

/**
 * The four integration kinds we ship in wave 14. New kinds land by
 * adding a runner module + a literal here + a row in the registry;
 * the wire format never changes when a new kind appears.
 */
export const IntegrationKind = z.enum(['slack', 'github', 'webhook', 'discord']);
export type IntegrationKind = z.infer<typeof IntegrationKind>;

/**
 * The events an integration can subscribe to. These mirror the
 * `notifications` table's kind enum; the dispatcher fans out a single
 * notification emission to all integrations whose `events` array
 * contains the matching kind.
 *
 * Adding a new event here requires: (1) updating @aldo-ai/api-contract
 * NotificationKind, (2) updating each runner's `dispatch` method to
 * format a sensible payload, (3) updating the dispatcher's filter.
 */
export const IntegrationEvent = z.enum([
  'run_completed',
  'run_failed',
  'sweep_completed',
  'guards_blocked',
  'budget_threshold',
  'invitation_received',
]);
export type IntegrationEvent = z.infer<typeof IntegrationEvent>;

/**
 * Integration row as stored in DB / returned by the API.
 *
 * `config` is per-kind (see SlackConfig / GithubConfig / WebhookConfig
 * / DiscordConfig). The DB column is JSONB; the runner narrows it
 * with a Zod parse before dispatch so a malformed row doesn't crash
 * the dispatcher.
 */
export const Integration = z.object({
  id: z.string(),
  tenantId: z.string(),
  kind: IntegrationKind,
  name: z.string(),
  /** Per-kind config blob; runner does the narrow parse. */
  config: z.record(z.unknown()),
  events: z.array(IntegrationEvent),
  enabled: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
  /** ISO timestamp of last successful dispatch; NULL if never fired. */
  lastFiredAt: z.string().nullable(),
});
export type Integration = z.infer<typeof Integration>;

/**
 * The payload the dispatcher hands to a runner. Mirrors what the
 * notification sink emits but adds the two pieces an outbound runner
 * actually needs: a stable web link the receiver can click, and the
 * tenant id (for tenant-scoped audit on the dispatch side).
 */
export const IntegrationEventPayload = z.object({
  event: IntegrationEvent,
  tenantId: z.string(),
  title: z.string(),
  body: z.string(),
  /** Absolute URL the recipient can click to land on the run/sweep. */
  link: z.string().nullable(),
  metadata: z.record(z.unknown()).default({}),
  /** ISO timestamp the source event occurred at. */
  occurredAt: z.string(),
});
export type IntegrationEventPayload = z.infer<typeof IntegrationEventPayload>;

/**
 * Result envelope returned by `IntegrationRunner.dispatch`. The
 * dispatcher cares about `ok` (writes `last_fired_at` on success) and
 * `error` (logs on failure); `statusCode` is informational for the
 * test-fire endpoint so the UI can show "Slack returned 404" verbatim.
 */
export interface IntegrationDispatchResult {
  readonly ok: boolean;
  readonly statusCode?: number;
  readonly error?: string;
  /** Set when the runner aborted on the per-call timeout. */
  readonly timedOut?: boolean;
}

/**
 * Each `runners/<kind>.ts` exports an object of this shape. The
 * dispatcher picks one out of the registry by `kind`.
 */
export interface IntegrationRunner {
  readonly kind: IntegrationKind;
  /**
   * Validate the per-kind config blob. Throws (with a human-readable
   * message) when the blob is malformed; the API uses this from the
   * POST /v1/integrations route to reject bad input before insert.
   */
  validateConfig(config: unknown): void;
  /**
   * Format + send the event. Implementations must NEVER throw — any
   * I/O or shape error returns `{ ok: false, error }`. The dispatcher
   * wraps this in `Promise.allSettled` regardless, but a clean return
   * keeps the error-routing predictable.
   */
  dispatch(
    payload: IntegrationEventPayload,
    config: Record<string, unknown>,
  ): Promise<IntegrationDispatchResult>;
}

// ---------------------------------------------------------------------------
// Per-kind config schemas (re-used by the runners + the API route).
// ---------------------------------------------------------------------------

export const SlackConfig = z.object({
  /** Slack incoming webhook URL. Hostname MUST be hooks.slack.com. */
  webhookUrl: z.string().url(),
  /** Optional channel override (Slack ignores this when the hook is channel-locked). */
  channel: z.string().optional(),
});
export type SlackConfig = z.infer<typeof SlackConfig>;

export const GithubConfig = z.object({
  /** "owner/repo" form. */
  repo: z.string().regex(/^[^/\s]+\/[^/\s]+$/, 'expected owner/repo'),
  /**
   * GitHub PAT with `issues:write` scope. Stored encrypted via the
   * @aldo-ai/secrets path on the API side; the runner receives it
   * already decrypted in `config.token`.
   */
  token: z.string().min(1),
  /** Issue or PR number to comment on (must already exist). */
  issueNumber: z.number().int().positive(),
});
export type GithubConfig = z.infer<typeof GithubConfig>;

export const WebhookConfig = z.object({
  url: z.string().url(),
  /**
   * HMAC signing secret. Receiver verifies the X-Aldo-Signature header
   * via `sha256(secret, body)`. Required so webhook receivers can
   * authenticate outbound requests.
   */
  signingSecret: z.string().min(8),
});
export type WebhookConfig = z.infer<typeof WebhookConfig>;

export const DiscordConfig = z.object({
  /** Discord webhook URL. Hostname MUST be discord.com or discordapp.com. */
  webhookUrl: z.string().url(),
});
export type DiscordConfig = z.infer<typeof DiscordConfig>;

/** Per-call dispatch timeout. The dispatcher applies this uniformly. */
export const DEFAULT_DISPATCH_TIMEOUT_MS = 5_000;
