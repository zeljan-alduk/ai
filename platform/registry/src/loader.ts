/**
 * YAML -> AgentSpec loader.
 *
 * Responsibilities:
 *  - parse YAML text into a JS object,
 *  - run the Zod schema (`agent.v1` snake_case),
 *  - transform snake_case -> camelCase so the result matches the
 *    `AgentSpec` interface in `@aldo-ai/types`.
 *
 * Errors are reported with the original snake_case path so authors can find
 * the offending key in their YAML file without translation.
 */

import { readFile } from 'node:fs/promises';
import type {
  AgentSpec,
  CompositeSpec,
  CompositeSubagent,
  EscalationRule,
  EvalGate,
  IterationSpec,
  IterationTerminationCondition,
  MemoryPolicy,
  MemoryScope,
  ModelPolicy,
  PromptConfig,
  SandboxConfig,
  SpawnPolicy,
  Subscription,
  TerminationConfig,
  ToolsConfig,
  ToolsGuardsConfig,
  ValidationResult,
} from '@aldo-ai/types';
import YAML from 'yaml';
import { type AgentV1Yaml, agentV1YamlSchema } from './schema.js';

export interface LoadOk {
  readonly ok: true;
  readonly spec: AgentSpec;
}
export interface LoadErr {
  readonly ok: false;
  readonly errors: readonly { readonly path: string; readonly message: string }[];
}
export type LoadOutcome = LoadOk | LoadErr;

/** Parse YAML text and translate to an `AgentSpec`. Returns a `ValidationResult`. */
export function parseYaml(yamlText: string): ValidationResult {
  let raw: unknown;
  try {
    raw = YAML.parse(yamlText);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, errors: [{ path: '$', message: `yaml parse error: ${msg}` }] };
  }

  if (raw === null || typeof raw !== 'object') {
    return {
      ok: false,
      errors: [{ path: '$', message: 'document root must be a mapping' }],
    };
  }

  const parsed = agentV1YamlSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map((i) => ({
        path: i.path.length === 0 ? '$' : i.path.map(String).join('.'),
        message: i.message,
      })),
    };
  }

  return { ok: true, spec: toAgentSpec(parsed.data), errors: [] };
}

/** Read a YAML file from disk and parse it. */
export async function loadFromFile(path: string): Promise<LoadOutcome> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, errors: [{ path: '$', message: `read error: ${msg}` }] };
  }
  const res = parseYaml(text);
  if (!res.ok || !res.spec) {
    return { ok: false, errors: res.errors };
  }
  return { ok: true, spec: res.spec };
}

// --- snake_case -> camelCase transform -------------------------------------

