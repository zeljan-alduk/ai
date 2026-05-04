/**
 * MISSING_PIECES §10 / Phase A — synthetic AgentSpec for the assistant.
 *
 * The assistant chat panel is not a YAML-defined agent — it's part of
 * the platform itself. To run it on `IterativeAgentRun` without a
 * special-case branch in the engine, we build an `AgentSpec` at
 * request time. The shape is identical to a `agent.v1` YAML on disk;
 * the runtime can't tell the difference.
 *
 * Tool ACL: the assistant is implicitly cross-tenant code (same code
 * runs for every tenant), so we DEFAULT to a strict read-only set:
 *   - aldo-fs.fs.read / fs.list / fs.search / fs.stat
 *
 * Operators opt INTO write/exec capabilities via the `ASSISTANT_TOOLS`
 * env (comma-separated tool refs). Non-default tools (fs.write,
 * shell.exec) require an explicit env entry — implicit privilege
 * escalation isn't available.
 */

import type { AgentSpec, IterationSpec } from '@aldo-ai/types';

/** Chat turns are short; 12 cycles handles the longest reasonable
 *  tool-using exchange without overspending on a stuck loop. */
const DEFAULT_MAX_CYCLES = 12;
const DEFAULT_CONTEXT_WINDOW = 128_000;

export const ASSISTANT_AGENT_NAME = '__assistant__';
export const ASSISTANT_AGENT_VERSION = '0.1.0';

export const ASSISTANT_SYSTEM_PROMPT = `You are the ALDO AI assistant.

You help users navigate and operate the ALDO control plane. You can answer
questions about agents, runs, prompts, evaluators, the gateway, privacy
tiers, MCP servers, and how to use the platform. You can also call the
read-only filesystem tools that are wired into your tool set to inspect
the user's workspace when it helps answer their question.

Honesty rules:
- If you don't know something specific to the user's tenant (their runs,
  agents, prompts), say so — don't guess.
- If something on the platform is documented as planned-but-not-yet,
  say "that's planned" and point at the roadmap.
- Keep replies short and direct. Default to 2-4 sentences. Expand when
  asked.

Loop discipline:
- You're running inside an iterative loop with a maxCycles ceiling.
- When you've answered the user's question (or determined you can't),
  emit the literal string \`<turn-complete>\` so the loop terminates
  cleanly. Don't emit it before you're done.
- If you call a tool, INSPECT the result before deciding whether to
  call another tool or finish.
`;

/** Default tool allowlist — read-only filesystem inspection. */
const DEFAULT_TOOLS: ReadonlyArray<{ readonly server: string; readonly tool: string }> = [
  { server: 'aldo-fs', tool: 'fs.read' },
  { server: 'aldo-fs', tool: 'fs.list' },
  { server: 'aldo-fs', tool: 'fs.search' },
  { server: 'aldo-fs', tool: 'fs.stat' },
];

/** Tools we'll ALSO recognise via the env override. Adding to this
 *  list is the explicit path to giving the assistant write/exec
 *  capabilities — operators opt in per deployment. */
const ALLOWED_OVERRIDE_TOOLS: ReadonlySet<string> = new Set([
  'aldo-fs.fs.read',
  'aldo-fs.fs.list',
  'aldo-fs.fs.search',
  'aldo-fs.fs.stat',
  'aldo-fs.fs.write',
  'aldo-fs.fs.mkdir',
  'aldo-shell.shell.exec',
]);

export interface BuildAssistantSpecOpts {
  /** Tenant the spec will run under. Surfaced on the spec for replay. */
  readonly tenantId: string;
  /**
   * Comma-separated list of fully-qualified tool refs (`server.tool`).
   * When set, OVERRIDES the default read-only allowlist. Refs not in
   * `ALLOWED_OVERRIDE_TOOLS` are silently dropped — the assistant must
   * not be able to escalate to an arbitrary MCP server by env.
   */
  readonly toolsEnv?: string | undefined;
  /** Override the system prompt for tests / per-deployment tweaks. */
  readonly systemPrompt?: string;
  /** Override iteration limits for tests. */
  readonly iterationOverrides?: Partial<Pick<IterationSpec, 'maxCycles' | 'contextWindow'>>;
}

export interface BuiltAssistantSpec {
  readonly spec: AgentSpec;
  /** Resolved tool refs the spec advertises (read-side convenience for tests). */
  readonly toolRefs: readonly string[];
}

