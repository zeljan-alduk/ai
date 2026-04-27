/**
 * `@aldo-ai/integrations` — outbound integration runners + dispatcher.
 *
 * Wave-14C surface:
 *
 *   1. types — `IntegrationKind`, `Integration`, `IntegrationEvent`,
 *      per-kind config schemas (Slack/GitHub/Webhook/Discord), the
 *      `IntegrationRunner` interface, and the `IntegrationEventPayload`
 *      the dispatcher hands to a runner.
 *
 *   2. runners — one module per kind under `runners/`. Each implements
 *      `validateConfig` (used by the API on POST/PUT to reject bad
 *      input) + `dispatch` (used by the dispatcher to actually deliver
 *      the event). Plain `fetch` only — no SDKs.
 *
 *   3. registry — kind → runner lookup. The dispatcher and the API
 *      use this; nobody branches on kind elsewhere.
 *
 *   4. store — `IntegrationStore` interface plus a Postgres impl and
 *      an in-memory test impl. CRUD plus `listEnabledForEvent` (the
 *      dispatcher hot path) plus `markFired` (last-fired-at stamp).
 *
 *   5. dispatcher — `IntegrationDispatcher` fans an event out to all
 *      matching enabled integrations with `Promise.allSettled` + a
 *      per-call 5s timeout. Best-effort; never throws.
 *
 * LLM-agnostic: nothing here references a model provider. Events are
 * platform concepts; the runners format their payloads from generic
 * fields (title, body, link).
 */

export {
  DEFAULT_DISPATCH_TIMEOUT_MS,
  DiscordConfig,
  GithubConfig,
  Integration,
  IntegrationEvent,
  IntegrationEventPayload,
  IntegrationKind,
  SlackConfig,
  WebhookConfig,
  type IntegrationDispatchResult,
  type IntegrationRunner,
} from './types.js';

export { discordRunner } from './runners/discord.js';
export { githubRunner } from './runners/github.js';
export { slackRunner } from './runners/slack.js';
export { signHmacSha256, webhookRunner } from './runners/webhook.js';

export { getRunner, listRunners } from './registry.js';

export {
  InMemoryIntegrationStore,
  PostgresIntegrationStore,
  type CreateIntegrationArgs,
  type IntegrationStore,
  type UpdateIntegrationArgs,
} from './store.js';

export {
  IntegrationDispatcher,
  type DispatchSummary,
  type DispatcherOptions,
} from './dispatcher.js';