function toAgentSpec(y: AgentV1Yaml): AgentSpec {
  const modelPolicy: ModelPolicy = {
    capabilityRequirements: y.model_policy.capability_requirements,
    privacyTier: y.model_policy.privacy_tier,
    primary: { capabilityClass: y.model_policy.primary.capability_class },
    fallbacks: y.model_policy.fallbacks.map((f) => ({ capabilityClass: f.capability_class })),
    budget: {
      usdMax: y.model_policy.budget.usd_per_run,
      usdGrace: y.model_policy.budget.usd_grace ?? 0,
      ...(y.model_policy.budget.tokens_in_max !== undefined
        ? { tokensInMax: y.model_policy.budget.tokens_in_max }
        : {}),
      ...(y.model_policy.budget.tokens_out_max !== undefined
        ? { tokensOutMax: y.model_policy.budget.tokens_out_max }
        : {}),
      ...(y.model_policy.latency !== undefined
        ? { latencyP95Ms: y.model_policy.latency.p95_ms }
        : {}),
    },
    decoding: {
      mode: y.model_policy.decoding.mode,
      ...(y.model_policy.decoding.temperature !== undefined
        ? { temperature: y.model_policy.decoding.temperature }
        : {}),
      ...(y.model_policy.decoding.json_schema_ref !== undefined
        ? { jsonSchemaRef: y.model_policy.decoding.json_schema_ref }
        : {}),
    },
  };

  const prompt: PromptConfig = {
    systemFile: y.prompt.system_file,
    ...(y.prompt.templates !== undefined ? { templates: y.prompt.templates } : {}),
    ...(y.prompt.variables !== undefined ? { variables: y.prompt.variables } : {}),
  };

  const guards: ToolsGuardsConfig | undefined =
    y.tools.guards !== undefined
      ? {
          ...(y.tools.guards.spotlighting !== undefined
            ? { spotlighting: y.tools.guards.spotlighting }
            : {}),
          ...(y.tools.guards.output_scanner !== undefined
            ? {
                outputScanner: {
                  ...(y.tools.guards.output_scanner.enabled !== undefined
                    ? { enabled: y.tools.guards.output_scanner.enabled }
                    : {}),
                  ...(y.tools.guards.output_scanner.severity_block !== undefined
                    ? { severityBlock: y.tools.guards.output_scanner.severity_block }
                    : {}),
                  ...(y.tools.guards.output_scanner.url_allowlist !== undefined
                    ? { urlAllowlist: y.tools.guards.output_scanner.url_allowlist }
                    : {}),
                },
              }
            : {}),
          ...(y.tools.guards.quarantine !== undefined
            ? {
                quarantine: {
                  ...(y.tools.guards.quarantine.enabled !== undefined
                    ? { enabled: y.tools.guards.quarantine.enabled }
                    : {}),
                  ...(y.tools.guards.quarantine.capability_class !== undefined
                    ? { capabilityClass: y.tools.guards.quarantine.capability_class }
                    : {}),
                  ...(y.tools.guards.quarantine.threshold_chars !== undefined
                    ? { thresholdChars: y.tools.guards.quarantine.threshold_chars }
                    : {}),
                },
              }
            : {}),
        }
      : undefined;

  const tools: ToolsConfig = {
    mcp: y.tools.mcp.map((m) => ({ server: m.server, allow: m.allow })),
    native: y.tools.native.map((n) => ({ ref: n.ref })),
    permissions: {
      network: y.tools.permissions.network,
      filesystem: y.tools.permissions.filesystem,
    },
    ...(guards !== undefined ? { guards } : {}),
    // MISSING_PIECES #9 — pass through per-tool approval policy.
    ...(y.tools.approvals !== undefined ? { approvals: y.tools.approvals } : {}),
  };

  const memory: MemoryPolicy = {
    read: y.memory.read as readonly MemoryScope[],
    write: y.memory.write as readonly MemoryScope[],
    retention: y.memory.retention as Readonly<Partial<Record<MemoryScope, string>>>,
  };

  const spawn: SpawnPolicy = { allowed: y.spawn.allowed };

  const escalationArr: readonly EscalationRule[] = Array.isArray(y.escalation)
    ? y.escalation
    : y.escalation.on;

  const subscriptions: readonly Subscription[] = y.subscriptions.map((s) => ({
    event: s.event,
    ...(s.filter !== undefined ? { filter: s.filter } : {}),
  }));

  const evalGate: EvalGate = {
    requiredSuites: y.eval_gate.required_suites.map((r) => ({
      suite: r.suite,
      minScore: r.min_score,
    })),
    mustPassBeforePromote: y.eval_gate.must_pass_before_promote,
  };

  const outputs =
    y.outputs !== undefined
      ? Object.fromEntries(
          Object.entries(y.outputs).map(([k, v]) => [k, { jsonSchema: v.json_schema }]),
        )
      : undefined;

  const composite: CompositeSpec | undefined =
    y.composite !== undefined
      ? {
          strategy: y.composite.strategy,
          subagents: y.composite.subagents.map(
            (s): CompositeSubagent => ({
              agent: s.agent,
              ...(s.as !== undefined ? { as: s.as } : {}),
              ...(s.input_map !== undefined ? { inputMap: s.input_map } : {}),
            }),
          ),
          ...(y.composite.aggregator !== undefined ? { aggregator: y.composite.aggregator } : {}),
          ...(y.composite.iteration !== undefined
            ? {
                iteration: {
                  maxRounds: y.composite.iteration.max_rounds,
                  terminate: y.composite.iteration.terminate,
                },
              }
            : {}),
        }
      : undefined;

  const termination: TerminationConfig | undefined =
    y.termination !== undefined
      ? {
          ...(y.termination.max_turns !== undefined ? { maxTurns: y.termination.max_turns } : {}),
          ...(y.termination.max_usd !== undefined ? { maxUsd: y.termination.max_usd } : {}),
          ...(y.termination.text_mention !== undefined
            ? { textMention: y.termination.text_mention }
            : {}),
          ...(y.termination.success_roles !== undefined
            ? { successRoles: y.termination.success_roles }
            : {}),
        }
      : undefined;

  const iteration: IterationSpec | undefined =
    y.iteration !== undefined
      ? {
          maxCycles: y.iteration.max_cycles,
          contextWindow: y.iteration.context_window,
          summaryStrategy: y.iteration.summary_strategy,
          terminationConditions: y.iteration.termination_conditions.map(
            (c): IterationTerminationCondition => {
              switch (c.kind) {
                case 'text-includes':
                  return { kind: 'text-includes', text: c.text };
                case 'tool-result':
                  return {
                    kind: 'tool-result',
                    tool: c.tool,
                    match: {
                      ...(c.match.exit_code !== undefined ? { exitCode: c.match.exit_code } : {}),
                      ...(c.match.contains !== undefined ? { contains: c.match.contains } : {}),
                    },
                  };
                case 'budget-exhausted':
                  return { kind: 'budget-exhausted' };
              }
            },
          ),
        }
      : undefined;

  const sandbox: SandboxConfig | undefined =
    y.sandbox !== undefined
      ? {
          ...(y.sandbox.timeout_ms !== undefined ? { timeoutMs: y.sandbox.timeout_ms } : {}),
          ...(y.sandbox.env_scrub !== undefined ? { envScrub: y.sandbox.env_scrub } : {}),
          ...(y.sandbox.network !== undefined
            ? {
                network: {
                  mode: y.sandbox.network.mode,
                  ...(y.sandbox.network.allowed_hosts !== undefined
                    ? { allowedHosts: y.sandbox.network.allowed_hosts }
                    : {}),
                },
              }
            : {}),
          ...(y.sandbox.filesystem !== undefined
            ? {
                filesystem: {
                  permission: y.sandbox.filesystem.permission,
                  ...(y.sandbox.filesystem.read_paths !== undefined
                    ? { readPaths: y.sandbox.filesystem.read_paths }
                    : {}),
                  ...(y.sandbox.filesystem.write_paths !== undefined
                    ? { writePaths: y.sandbox.filesystem.write_paths }
                    : {}),
                },
              }
            : {}),
        }
      : undefined;

  const spec: AgentSpec = {
    apiVersion: 'aldo-ai/agent.v1',
    kind: 'Agent',
    identity: {
      name: y.identity.name,
      version: y.identity.version,
      description: y.identity.description,
      owner: y.identity.owner,
      tags: y.identity.tags,
    },
    role: {
      team: y.role.team,
      ...(y.role.reports_to !== undefined ? { reportsTo: y.role.reports_to } : {}),
      pattern: y.role.pattern,
    },
    modelPolicy,
    prompt,
    tools,
    memory,
    spawn,
    escalation: escalationArr,
    subscriptions,
    ...(y.inputs !== undefined ? { inputs: { schemaRef: y.inputs.schema_ref } } : {}),
    ...(outputs !== undefined ? { outputs } : {}),
    evalGate,
    ...(sandbox !== undefined ? { sandbox } : {}),
    ...(composite !== undefined ? { composite } : {}),
    ...(termination !== undefined ? { termination } : {}),
    ...(iteration !== undefined ? { iteration } : {}),
  };

  return spec;
}
