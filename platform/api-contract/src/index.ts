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
export * from './agents.js';
export * from './models.js';
