/**
 * Wave-4 (Tier-4) — prompts as first-class entities.
 *
 * Closes the Vellum (entire product) + LangSmith Hub gap. Prompts get
 * a versioned, diffable, playground-runnable surface that's
 * disconnected from any individual agent spec — the same prompt body
 * can power multiple agents via the additive `promptRef` slot on the
 * agent spec (see `agents.ts`).
 *
 * LLM-agnostic: every prompt version carries an abstract
 * `modelCapability` string (e.g. `frontier-reasoning`, `fast`,
 * `local-only`). The /test endpoint goes through the model gateway
 * which resolves the capability against the live router. No provider
 * names appear in this contract.
 *
 * Variable substitution: prompt bodies use `{{variable_name}}`
 * placeholders. The /test endpoint substitutes from the supplied
 * variables map; missing variables raise a 422 with a friendly
 * message (the playground UI highlights the offending field).
 */

import { z } from 'zod';

// ─────────────────────────────────────────── Variable schema

/** Supported scalar/structural types for a prompt variable. */
export const PromptVariableType = z.enum(['string', 'number', 'boolean', 'object', 'array']);
export type PromptVariableType = z.infer<typeof PromptVariableType>;

/**
 * NOTE on `.default()` discipline: we deliberately AVOID Zod
 * `.default()` on the wire shapes for prompt variables. `.default()`
 * makes the input optional but the output required, which causes a
 * subtle type-distortion in the typed fetch client (the inferred
 * response type ends up matching the input shape, not the output).
 * Required + nullable carries the same intent without the asymmetry.
 */
export const PromptVariable = z.object({
  name: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/, {
      message: 'variable name must be a valid identifier (letters, digits, underscores)',
    }),
  type: PromptVariableType,
  description: z.string().max(500).optional(),
  /** When true, /test rejects the call if the variable is absent. */
  required: z.boolean(),
});
export type PromptVariable = z.infer<typeof PromptVariable>;

export const PromptVariablesSchema = z.object({
  variables: z.array(PromptVariable),
});
export type PromptVariablesSchema = z.infer<typeof PromptVariablesSchema>;

// ─────────────────────────────────────────── Prompt + version wire shapes

/**
 * Header row — the per-tenant/per-project named prompt entity. The
 * detail endpoint also returns the latest version so the client can
 * render the body without a second round-trip.
 */
export const Prompt = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  /**
   * Project the prompt is scoped to within the tenant. Nullish so
   * pre-retrofit clients (and any in-flight insert from code paths
   * predating migration 024) round-trip cleanly. Server resolves a
   * missing value to the tenant's Default project at write time.
   */
  projectId: z.string().nullish(),
  /** 0 means the prompt has no versions yet (transient state during create). */
  latestVersion: z.number().int().nonnegative(),
  /**
   * Abstract capability class on the LATEST version (denormalised so
   * the list cards can show a badge without joining versions).
   */
  modelCapability: z.string(),
  createdBy: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Prompt = z.infer<typeof Prompt>;

export const PromptVersion = z.object({
  id: z.string(),
  promptId: z.string(),
  version: z.number().int().positive(),
  body: z.string(),
  variablesSchema: PromptVariablesSchema,
  modelCapability: z.string(),
  /** Set when this version was forked from another (otherwise null on the linear path). */
  parentVersionId: z.string().nullable(),
  notes: z.string(),
  createdBy: z.string(),
  createdAt: z.string(),
});
export type PromptVersion = z.infer<typeof PromptVersion>;

/** Detail response — the prompt header + its latest version (for editor warm-start). */
export const PromptDetail = Prompt.extend({
  /** Latest version snapshot; null only when latestVersion === 0 (no versions yet). */
  latest: PromptVersion.nullable(),
});
export type PromptDetail = z.infer<typeof PromptDetail>;

// ─────────────────────────────────────────── List / read responses

export const ListPromptsResponse = z.object({
  prompts: z.array(Prompt),
});
export type ListPromptsResponse = z.infer<typeof ListPromptsResponse>;

export const GetPromptResponse = z.object({
  prompt: PromptDetail,
});
export type GetPromptResponse = z.infer<typeof GetPromptResponse>;

export const ListPromptVersionsResponse = z.object({
  versions: z.array(PromptVersion),
});
export type ListPromptVersionsResponse = z.infer<typeof ListPromptVersionsResponse>;

