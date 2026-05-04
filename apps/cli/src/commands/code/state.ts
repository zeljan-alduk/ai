/**
 * MISSING_PIECES §11 / Phase B — pure reducer for the `aldo code` TUI.
 *
 * The reducer consumes engine `RunEvent`s + user actions and produces
 * a UI-shaped `TuiState`. Pure — no I/O, no React — so:
 *   - the headless mode in code.ts can reuse the same shape if it ever
 *     wants pretty output;
 *   - tests assert state transitions without mounting ink;
 *   - the ink components in components/* are dumb renderers fed from
 *     this state.
 *
 * The chronological invariant — "user → tool calls → assistant text" —
 * lives here, not in the React tree. The reducer inserts tool entries
 * BEFORE any in-flight assistant placeholder, mirroring the assistant
 * panel's rule from MISSING_PIECES §10.
 */

import type { RunEvent, ToolCallPart } from '@aldo-ai/types';

export interface UserEntry {
  readonly kind: 'user';
  readonly content: string;
}

export interface AssistantEntry {
  readonly kind: 'assistant';
  readonly content: string;
  readonly streaming: boolean;
}

export interface ToolEntry {
  readonly kind: 'tool';
  readonly callId: string;
  readonly name: string;
  readonly args: unknown;
  /** Result is `undefined` while the call is in-flight. */
  readonly result: unknown | undefined;
  readonly isError: boolean;
}

/**
 * MISSING_PIECES §11 / Phase D — slash-command output. Distinct from
 * `assistant` entries so the renderer can dim them and so the
 * markdown transcript exporter can label them as `### system`.
 */
export interface SystemEntry {
  readonly kind: 'system';
  readonly content: string;
}

export type Entry = UserEntry | AssistantEntry | ToolEntry | SystemEntry;

export interface TelemetryRollup {
  readonly tokensIn: number;
  readonly tokensOut: number;
  readonly usd: number;
  readonly model: string | null;
}

/** Termination state surfaced on the status line. */
export type RunPhase =
  | { readonly kind: 'idle' }
  | { readonly kind: 'running'; readonly cycle: number; readonly maxCycles: number | null }
  | {
      readonly kind: 'compressing';
      readonly cycle: number;
      readonly strategy: string;
    }
  | {
      readonly kind: 'awaiting-approval';
      readonly runId: string;
      readonly callId: string;
      readonly tool: string;
      readonly args: unknown;
      /** Agent's stated reason from the model's tool_call args, if any. */
      readonly reason: string | null;
    }
  | {
      readonly kind: 'completed';
      readonly cycles: number;
      readonly terminatedBy: string | null;
    }
  | {
      readonly kind: 'errored';
      readonly message: string;
    };

export interface TuiState {
  readonly entries: readonly Entry[];
  readonly phase: RunPhase;
  readonly telemetry: TelemetryRollup;
  /** Last error surfaced from a `error` event. Cleared on the next user turn. */
  readonly lastError: string | null;
}

export const initialState: TuiState = {
  entries: [],
  phase: { kind: 'idle' },
  telemetry: { tokensIn: 0, tokensOut: 0, usd: 0, model: null },
  lastError: null,
};

/** Discrete actions the TUI can dispatch. */
export type Action =
  | { readonly kind: 'user-input'; readonly text: string }
  | { readonly kind: 'engine-event'; readonly event: RunEvent }
  | { readonly kind: 'turn-finished'; readonly ok: boolean; readonly output: string | null }
  | { readonly kind: 'reset-conversation' }
  /** MISSING_PIECES §11 / Phase D — append a system info entry. */
  | { readonly kind: 'system-info'; readonly content: string }
  /**
   * MISSING_PIECES §11 / Phase E — replace the entry list with a
   * persisted snapshot. Used on `aldo code --resume <thread-id>` to
   * hydrate the App from a saved session sidecar. Phase resets to
   * idle because the resumed session is not actively running.
   */
  | { readonly kind: 'hydrate-entries'; readonly entries: readonly Entry[] };

/** Apply one action; produce the next state. Pure. */
export function reduce(state: TuiState, action: Action): TuiState {
  switch (action.kind) {
    case 'user-input':
      return startUserTurn(state, action.text);
    case 'engine-event':
      return applyEngineEvent(state, action.event);
    case 'turn-finished':
      return finishTurn(state, action.ok, action.output);
    case 'reset-conversation':
      return { ...initialState };
    case 'system-info':
      return {
        ...state,
        entries: [...state.entries, { kind: 'system', content: action.content }],
      };
    case 'hydrate-entries':
      return {
        ...initialState,
        entries: action.entries,
      };
  }
}

function startUserTurn(state: TuiState, text: string): TuiState {
  const trimmed = text.trim();
  if (trimmed.length === 0) return state;
  const userEntry: UserEntry = { kind: 'user', content: trimmed };
  const placeholder: AssistantEntry = {
    kind: 'assistant',
    content: '',
    streaming: true,
  };
  return {
    ...state,
    entries: [...state.entries, userEntry, placeholder],
    phase: { kind: 'running', cycle: 0, maxCycles: null },
    lastError: null,
  };
}

