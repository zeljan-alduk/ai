/**
 * MISSING_PIECES §11 / Phase B — root ink App for `aldo code --tui`.
 *
 * Layout (top to bottom):
 *   - Conversation pane (entries: user / assistant / tool)
 *   - Status line (phase + cycle + cost)
 *   - Input box
 *
 * Wiring: the parent passes a `runTurn(brief, onEvent, signal)` driver
 * that bridges the runtime to the reducer. The App mounts that driver
 * on each user submit, dispatches `engine-event` actions for every
 * RunEvent, and dispatches `turn-finished` once the iterator settles.
 *
 * State is managed via a useReducer over the pure `reduce` function in
 * `state.ts`; ink only sees the current `TuiState` snapshot.
 */

import { Box, useApp, useInput } from 'ink';
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import type { ApprovalController } from '@aldo-ai/engine';
import type { RunEvent } from '@aldo-ai/types';
import { ApprovalDialog, type DialogSubState } from './components/ApprovalDialog.js';
import { Conversation } from './components/Conversation.js';
import { Input } from './components/Input.js';
import { StatusLine } from './components/StatusLine.js';
import {
  HELP_TEXT,
  parseSlashCommand,
  renderTranscriptMarkdown,
} from './slash-commands.js';
import {
  type Action,
  type TuiState,
  initialState,
  reduce,
} from './state.js';

export interface TurnDriver {
  /**
   * Run one turn. Calls `onEvent` for every RunEvent and resolves
   * with the final `{ ok, output }` once the iterator closes (or
   * rejects on a thrown error). The supplied signal aborts the run
   * mid-flight when Ctrl+C is pressed.
   */
  (
    brief: string,
    onEvent: (ev: RunEvent) => void,
    signal: AbortSignal,
  ): Promise<{ ok: boolean; output: string | null }>;
}

export interface AppProps {
  readonly initialBrief?: string;
  readonly runTurn: TurnDriver;
  /**
   * MISSING_PIECES §11 Phase C — optional ApprovalController.
   * When supplied, the App listens for `[a]/[r]/[v]` keybinds when
   * the reducer's phase is `awaiting-approval` and resolves the
   * pending approval directly (the runtime is in-process, so no API
   * round-trip is needed). When undefined, gated tools fail closed
   * via the engine's synthetic rejection — the dialog still shows
   * but the keybinds are inert.
   */
  readonly approvalController?: ApprovalController;
  /**
   * MISSING_PIECES §11 Phase D — session info surfaced by /model and
   * /tools. Read-only in v0; mutating mid-session would require
   * rebuilding the spec + runtime so it's deferred.
   */
  readonly sessionInfo?: {
    readonly capabilityClass: string;
    readonly toolRefs: readonly string[];
    readonly workspace: string;
    readonly maxCycles: number;
  };
  /**
   * MISSING_PIECES §11 Phase D — save side-effect callback. The App
   * passes the rendered markdown + path; the parent (tui.ts) does
   * the actual fs.writeFileSync. Returns the absolute path written
   * (for the system-info confirmation) or throws on failure.
   */
  readonly onSave?: (path: string, content: string) => Promise<string>;
  /**
   * MISSING_PIECES §11 Phase E — entries to seed the conversation
   * with. Used on `--resume <thread-id>` to hydrate from a saved
   * session sidecar.
   */
  readonly initialEntries?: readonly import('./state.js').Entry[];
  /**
   * MISSING_PIECES §11 Phase E — fired after every state change that
   * a saved session should reflect (turn completion, system info,
   * reset). Receives the latest entry list so the parent can persist
   * it without subscribing to every reducer transition.
   */
  readonly onPersist?: (entries: readonly import('./state.js').Entry[]) => void;
  /**
   * `/diff` side-effect callback. Receives the list of relative paths
   * the agent has touched in this session (derived by walking the
   * conversation entries for tool calls with destructive names). The
   * parent (tui.ts) shells out to `git diff -- <paths>` if there's a
   * git repo at the workspace root, and falls back to a flat list of
   * (path, bytes) otherwise. The returned string is rendered as a
   * system-info entry in the conversation.
   */
  readonly onDiff?: (modifiedPaths: readonly string[]) => Promise<string>;
  /**
   * Current git branch resolved at TUI start, surfaced in the status
   * line. Undefined when the workspace isn't a git repo (the line
   * just omits the ⎇ segment in that case).
   */
  readonly branch?: string;
}

