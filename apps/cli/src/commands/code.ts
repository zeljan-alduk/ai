/**
 * MISSING_PIECES §11 / Phase A — `aldo code [brief]` headless subcommand.
 *
 * The headless mode proves the wiring before any pixels: synthetic
 * AgentSpec, real fs/shell tool host, runtime drives the iterative
 * loop, RunEvents stream to stdout as JSON-Lines. Phase B replaces
 * stdout with the ink TUI; the same code-spec + tool-host plug into
 * both.
 *
 * Flow:
 *   1. Read the brief from positional arg or stdin.
 *   2. Build synthetic spec (`buildCliCodeSpec`) + a registry shim
 *      that returns it.
 *   3. Bootstrap the runtime with the registry override + the local
 *      tool host confined to `--workspace` (default cwd).
 *   4. Call `runtime.runAgent(...)` and stream RunEvents to stdout
 *      as JSONL until the loop terminates.
 *   5. Exit 0 on success, 1 on any error.
 */

import { resolve as resolvePath } from 'node:path';
import type {
  AgentRef,
  AgentRegistry as AgentRegistryIface,
  AgentSpec,
  RunEvent,
  ValidationResult,
} from '@aldo-ai/types';
import { type RuntimeBundle, bootstrap } from '../bootstrap.js';
import { loadConfig } from '../config.js';
import type { CliIO } from '../io.js';
import { writeErr, writeLine } from '../io.js';
import {
  CLI_CODE_AGENT_NAME,
  CLI_CODE_SYSTEM_PROMPT,
  buildCliCodeSpec,
} from './code-spec.js';
import { CliCodeToolHost } from './code-tool-host.js';

export interface CodeOptions {
  /** Comma-separated `--tools server.name,server.name`. */
  readonly tools?: string;
  /** Workspace root the tool host confines to. Defaults to CWD. */
  readonly workspace?: string;
  /** Override the primary capability class (default reasoning-medium). */
  readonly capabilityClass?: string;
  /** Override iteration max-cycles. */
  readonly maxCycles?: number;
  /** Override iteration context window. */
  readonly contextWindow?: number;
  /** Refuse to fall back to local-reasoning (e.g. for coding-frontier). */
  readonly noLocalFallback?: boolean;
  /** Read the brief from stdin instead of the positional arg. */
  readonly stdin?: boolean;
  /**
   * MISSING_PIECES §11 / Phase B — interactive TUI mode. When true,
   * the command boots the ink-based shell instead of streaming JSONL
   * to stdout. The brief (if supplied) auto-fires as the first turn;
   * subsequent turns come from user input.
   */
  readonly tui?: boolean;
  /**
   * MISSING_PIECES §11 / Phase E — resume an existing TUI session
   * by threadId. Only honored when --tui is set.
   */
  readonly resumeThreadId?: string;
}

export interface CodeHooks {
  /** Test seam: replace bootstrap (gateway/runtime). */
  readonly bootstrap?: typeof bootstrap;
  /** Test seam: replace the loadConfig source. */
  readonly loadConfig?: typeof loadConfig;
  /** Test seam: pre-resolved brief instead of reading stdin / argv. */
  readonly brief?: string;
}

let injectedHooks: CodeHooks | null = null;

/** Test hook: install code-command hooks. Pass `null` to reset. */
export function setCodeHooks(hooks: CodeHooks | null): void {
  injectedHooks = hooks;
}