export const GetPromptVersionResponse = z.object({
  version: PromptVersion,
});
export type GetPromptVersionResponse = z.infer<typeof GetPromptVersionResponse>;

// ─────────────────────────────────────────── Mutations

export const CreatePromptRequest = z.object({
  name: z
    .string()
    .min(1)
    .max(160)
    .regex(/^[a-z][a-z0-9-]*$/, {
      message: 'name must be lowercase kebab-case',
    }),
  description: z.string().max(2000).default(''),
  /** Body of the inaugural version. */
  body: z.string().min(1).max(64_000),
  variablesSchema: PromptVariablesSchema.optional(),
  modelCapability: z.string().min(1).max(120).default('reasoning-medium'),
  /** Optional project SLUG. Server resolves to project_id; missing → Default. */
  project: z.string().min(1).optional(),
  /** Optional initial commit message; defaults to "initial version". */
  notes: z.string().max(2000).optional(),
});
export type CreatePromptRequest = z.infer<typeof CreatePromptRequest>;

export const UpdatePromptRequest = z.object({
  name: z
    .string()
    .min(1)
    .max(160)
    .regex(/^[a-z][a-z0-9-]*$/, {
      message: 'name must be lowercase kebab-case',
    })
    .optional(),
  description: z.string().max(2000).optional(),
  /** Move the prompt into a different project (slug). */
  project: z.string().min(1).optional(),
});
export type UpdatePromptRequest = z.infer<typeof UpdatePromptRequest>;

export const CreatePromptVersionRequest = z.object({
  body: z.string().min(1).max(64_000),
  variablesSchema: PromptVariablesSchema.optional(),
  modelCapability: z.string().min(1).max(120).optional(),
  /** Author's "why this version" message. Mandatory at the application layer. */
  notes: z.string().min(1).max(2000),
  /** Optional fork point; if set, the new version's parent is this version id. */
  parentVersionId: z.string().min(1).optional(),
});
export type CreatePromptVersionRequest = z.infer<typeof CreatePromptVersionRequest>;

// ─────────────────────────────────────────── Diff

export const PromptDiffLineKind = z.enum(['added', 'removed', 'unchanged']);
export type PromptDiffLineKind = z.infer<typeof PromptDiffLineKind>;

export const PromptDiffLine = z.object({
  kind: PromptDiffLineKind,
  text: z.string(),
});
export type PromptDiffLine = z.infer<typeof PromptDiffLine>;

export const PromptDiffResponse = z.object({
  fromVersion: z.number().int().positive(),
  toVersion: z.number().int().positive(),
  lines: z.array(PromptDiffLine),
  stats: z.object({
    added: z.number().int().nonnegative(),
    removed: z.number().int().nonnegative(),
    unchanged: z.number().int().nonnegative(),
  }),
});
export type PromptDiffResponse = z.infer<typeof PromptDiffResponse>;

// ─────────────────────────────────────────── Test (playground)

/**
 * Playground request body. The `variables` map is keyed by the variable
 * names declared in the prompt's `variables_schema`. Values can be any
 * JSON value; the substitution layer stringifies non-string values.
 *
 * `capabilityOverride` lets the playground compare against a different
 * capability class than the one the prompt declares (e.g. run a
 * `frontier-reasoning` prompt against `fast` to see the cost/quality
 * tradeoff). The override is per-call; it never mutates the version.
 *
 * `version` (optional) pins the run to a specific version; defaults to
 * the prompt's `latestVersion`.
 */
export const PromptTestRequest = z.object({
  variables: z.record(z.unknown()).default({}),
  capabilityOverride: z.string().min(1).max(120).optional(),
  version: z.number().int().positive().optional(),
});
export type PromptTestRequest = z.infer<typeof PromptTestRequest>;

export const PromptTestResponse = z.object({
  version: z.number().int().positive(),
  /** Resolved body after substitution. */
  resolvedBody: z.string(),
  /** Model output (text). */
  output: z.string(),
  /** Opaque model identifier the gateway picked. */
  model: z.string(),
  /** Capability class actually used (echoes either the prompt's or the override). */
  capabilityUsed: z.string(),
  tokensIn: z.number().int().nonnegative(),
  tokensOut: z.number().int().nonnegative(),
  costUsd: z.number().nonnegative(),
  latencyMs: z.number().int().nonnegative(),
});
export type PromptTestResponse = z.infer<typeof PromptTestResponse>;
