/**
 * @aldo-ai/api-contract
 *
 * Wire-format Zod schemas shared by apps/api (server) and apps/web (client).
 * Adding a field here requires updating both ends. Schemas live in this
 * package so changes are reviewable and impossible to drift between the
 * two surfaces.
 *
 * LLM-agnostic: model-related responses identify providers as opaque
 * strings (`provider`, `model`) — never specific provider enums.
 */

export * from './common.js';
export * from './runs.js';
export * from './runs-compare.js';
export * from './playground.js';
export * from './agents.js';
export * from './models.js';
export * from './debugger.js';
export * from './eval.js';
export * from './secrets.js';
export * from './auth.js';
export * from './design-partners.js';
export * from './billing.js';
export * from './views.js';
export * from './admin.js';
export * from './notifications.js';
export * from './dashboards.js';
export * from './datasets.js';
export * from './annotations.js';
export * from './integrations.js';
export * from './cache.js';
// Wave-16 — per-tenant quotas + custom domains.
export * from './quotas.js';
export * from './domains.js';