export function buildAssistantAgentSpec(opts: BuildAssistantSpecOpts): BuiltAssistantSpec {
  const tools = resolveTools(opts.toolsEnv);
  const mcpByServer = new Map<string, string[]>();
  for (const t of tools) {
    const list = mcpByServer.get(t.server) ?? [];
    list.push(t.tool);
    mcpByServer.set(t.server, list);
  }
  const mcp = Array.from(mcpByServer.entries()).map(([server, allow]) => ({
    server,
    allow,
  }));

  const iteration: IterationSpec = {
    maxCycles: opts.iterationOverrides?.maxCycles ?? DEFAULT_MAX_CYCLES,
    contextWindow: opts.iterationOverrides?.contextWindow ?? DEFAULT_CONTEXT_WINDOW,
    summaryStrategy: 'rolling-window',
    terminationConditions: [{ kind: 'text-includes', text: '<turn-complete>' }],
  };

  const spec: AgentSpec = {
    apiVersion: 'aldo-ai/agent.v1',
    kind: 'Agent',
    identity: {
      name: ASSISTANT_AGENT_NAME,
      version: ASSISTANT_AGENT_VERSION,
      description: 'Platform assistant chat panel — synthetic per-request spec.',
      owner: 'platform@aldo-tech-labs',
      tags: ['assistant', 'platform', 'synthetic'],
    },
    role: {
      team: 'platform',
      pattern: 'worker',
    },
    modelPolicy: {
      capabilityRequirements: [],
      privacyTier: 'internal',
      primary: { capabilityClass: 'reasoning-medium' },
      fallbacks: [{ capabilityClass: 'local-reasoning' }],
      budget: { usdMax: 0.25, usdGrace: 0.05 },
      decoding: { mode: 'free', temperature: 0.2 },
    },
    prompt: {
      systemFile: 'inline://assistant.system.md',
      // Inlining the prompt body via `variables.system_prompt` would
      // require engine changes; the engine reads `prompt.systemFile`
      // and renders a placeholder. For Phase B we'll hand the prompt
      // through the seed-message pipeline instead — see route swap.
    },
    tools: {
      mcp,
      native: [],
      permissions: {
        // Network egress depends on the chosen tools. Read-only fs is
        // local-only; we keep network=none and let operators flip via
        // a future env when they enable cloud-egress tools. Filesystem
        // permission tracks the broadest tool's needs.
        network: 'none',
        filesystem: tools.some((t) => t.tool.startsWith('fs.write') || t.tool === 'fs.mkdir')
          ? 'repo-readwrite'
          : 'repo-readonly',
      },
    },
    memory: { read: [], write: [], retention: {} },
    spawn: { allowed: [] },
    escalation: [],
    subscriptions: [],
    evalGate: { requiredSuites: [], mustPassBeforePromote: false },
    iteration,
  };

  // tenantId is captured for replay scoping; the engine will write it
  // on the run row via the existing tenant context.
  void opts.tenantId;

  return {
    spec,
    toolRefs: tools.map((t) => `${t.server}.${t.tool}`),
  };
}

/**
 * Pick the active tool set from the env override or the default
 * read-only allowlist. Refs that aren't in `ALLOWED_OVERRIDE_TOOLS`
 * are silently dropped so a typo or a hostile env can't expand the
 * assistant's surface beyond what the platform vouches for.
 */
function resolveTools(
  env: string | undefined,
): ReadonlyArray<{ readonly server: string; readonly tool: string }> {
  if (env === undefined || env.trim().length === 0) {
    return DEFAULT_TOOLS;
  }
  const parsed: Array<{ readonly server: string; readonly tool: string }> = [];
  const seen = new Set<string>();
  for (const raw of env.split(',')) {
    const ref = raw.trim();
    if (ref.length === 0) continue;
    if (!ALLOWED_OVERRIDE_TOOLS.has(ref)) continue;
    if (seen.has(ref)) continue;
    seen.add(ref);
    const idx = ref.indexOf('.');
    if (idx <= 0) continue;
    parsed.push({ server: ref.slice(0, idx), tool: ref.slice(idx + 1) });
  }
  // Empty allowlist after filtering → fall back to defaults rather
  // than silently disabling all tools. Operators who want zero tools
  // need a future explicit `ASSISTANT_TOOLS=none` (out of scope).
  if (parsed.length === 0) return DEFAULT_TOOLS;
  return parsed;
}

declare module '../deps.js' {
  interface Env {
    /** MISSING_PIECES §10 — explicit allowlist for the assistant agent's tool set. */
    readonly ASSISTANT_TOOLS?: string;
  }
}