function applyEngineEvent(state: TuiState, event: RunEvent): TuiState {
  switch (event.type) {
    case 'cycle.start': {
      const p = event.payload as { cycle?: number; maxCycles?: number } | null;
      return {
        ...state,
        phase: {
          kind: 'running',
          cycle: typeof p?.cycle === 'number' ? p.cycle : 0,
          maxCycles: typeof p?.maxCycles === 'number' ? p.maxCycles : null,
        },
      };
    }
    case 'history.compressed': {
      const p = event.payload as { cycle?: number; strategy?: string } | null;
      return {
        ...state,
        phase: {
          kind: 'compressing',
          cycle: typeof p?.cycle === 'number' ? p.cycle : 0,
          strategy: typeof p?.strategy === 'string' ? p.strategy : 'rolling-window',
        },
      };
    }
    case 'message': {
      const text = readAssistantText(event.payload);
      if (text === null) return state;
      return updateStreamingAssistant(state, text);
    }
    case 'tool_call': {
      const tc = event.payload as ToolCallPart;
      return insertToolEntry(state, {
        kind: 'tool',
        callId: tc.callId,
        name: tc.tool,
        args: tc.args,
        result: undefined,
        isError: false,
      });
    }
    case 'tool_result': {
      const p = event.payload as
        | { callId?: string; result?: unknown; isError?: boolean }
        | null;
      if (p === null || typeof p.callId !== 'string') return state;
      return resolveToolEntry(state, p.callId, p.result, p.isError === true);
    }
    case 'tool.pending_approval': {
      const p = event.payload as
        | {
            runId?: string;
            callId?: string;
            tool?: string;
            args?: unknown;
            reason?: string | null;
          }
        | null;
      if (
        p === null ||
        typeof p.runId !== 'string' ||
        typeof p.callId !== 'string' ||
        typeof p.tool !== 'string'
      ) {
        return state;
      }
      return {
        ...state,
        phase: {
          kind: 'awaiting-approval',
          runId: p.runId,
          callId: p.callId,
          tool: p.tool,
          args: p.args,
          reason: typeof p.reason === 'string' ? p.reason : null,
        },
      };
    }
    case 'tool.approval_resolved': {
      // The next event in the stream (tool_result for approve, synthesised
      // tool_result for reject) will flip phase back to running. Don't
      // duplicate the work here.
      return state;
    }
    case 'usage' as RunEvent['type']: {
      const u = event.payload as {
        tokensIn?: number;
        tokensOut?: number;
        usd?: number;
        model?: string;
      };
      return {
        ...state,
        telemetry: {
          tokensIn: state.telemetry.tokensIn + (u.tokensIn ?? 0),
          tokensOut: state.telemetry.tokensOut + (u.tokensOut ?? 0),
          usd: state.telemetry.usd + (u.usd ?? 0),
          model: typeof u.model === 'string' ? u.model : state.telemetry.model,
        },
      };
    }
    case 'run.terminated_by': {
      // Phase will land via the subsequent run.completed/cancelled.
      return state;
    }
    case 'error': {
      const p = event.payload as { message?: string; reason?: string } | null;
      const msg = p?.message ?? p?.reason ?? 'unknown error';
      return {
        ...state,
        phase: { kind: 'errored', message: msg },
        lastError: msg,
      };
    }
    default:
      return state;
  }
}

function finishTurn(state: TuiState, ok: boolean, output: string | null): TuiState {
  // Drop the streaming flag on the trailing placeholder. If the run
  // produced a final string output (the loop's terminator), use it
  // when the placeholder is empty (e.g. tool-only cycles before
  // termination).
  const last = state.entries[state.entries.length - 1];
  let entries: Entry[] = [...state.entries];
  if (last && last.kind === 'assistant' && last.streaming) {
    entries[entries.length - 1] = {
      ...last,
      content: last.content.length > 0 ? last.content : output ?? '',
      streaming: false,
    };
  }
  // Find the latest cycle observed for the completed-phase summary.
  const cycles = (() => {
    if (state.phase.kind === 'running') return state.phase.cycle;
    if (state.phase.kind === 'compressing') return state.phase.cycle;
    return 0;
  })();
  const phase: RunPhase = ok
    ? { kind: 'completed', cycles, terminatedBy: null }
    : { kind: 'errored', message: state.lastError ?? 'run failed' };
  return { ...state, entries, phase };
}

// ─── helpers (exported for tests) ──────────────────────────────────

export function updateStreamingAssistant(state: TuiState, accText: string): TuiState {
  const last = state.entries[state.entries.length - 1];
  if (!last || last.kind !== 'assistant' || !last.streaming) return state;
  // Append the new text to the existing content. Engine emits one
  // `message` event per cycle with the FULL accumulated text for that
  // cycle (the loop pushes the message after streaming the response),
  // but a multi-cycle run produces multiple messages. We append with
  // a separator if the existing content was non-empty.
  const next: AssistantEntry = {
    ...last,
    content: last.content.length > 0 ? `${last.content}\n${accText}` : accText,
  };
  return {
    ...state,
    entries: [...state.entries.slice(0, -1), next],
  };
}

export function insertToolEntry(state: TuiState, tool: ToolEntry): TuiState {
  const last = state.entries[state.entries.length - 1];
  if (!last || last.kind !== 'assistant' || !last.streaming) {
    return { ...state, entries: [...state.entries, tool] };
  }
  return {
    ...state,
    entries: [...state.entries.slice(0, -1), tool, last],
  };
}

export function resolveToolEntry(
  state: TuiState,
  callId: string,
  result: unknown,
  isError: boolean,
): TuiState {
  let touched = false;
  const entries = state.entries.map((e) => {
    if (e.kind !== 'tool') return e;
    if (e.callId !== callId) return e;
    touched = true;
    return { ...e, result, isError };
  });
  if (!touched) {
    // Synthesise an entry with no prior tool_call (e.g. when the
    // engine emits a synthetic rejection). Insert before placeholder.
    return insertToolEntry(state, {
      kind: 'tool',
      callId,
      name: 'unknown',
      args: null,
      result,
      isError,
    });
  }
  return { ...state, entries };
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
