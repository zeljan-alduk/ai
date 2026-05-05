/**
 * MISSING_PIECES §11 / Phase A — synthetic spec for `aldo code`.
 *
 * Distinct from the assistant's `__assistant__` spec (§10): the CLI
 * coding agent runs against a real workspace on the user's disk,
 * defaults to a write-capable tool set (fs.read/write + shell.exec),
 * and gets a higher cycle ceiling because real coding tasks need it.
 *
 * Phase B (TUI shell) reuses this builder; the headless loop and the
 * ink TUI both feed the same spec into the runtime.
 */

import type { AgentSpec, IterationSpec } from '@aldo-ai/types';

export const CLI_CODE_AGENT_NAME = '__cli_code__';
export const CLI_CODE_AGENT_VERSION = '0.1.0';

const DEFAULT_MAX_CYCLES = 50;
const DEFAULT_CONTEXT_WINDOW = 128_000;

/** Fully-qualified tool refs the CLI vouches for. Operators pick a
 *  subset via `--tools`; refs outside this set are silently dropped. */
const ALLOWED_TOOL_REFS: ReadonlySet<string> = new Set([
  'aldo-fs.fs.read',
  'aldo-fs.fs.write',
  'aldo-fs.fs.list',
  'aldo-fs.fs.search',
  'aldo-fs.fs.stat',
  'aldo-fs.fs.mkdir',
  'aldo-shell.shell.exec',
  // Persistent-session shell tools (Wave-CLI follow-up). Same MCP
  // server as shell.exec — exposing the new ones in the default ACL
  // means the agent can `cd` into a subdirectory and have subsequent
  // shell.exec calls inherit it, the way a human shell works.
  'aldo-shell.shell.cd',
  'aldo-shell.shell.pwd',
  'aldo-shell.shell.export',
  'aldo-shell.shell.unset',
  'aldo-shell.shell.env',
]);

/** Default tool set — full coding kit. */
const DEFAULT_TOOL_REFS: readonly string[] = [
  'aldo-fs.fs.read',
  'aldo-fs.fs.write',
  'aldo-fs.fs.list',
  'aldo-fs.fs.mkdir',
  'aldo-shell.shell.exec',
  'aldo-shell.shell.cd',
  'aldo-shell.shell.pwd',
];

export const CLI_CODE_SYSTEM_PROMPT = `You are aldo-code, an autonomous TypeScript engineer running inside the user's terminal.

Loop discipline:
- You're inside an iterative loop with a maxCycles ceiling.
- Each cycle: think briefly, call tools to make progress, observe results, decide next step.
- Don't ramble — every cycle that emits text without calling a tool or terminating is wasted budget.
- When the brief is done (or you can't continue), emit the literal string \`<task-complete>\` so the loop terminates cleanly. Never emit it before you're done.

Tools:
- Use \`aldo-fs.fs.read\` / \`aldo-fs.fs.list\` / \`aldo-fs.fs.search\` / \`aldo-fs.fs.stat\` to inspect the workspace.
- Use \`aldo-fs.fs.write\` / \`aldo-fs.fs.mkdir\` to write code.
- Use \`aldo-shell.shell.exec\` to run typecheck / tests / linters. Prefer \`pnpm typecheck\` and \`pnpm test\` over inventing new commands.

Style:
- Match the surrounding code conventions before introducing new ones.
- Default to small, focused changes. Don't refactor unrequested code.
- When in doubt, READ the existing files first.
`;

export interface BuildCliCodeSpecOpts {
  /** Comma-separated `--tools server.name,server.name` (CLI flag). */
  readonly toolsCsv?: string | undefined;
  /** Override the agent's primary capability class (default reasoning-medium). */
  readonly capabilityClass?: string;
  /** Override iteration limits for tests. */
  readonly iterationOverrides?: Partial<Pick<IterationSpec, 'maxCycles' | 'contextWindow'>>;
  /** Override the system prompt for tests. */
  readonly systemPrompt?: string;
  /**
   * Whether the chosen capability class refuses to fall back to local.
   * Operators who pick `coding-frontier` get NO local fallback so the
   * loop fails fast on tenants without provider keys instead of
   * silently downgrading.
   */
  readonly refuseLocalFallback?: boolean;
}