export async function runCode(
  brief: string | undefined,
  opts: CodeOptions,
  io: CliIO,
  hooksArg: CodeHooks = {},
): Promise<number> {
  const hooks: CodeHooks = injectedHooks ?? hooksArg;

  // --- 0. TUI mode short-circuit ----------------------------------------
  if (opts.tui === true) {
    const { startTui } = await import('./code/tui.js');
    const initialBrief = await resolveBrief(brief, opts.stdin === true, hooks);
    return startTui(
      {
        ...(opts.tools !== undefined ? { tools: opts.tools } : {}),
        ...(opts.workspace !== undefined ? { workspace: opts.workspace } : {}),
        ...(opts.capabilityClass !== undefined ? { capabilityClass: opts.capabilityClass } : {}),
        ...(opts.maxCycles !== undefined ? { maxCycles: opts.maxCycles } : {}),
        ...(opts.contextWindow !== undefined ? { contextWindow: opts.contextWindow } : {}),
        noLocalFallback: opts.noLocalFallback === true,
        ...(initialBrief !== null ? { initialBrief } : {}),
        ...(opts.resumeThreadId !== undefined ? { resumeThreadId: opts.resumeThreadId } : {}),
      },
      io,
      {
        ...(hooks.bootstrap !== undefined ? { bootstrap: hooks.bootstrap } : {}),
        ...(hooks.loadConfig !== undefined ? { loadConfig: hooks.loadConfig } : {}),
      },
    );
  }

  // --- 1. Brief ----------------------------------------------------------
  const briefText = await resolveBrief(brief, opts.stdin === true, hooks);
  if (briefText === null) {
    writeErr(io, 'error: a brief is required (positional arg or --stdin)');
    return 1;
  }

  // --- 2. Workspace ------------------------------------------------------
  const workspaceRoot = resolvePath(opts.workspace ?? process.cwd());

  // --- 3. Spec + registry shim ------------------------------------------
  const built = buildCliCodeSpec({
    ...(opts.tools !== undefined ? { toolsCsv: opts.tools } : {}),
    ...(opts.capabilityClass !== undefined ? { capabilityClass: opts.capabilityClass } : {}),
    iterationOverrides: {
      ...(opts.maxCycles !== undefined ? { maxCycles: opts.maxCycles } : {}),
      ...(opts.contextWindow !== undefined ? { contextWindow: opts.contextWindow } : {}),
    },
    ...(opts.noLocalFallback === true ? { refuseLocalFallback: true } : {}),
  });

  const registryShim: AgentRegistryIface = {
    async load(ref: AgentRef): Promise<AgentSpec> {
      if (ref.name !== CLI_CODE_AGENT_NAME) {
        throw new Error(`aldo code only knows the synthetic spec; got ref: ${ref.name}`);
      }
      return built.spec;
    },
    validate(_yaml: string): ValidationResult {
      return { ok: true, errors: [] };
    },
    async list(): Promise<AgentRef[]> {
      return [{ name: CLI_CODE_AGENT_NAME, version: built.spec.identity.version }];
    },
    async promote(): Promise<void> {
      /* no-op; the synthetic spec is never promoted */
    },
  };

  // --- 4. Bootstrap ------------------------------------------------------
  const cfg = (hooks.loadConfig ?? loadConfig)();
  let bundle: RuntimeBundle;
  try {
    bundle = (hooks.bootstrap ?? bootstrap)({
      config: cfg,
      agentRegistryOverride: registryShim,
      toolHost: new CliCodeToolHost({ root: workspaceRoot }),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    writeErr(io, `error: bootstrap failed: ${msg}`);
    return 1;
  }

  // --- 5. Drive the run + stream RunEvents to stdout --------------------
  writeLine(
    io,
    JSON.stringify({
      kind: 'session.start',
      agent: CLI_CODE_AGENT_NAME,
      workspace: workspaceRoot,
      tools: built.toolRefs,
      maxCycles: built.spec.iteration?.maxCycles,
    }),
  );

  let okExit = true;
  try {
    const run = await bundle.runtime.runAgent(
      { name: CLI_CODE_AGENT_NAME },
      {
        messages: [{ role: 'user', content: briefText }],
        systemPrompt: CLI_CODE_SYSTEM_PROMPT,
      },
    );

    for await (const ev of run.events()) {
      writeLine(io, JSON.stringify({ kind: 'event', event: serialiseEvent(ev) }));
      if (ev.type === 'error') okExit = false;
    }

    // Wait for the run's own deferred to settle so we can include the
    // final ok/output in the closing frame.
    const internal = run as unknown as {
      wait?: () => Promise<{ ok: boolean; output: unknown }>;
    };
    if (typeof internal.wait === 'function') {
      const r = await internal.wait();
      writeLine(
        io,
        JSON.stringify({
          kind: 'session.end',
          ok: r.ok,
          output: typeof r.output === 'string' ? r.output : null,
        }),
      );
      if (!r.ok) okExit = false;
    } else {
      writeLine(io, JSON.stringify({ kind: 'session.end', ok: okExit }));
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    writeErr(io, `error: run failed: ${msg}`);
    return 1;
  }

  return okExit ? 0 : 1;
}

/** Pull the brief from the positional arg, hooks (test seam), or stdin. */
async function resolveBrief(
  positional: string | undefined,
  fromStdin: boolean,
  hooks: CodeHooks,
): Promise<string | null> {
  if (typeof hooks.brief === 'string' && hooks.brief.length > 0) return hooks.brief;
  if (typeof positional === 'string' && positional.trim().length > 0) {
    return positional.trim();
  }
  if (fromStdin) return readStdin();
  return null;
}

async function readStdin(): Promise<string | null> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : (chunk as Buffer));
  }
  const text = Buffer.concat(chunks).toString('utf8').trim();
  return text.length > 0 ? text : null;
}

/**
 * Trim the RunEvent payload before emitting to stdout. We keep the
 * structural fields (cycle, kind, etc.) but truncate large blobs
 * (file contents, full args) so a JSONL frame stays readable in a
 * terminal scrollback. The replay UI on /runs/<id> has the full
 * payload via the run store.
 */
function serialiseEvent(ev: RunEvent): { type: string; at: string; payload: unknown } {
  const payload = ev.payload;
  if (payload === null || typeof payload !== 'object') {
    return { type: ev.type, at: ev.at, payload };
  }
  // Cap any string fields > 2KB.
  const trimmed = JSON.parse(JSON.stringify(payload, (_k, v) =>
    typeof v === 'string' && v.length > 2048 ? `${v.slice(0, 2048)}…[truncated]` : v,
  ));
  return { type: ev.type, at: ev.at, payload: trimmed };
}
