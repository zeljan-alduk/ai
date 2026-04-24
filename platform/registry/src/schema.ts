/**
 * Zod schema for agent.v1 YAML documents.
 *
 * The schema speaks the on-disk snake_case shape. The loader is responsible
 * for translating snake_case -> camelCase and for producing values that
 * conform to the TS types in `@meridian/types`.
 *
 * Unknown top-level keys (and unknown keys in every nested object) are
 * rejected (`.strict()`) — agents-as-data must not silently drift.
 */

import { CANONICAL_CAPABILITIES } from '@meridian/types';
import { z } from 'zod';

// --- primitives ------------------------------------------------------------

const semverRe = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const semverString = z.string().regex(semverRe, 'must be a valid semver string');

/** Capability tags: canonical list is a hint, custom tags are allowed. */
// TODO(v1): warn (not error) when a non-canonical capability is used.
const capabilityString = z
  .string()
  .min(1)
  .refine((v) => v.length > 0, { message: 'capability must be non-empty' });
void CANONICAL_CAPABILITIES; // referenced so the canonical list is a build-time dep

/** Duration: e.g. "30d", "180d", "24h", "90m", "PT5M". Kept loose on purpose. */
const durationString = z
  .string()
  .regex(/^(?:\d+[smhdw]|P.*)$/, 'must look like "30d" / "24h" / ISO 8601 duration');

// --- sub-schemas -----------------------------------------------------------

const identitySchema = z
  .object({
    name: z
      .string()
      .min(1)
      .regex(/^[a-z0-9][a-z0-9-]*$/, 'kebab-case identifier required'),
    version: semverString,
    description: z.string().min(1),
    owner: z.string().min(1),
    tags: z.array(z.string().min(1)).default([]),
  })
  .strict();

const roleSchema = z
  .object({
    team: z.string().min(1),
    reports_to: z.string().min(1).optional(),
    pattern: z.enum(['supervisor', 'worker', 'pipeline', 'debate', 'subscribe']),
  })
  .strict();

const capabilityClassRefSchema = z
  .object({
    capability_class: z.string().min(1),
  })
  .strict();

const budgetSchema = z
  .object({
    usd_per_run: z.number().nonnegative(),
    /** Soft grace before hard-stop; optional. */
    usd_grace: z.number().nonnegative().optional(),
    tokens_in_max: z.number().int().positive().optional(),
    tokens_out_max: z.number().int().positive().optional(),
  })
  .strict();

const latencySchema = z
  .object({
    p95_ms: z.number().int().positive(),
  })
  .strict();

const decodingSchema = z
  .object({
    mode: z.enum(['free', 'json', 'constrained']),
    temperature: z.number().min(0).max(2).optional(),
    json_schema_ref: z.string().min(1).optional(),
  })
  .strict()
  .refine((v) => (v.mode === 'free' ? v.json_schema_ref === undefined : true), {
    message: 'json_schema_ref only makes sense for mode=json|constrained',
    path: ['json_schema_ref'],
  });

const modelPolicySchema = z
  .object({
    capability_requirements: z.array(capabilityString).default([]),
    privacy_tier: z.enum(['public', 'internal', 'sensitive']),
    primary: capabilityClassRefSchema,
    fallbacks: z.array(capabilityClassRefSchema).default([]),
    budget: budgetSchema,
    latency: latencySchema.optional(),
    decoding: decodingSchema,
  })
  .strict();

const promptSchema = z
  .object({
    system_file: z.string().min(1),
    templates: z.record(z.string(), z.string()).optional(),
    variables: z.record(z.string(), z.string()).optional(),
  })
  .strict();

const mcpToolBindingSchema = z
  .object({
    server: z.string().min(1),
    allow: z.array(z.string().min(1)).min(1),
  })
  .strict();

const nativeToolBindingSchema = z
  .object({
    ref: z.string().min(1),
  })
  .strict();

const toolsSchema = z
  .object({
    mcp: z.array(mcpToolBindingSchema).default([]),
    native: z.array(nativeToolBindingSchema).default([]),
    permissions: z
      .object({
        network: z.enum(['none', 'allowlist', 'full']),
        filesystem: z.enum(['none', 'repo-readonly', 'repo-readwrite', 'full']),
      })
      .strict(),
  })
  .strict();

const memoryScopeEnum = z.enum(['private', 'project', 'org', 'session']);

const memorySchema = z
  .object({
    read: z.array(memoryScopeEnum).default([]),
    write: z.array(memoryScopeEnum).default([]),
    retention: z.record(memoryScopeEnum, durationString).default({}),
  })
  .strict();

const spawnSchema = z
  .object({
    allowed: z.array(z.string().min(1)).default([]),
  })
  .strict();

const escalationRuleSchema = z
  .object({
    condition: z.string().min(1),
    to: z.string().min(1),
  })
  .strict();

/**
 * ADR 0001 writes this as `escalation: { on: [ ... ] }`. We accept either the
 * `on` wrapper or a bare array for forward-compatibility; both normalise to an
 * array in the loader.
 */
const escalationSchema = z.union([
  z.array(escalationRuleSchema),
  z
    .object({
      on: z.array(escalationRuleSchema),
    })
    .strict(),
]);

const subscriptionSchema = z
  .object({
    event: z.string().min(1),
    filter: z.string().min(1).optional(),
  })
  .strict();

const inputsSchema = z
  .object({
    schema_ref: z.string().min(1),
  })
  .strict();

/** Output json_schema is an arbitrary JSON Schema fragment — validated by the engine later. */
const outputEntrySchema = z
  .object({
    json_schema: z.unknown(),
  })
  .strict();

const evalGateSchema = z
  .object({
    required_suites: z
      .array(
        z
          .object({
            suite: z.string().min(1),
            min_score: z.number().min(0).max(1),
          })
          .strict(),
      )
      .default([]),
    must_pass_before_promote: z.boolean(),
  })
  .strict();

// --- top-level -------------------------------------------------------------

export const agentV1YamlSchema = z
  .object({
    apiVersion: z.literal('meridian/agent.v1'),
    kind: z.literal('Agent'),
    identity: identitySchema,
    role: roleSchema,
    model_policy: modelPolicySchema,
    prompt: promptSchema,
    tools: toolsSchema,
    memory: memorySchema,
    spawn: spawnSchema.default({ allowed: [] }),
    escalation: escalationSchema.default([]),
    subscriptions: z.array(subscriptionSchema).default([]),
    inputs: inputsSchema.optional(),
    outputs: z.record(z.string(), outputEntrySchema).optional(),
    eval_gate: evalGateSchema,
  })
  .strict();

export type AgentV1Yaml = z.infer<typeof agentV1YamlSchema>;