/**
 * Tool names whose successful invocation means a file on disk has
 * been (potentially) modified in this session. Used by `/diff` to
 * derive the path list to feed `git diff` without forcing the agent
 * spec to track them on its side.
 */
const DESTRUCTIVE_TOOL_NAMES: ReadonlySet<string> = new Set([
  'fs.write',
  'fs.delete',
  'fs.move',
  'fs.mkdir',
  'fs.rm',
]);

/**
 * Extract a path argument from a recorded tool call. Best-effort —
 * the typed schema isn't available at this layer (the App sees the
 * raw `args: unknown` from the engine). We pull the first string
 * that looks like a relative path; that matches every aldo-fs tool's
 * shape (`path`, `from`, `to`, `dir`).
 */
function pathFromToolArgs(args: unknown): string | null {
  if (args === null || typeof args !== 'object') return null;
  const obj = args as Record<string, unknown>;
  const direct = obj.path ?? obj.target ?? obj.to ?? obj.dest ?? obj.dir ?? obj.from;
  if (typeof direct === 'string' && direct.length > 0) return direct;
  return null;
}

export function App({
  initialBrief,
  runTurn,
  approvalController,
  sessionInfo,
  onSave,
  onDiff,
  branch,
  initialEntries,
  onPersist,
}: AppProps) {
  const [state, dispatch] = useReducer(reduce, initialState);
  const { exit } = useApp();
  const abortRef = useRef<AbortController | null>(null);
  // Auto-fire the first turn from the positional brief (if supplied).
  const [bootBrief, setBootBrief] = useState<string | undefined>(initialBrief);
  // /plan toggle: when true, the NEXT user turn is wrapped in a
  // planning preamble so the agent drafts a numbered plan without
  // executing tools. /go (or any explicit user input after a /plan
  // turn lands) clears it.
  const [planMode, setPlanMode] = useState(false);

  const stateRef = useRef<TuiState>(state);
  stateRef.current = state;

  // MISSING_PIECES §11 Phase E — hydrate from --resume on first mount.
  const hydratedRef = useRef(false);
  useEffect(() => {
    if (hydratedRef.current) return;
    if (initialEntries !== undefined && initialEntries.length > 0) {
      dispatch({ kind: 'hydrate-entries', entries: initialEntries });
    }
    hydratedRef.current = true;
  }, [initialEntries]);

  // MISSING_PIECES §11 Phase E — persist entries on every change.
  // Runs after every reducer commit; the parent's onPersist is
  // responsible for debouncing if it wants (the JSON sidecar is
  // small enough that we don't bother in v0).
  useEffect(() => {
    if (onPersist === undefined) return;
    if (!hydratedRef.current) return; // skip the pre-hydration mount
    onPersist(state.entries);
  }, [state.entries, onPersist]);

  const startTurn = useCallback(
    (text: string) => {
      // MISSING_PIECES §11 Phase D — intercept slash commands BEFORE
      // they reach the agent. Slash commands are synchronous (mostly)
      // and never spend tokens.
      const slash = parseSlashCommand(text);
      if (slash !== null) {
        switch (slash.kind) {
          case 'help':
            dispatch({ kind: 'system-info', content: HELP_TEXT });
            return;
          case 'clear':
            dispatch({ kind: 'reset-conversation' });
            return;
          case 'exit':
            if (abortRef.current !== null) abortRef.current.abort();
            exit();
            return;
          case 'save': {
            const transcript = renderTranscriptMarkdown(stateRef.current.entries);
            if (onSave === undefined) {
              dispatch({
                kind: 'system-info',
                content: '/save is not wired in this session.',
              });
              return;
            }
            void (async () => {
              try {
                const written = await onSave(slash.path, transcript);
                dispatch({
                  kind: 'system-info',
                  content: `transcript saved to ${written}`,
                });
              } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                dispatch({
                  kind: 'system-info',
                  content: `save failed: ${msg}`,
                });
              }
            })();
            return;
          }
          case 'model':
            dispatch({
              kind: 'system-info',
              content:
                sessionInfo === undefined
                  ? 'no session info available.'
                  : `capability_class: ${sessionInfo.capabilityClass}\n` +
                    'mid-session swap is not yet supported — restart with --capability-class <id>.',
            });
            return;
          case 'tools':
            dispatch({
              kind: 'system-info',
              content:
                sessionInfo === undefined
                  ? 'no session info available.'
                  : 'active tools:\n  · ' +
                    sessionInfo.toolRefs.join('\n  · ') +
                    '\nmid-session change is not yet supported — restart with --tools <list>.',
            });
            return;
          case 'diff': {
            // Derive the list of modified paths from the recorded
            // tool calls in this session. Best-effort: we trust the
            // tool name allowlist to mean "this tool wrote bytes to
            // disk" and pull the first path-shaped string out of the
            // recorded args. Duplicates are deduped.
            const modified = new Set<string>();
            for (const e of stateRef.current.entries) {
              if (e.kind !== 'tool') continue;
              if (!DESTRUCTIVE_TOOL_NAMES.has(e.name)) continue;
              const p = pathFromToolArgs(e.args);
              if (p !== null) modified.add(p);
            }
            const paths = [...modified];
            if (onDiff === undefined) {
              dispatch({
                kind: 'system-info',
                content: `${paths.length} file(s) touched this session:\n  · ${
                  paths.join('\n  · ') || '(none)'
                }\n\n/diff handler not wired in this session.`,
              });
              return;
            }
            void (async () => {
              try {
                const out = await onDiff(paths);
                dispatch({ kind: 'system-info', content: out });
              } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                dispatch({ kind: 'system-info', content: `diff failed: ${msg}` });
              }
            })();
            return;
          }
          case 'plan':
            setPlanMode(true);
            dispatch({
              kind: 'system-info',
              content:
                'plan mode: ON. Next message drafts a numbered plan; tool calls are refused.\n' +
                '/go to leave plan mode and execute.',
            });
            return;
          case 'go':
            if (!planMode) {
              dispatch({
                kind: 'system-info',
                content: '/go is a no-op outside plan mode. Send a regular message to act.',
              });
              return;
            }
            setPlanMode(false);
            dispatch({
              kind: 'system-info',
              content: 'plan mode: OFF. Next message executes with the full tool ACL.',
            });
            return;
          case 'unknown':
            dispatch({
              kind: 'system-info',
              content: `unknown command: ${slash.raw}\nrun /help for the list.`,
            });
            return;
        }
      }

      // /plan augments the brief with a planning preamble. The flag
      // clears once this turn lands so a follow-up message defaults
      // back to the executing system prompt.
      const plannedText = planMode
        ? `[PLAN MODE — DO NOT CALL TOOLS THIS TURN]\n\nDraft a numbered plan that covers what you would do. Do not call any tools, do not modify any files. Finish with the literal token <PLAN_END> on its own line so the user can confirm with /go.\n\nUser brief:\n${text}`
        : text;
      // Show the user's actual typed text in the transcript, not the
      // planning-augmented version — the augmentation is invisible
      // scaffolding that just shapes the LLM's response.
      dispatch({ kind: 'user-input', text });
      const turnText = plannedText;
      const ac = new AbortController();
      abortRef.current = ac;
      void (async () => {
        try {
          const result = await runTurn(
            turnText,
            (ev) => dispatch({ kind: 'engine-event', event: ev }),
            ac.signal,
          );
          dispatch({
            kind: 'turn-finished',
            ok: result.ok,
            output: result.output,
          });
          // Auto-clear plan mode after the planning turn lands so the
          // next message defaults back to executing semantics.
          if (planMode) setPlanMode(false);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          dispatch({
            kind: 'engine-event',
            event: { type: 'error', at: new Date().toISOString(), payload: { message: msg } },
          });
          dispatch({ kind: 'turn-finished', ok: false, output: null });
        } finally {
          abortRef.current = null;
        }
      })();
    },
    [runTurn, exit, onSave, onDiff, sessionInfo, planMode],
  );

  useEffect(() => {
    if (typeof bootBrief === 'string' && bootBrief.length > 0) {
      startTurn(bootBrief);
      setBootBrief(undefined);
    }
  }, [bootBrief, startTurn]);

  const onAbort = useCallback(() => {
    if (abortRef.current !== null) {
      abortRef.current.abort();
    }
  }, []);

  const onExit = useCallback(() => {
    if (abortRef.current !== null) abortRef.current.abort();
    exit();
  }, [exit]);

  // MISSING_PIECES §11 Phase C — approval-dialog state machine. When
  // the reducer surfaces an `awaiting-approval` phase, the App
  // listens for keybinds and routes the decision back to the
  // ApprovalController. The dialog sub-state tracks the
  // choose/viewing/rejecting modes locally because the choice is a
  // UI concern, not a reducer one.
  const [dialogSub, setDialogSub] = useState<DialogSubState>({ kind: 'choose' });
  const awaitingApproval =
    state.phase.kind === 'awaiting-approval' ? state.phase : null;

  // Reset the dialog sub-state every time a new pending approval
  // arrives (keyed by callId so consecutive approvals don't reuse
  // an in-progress reject draft).
  useEffect(() => {
    if (awaitingApproval !== null) {
      setDialogSub({ kind: 'choose' });
    }
  }, [awaitingApproval?.callId]);

  useInput(
    (input, key) => {
      if (awaitingApproval === null || approvalController === undefined) return;
      if (dialogSub.kind === 'rejecting') {
        if (key.escape) {
          setDialogSub({ kind: 'choose' });
          return;
        }
        if (key.return) {
          const reason = dialogSub.reasonDraft.trim();
          if (reason.length === 0) return;
          approvalController.resolve(awaitingApproval.runId, awaitingApproval.callId, {
            kind: 'rejected',
            approver: 'cli-user',
            reason,
          });
          // The next engine event (synthetic tool_result) will flip
          // the phase back to running.
          setDialogSub({ kind: 'choose' });
          return;
        }
        if (key.backspace || key.delete) {
          setDialogSub({
            kind: 'rejecting',
            reasonDraft: dialogSub.reasonDraft.slice(0, -1),
          });
          return;
        }
        if (input.length > 0 && !key.ctrl && !key.meta) {
          setDialogSub({
            kind: 'rejecting',
            reasonDraft: dialogSub.reasonDraft + input,
          });
        }
        return;
      }

      // choose / viewing keybinds
      if (input === 'a' || input === 'A') {
        approvalController.resolve(awaitingApproval.callId, awaitingApproval.callId, {
          kind: 'approved',
          approver: 'cli-user',
        });
        setDialogSub({ kind: 'choose' });
        return;
      }
      if (input === 'r' || input === 'R') {
        setDialogSub({ kind: 'rejecting', reasonDraft: '' });
        return;
      }
      if (input === 'v' || input === 'V') {
        setDialogSub((cur) =>
          cur.kind === 'viewing' ? { kind: 'choose' } : { kind: 'viewing' },
        );
      }
    },
    { isActive: awaitingApproval !== null },
  );

  const busy = isBusy(state);

  return (
    <Box flexDirection="column">
      <Conversation entries={state.entries} />
      {awaitingApproval !== null ? (
        <ApprovalDialog phase={awaitingApproval} subState={dialogSub} />
      ) : null}
      <StatusLine
        phase={state.phase}
        telemetry={state.telemetry}
        {...(branch !== undefined ? { branch } : {})}
        planMode={planMode}
      />
      <Input disabled={busy} onSubmit={startTurn} onAbort={onAbort} onExit={onExit} />
    </Box>
  );
}

function isBusy(state: TuiState): boolean {
  return (
    state.phase.kind === 'running' ||
    state.phase.kind === 'compressing' ||
    state.phase.kind === 'awaiting-approval'
  );
}

// Re-exported so tests can drive the reducer + render pure snapshots.
export { initialState, reduce };
export type { Action, TuiState };
