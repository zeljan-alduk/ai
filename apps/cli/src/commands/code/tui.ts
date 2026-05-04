/**
 * MISSING_PIECES §11 / Phase B — TUI entry point.
 *
 * Wires the synthetic spec + runtime + tool host (same as the headless
 * mode in code.ts) into a TurnDriver and renders the ink App.
 *
 * Lives in a `.ts` file rather than `.tsx` so the dynamic-import shim
 * stays simple — the actual ink render call lives in app-render.tsx
 * and is loaded at runtime so non-interactive callers (e.g. CI) never
 * pull in the React + ink graph.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve as resolvePath } from 'node:path';
import { InMemoryApprovalController } from '@aldo-ai/engine';
import type {
  AgentRef,
  AgentRegistry as AgentRegistryIface,
  AgentSpec,
  RunEvent,
  ValidationResult,
} from '@aldo-ai/types';
import { type RuntimeBundle, bootstrap } from '../../bootstrap.js';
import { loadConfig } from '../../config.js';
import type { CliIO } from '../../io.js';
import { writeErr, writeLine } from '../../io.js';
import {
  CLI_CODE_AGENT_NAME,
  CLI_CODE_SYSTEM_PROMPT,
  buildCliCodeSpec,
} from '../code-spec.js';
import { CliCodeToolHost } from '../code-tool-host.js';
import {
  SessionNotFoundError,
  loadSession,
  newThreadId,
  saveSession,
} from './persistence.js';
import type { Entry } from './state.js';

export interface TuiOptions {
  readonly tools?: string;
  readonly workspace?: string;
  readonly capabilityClass?: string;
  readonly maxCycles?: number;
  readonly contextWindow?: number;
  readonly noLocalFallback?: boolean;
  /** Optional initial brief; auto-fired by the App on mount. */
  readonly initialBrief?: string;
  /**
   * MISSING_PIECES §11 Phase E — resume an existing session by
   * threadId. The App hydrates from the saved sidecar; subsequent
   * turns are persisted under the same threadId.
   */
  readonly resumeThreadId?: string;
}

export interface TuiHooks {
  readonly bootstrap?: typeof bootstrap;
  readonly loadConfig?: typeof loadConfig;
}