export interface BuiltCliCodeSpec {
  readonly spec: AgentSpec;
  readonly toolRefs: readonly string[];
}

export function buildCliCodeSpec(opts: BuildCliCodeSpecOpts = {}): BuiltCliCodeSpec {
  const toolRefs = resolveToolRefs(opts.toolsCsv);
  const mcpByServer = new Map<string, string[]>();
  for (const ref of toolRefs) {
    const idx = ref.indexOf('.');
    const server = ref.slice(0, idx);
    const tool = ref.slice(idx + 1);
    const list = mcpByServer.get(server) ?? [];
    list.push(tool);
    mcpByServer.set(server, list);
  }
  const mcp = Array.from(mcpByServer.entries()).map(([server, allow]) => ({
    server,
    allow,
  }));

  const iteration: IterationSpec = {
    maxCycles: opts.iterationOverrides?.maxCycles ?? DEFAULT_MAX_CYCLES,
    contextWindow: opts.iterationOverrides?.contextWindow ?? DEFAULT_CONTEXT_WINDOW,
    summaryStrategy: 'rolling-window',
    terminationConditions: [{ kind: 'text-includes', text: '<task-complete>' }],
  };

  const primaryClass = opts.capabilityClass ?? 'reasoning-medium';
  const fallbacks =
    opts.refuseLocalFallback === true
      ? []
      : [{ capabilityClass: 'local-reasoning' }];

  // Filesystem permission tracks whether write tools are present.
  const hasWriteTool = toolRefs.some(
    (r) => r.endsWith('.fs.write') || r.endsWith('.fs.mkdir'),
  );

  const spec: AgentSpec = {
    apiVersion: 'aldo-ai/agent.v1',
    kind: 'Agent',
    identity: {
      name: CLI_CODE_AGENT_NAME,
      version: CLI_CODE_AGENT_VERSION,
      description: 'CLI coding agent — synthetic per-invocation spec.',
      owner: 'platform@aldo-tech-labs',
      tags: ['cli', 'code', 'iterative', 'synthetic'],
    },
    role: { team: 'platform', pattern: 'worker' },
    modelPolicy: {
      capabilityRequirements: [],
      privacyTier: 'internal',
      primary: { capabilityClass: primaryClass },
      fallbacks,
      // Higher than the assistant's $0.25 cap because real coding
      // tasks burn meaningfully more tokens.
      budget: { usdMax: 2.0, usdGrace: 0.25 },
      decoding: { mode: 'free', temperature: 0.15 },
    },
    prompt: { systemFile: 'inline://cli-code.system.md' },
    tools: {
      mcp,
      native: [],
      permissions: {
        // shell.exec lands in a sandboxed cwd; network is gated by the
        // MCP server's policy spine, not this spec.
        network: 'none',
        filesystem: hasWriteTool ? 'repo-readwrite' : 'repo-readonly',
      },
    },
    memory: { read: [], write: [], retention: {} },
    spawn: { allowed: [] },
    escalation: [],
    subscriptions: [],
    evalGate: { requiredSuites: [], mustPassBeforePromote: false },
    iteration,
  };

  return { spec, toolRefs };
}

/**
 * Pick the active tool set from `--tools` or fall back to defaults.
 * Refs outside `ALLOWED_TOOL_REFS` are silently dropped — same anti-
 * footgun rule the assistant follows.
 */
function resolveToolRefs(csv: string | undefined): readonly string[] {
  if (csv === undefined || csv.trim().length === 0) {
    return DEFAULT_TOOL_REFS;
  }
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of csv.split(',')) {
    const ref = raw.trim();
    if (ref.length === 0) continue;
    if (!ALLOWED_TOOL_REFS.has(ref)) continue;
    if (seen.has(ref)) continue;
    seen.add(ref);
    out.push(ref);
  }
  return out.length > 0 ? out : DEFAULT_TOOL_REFS;
}