/** Build a TurnDriver bound to a fresh per-session runtime + spec. */
export async function startTui(
  opts: TuiOptions,
  io: CliIO,
  hooks: TuiHooks = {},
): Promise<number> {
  const workspaceRoot = resolvePath(opts.workspace ?? process.cwd());
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
        throw new Error(`aldo code TUI only knows the synthetic spec; got: ${ref.name}`);
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
      /* no-op */
    },
  };

  const cfg = (hooks.loadConfig ?? loadConfig)();
  // MISSING_PIECES §11 Phase C — per-session approval controller.
  // Tool calls whose spec marks them `tools.approvals: always` will
  // suspend the loop here; the App resolves them via keybinds.
  const approvalController = new InMemoryApprovalController();
  let bundle: RuntimeBundle;
  try {
    bundle = (hooks.bootstrap ?? bootstrap)({
      config: cfg,
      agentRegistryOverride: registryShim,
      toolHost: new CliCodeToolHost({ root: workspaceRoot }),
      approvalController,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    writeErr(io, `error: bootstrap failed: ${msg}`);
    return 1;
  }

  // Build a TurnDriver: each user submit kicks a runtime.runAgent.
  // The App tracks a multi-turn conversation and feeds the FULL
  // history into each subsequent runAgent call so the model sees
  // prior turns. We accumulate locally rather than relying on the
  // engine's run-store (Phase E lands true persistence).
  const history: Array<{ role: 'user' | 'assistant'; content: string }> = [];

  const runTurn = async (
    brief: string,
    onEvent: (ev: RunEvent) => void,
    signal: AbortSignal,
  ): Promise<{ ok: boolean; output: string | null }> => {
    const turnHistory = [...history, { role: 'user' as const, content: brief }];
    const run = await bundle.runtime.runAgent(
      { name: CLI_CODE_AGENT_NAME },
      { messages: turnHistory, systemPrompt: CLI_CODE_SYSTEM_PROMPT },
    );

    // Wire abort: the runtime honors signal via the inner AbortController
    // on the run; for v0 we forward by calling cancel() when fired.
    const onAbort = (): void => {
      void run.cancel('user pressed Ctrl+C').catch(() => undefined);
    };
    signal.addEventListener('abort', onAbort);

    let assistantText = '';
    try {
      for await (const ev of run.events()) {
        onEvent(ev);
        if (ev.type === 'message') {
          const text = readAssistantText(ev.payload);
          if (text !== null) assistantText = text;
        }
      }
    } finally {
      signal.removeEventListener('abort', onAbort);
    }

    const internal = run as unknown as {
      wait?: () => Promise<{ ok: boolean; output: unknown }>;
    };
    const final = await (internal.wait?.() ?? Promise.resolve({ ok: true, output: null }));
    history.push({ role: 'user', content: brief });
    if (assistantText.length > 0) {
      history.push({ role: 'assistant', content: assistantText });
    }
    return {
      ok: final.ok,
      output: typeof final.output === 'string' ? final.output : null,
    };
  };

  // MISSING_PIECES §11 Phase D — slash command side-effect bridges.
  const onSave = async (path: string, content: string): Promise<string> => {
    const target = isAbsolute(path) ? path : resolvePath(workspaceRoot, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
    return target;
  };

  const sessionInfo = {
    capabilityClass: built.spec.modelPolicy.primary.capabilityClass,
    toolRefs: built.toolRefs,
    workspace: workspaceRoot,
    maxCycles: built.spec.iteration?.maxCycles ?? 0,
  };

  // MISSING_PIECES §11 Phase E — session persistence.
  const threadId = opts.resumeThreadId ?? newThreadId();
  let initialEntries: readonly Entry[] = [];
  let createdAt: string | undefined;
  if (opts.resumeThreadId !== undefined) {
    try {
      const record = loadSession(opts.resumeThreadId);
      initialEntries = record.entries;
      createdAt = record.createdAt;
      writeLine(io, `[aldo code] resumed thread ${threadId} (${initialEntries.length} entries)`);
    } catch (err) {
      if (err instanceof SessionNotFoundError) {
        writeErr(io, `error: no saved session for thread-id ${opts.resumeThreadId}`);
        return 1;
      }
      const msg = err instanceof Error ? err.message : String(err);
      writeErr(io, `error: failed to load session: ${msg}`);
      return 1;
    }
  } else {
    writeLine(io, `[aldo code] new session · thread-id ${threadId}`);
    writeLine(io, `[aldo code] resume later with: aldo code --tui --resume ${threadId}`);
  }

  const onPersist = (entries: readonly Entry[]): void => {
    try {
      saveSession({
        threadId,
        workspace: workspaceRoot,
        entries,
        ...(createdAt !== undefined ? { createdAt } : {}),
      });
    } catch (err) {
      // Persistence is best-effort; never crash the TUI on a save
      // failure. The user still has the in-memory conversation.
      const msg = err instanceof Error ? err.message : String(err);
      writeErr(io, `[aldo code] warning: session persist failed: ${msg}`);
    }
  };

  // Lazy-load the ink renderer so non-TUI callers never pay the cost.
  const { mountTui } = await import('./app-render.js');
  await mountTui({
    runTurn,
    approvalController,
    sessionInfo,
    onSave,
    onPersist,
    initialEntries,
    ...(opts.initialBrief !== undefined ? { initialBrief: opts.initialBrief } : {}),
  });
  return 0;
}

function readAssistantText(payload: unknown): string | null {
  if (payload === null || typeof payload !== 'object') return null;
  const m = payload as {
    role?: string;
    content?: ReadonlyArray<{ type?: string; text?: string }>;
  };
  if (m.role !== 'assistant' || !Array.isArray(m.content)) return null;
  const text = m.content
    .filter((p) => p?.type === 'text' && typeof p.text === 'string')
    .map((p) => p.text as string)
    .join('');
  return text.length > 0 ? text : null;
}
