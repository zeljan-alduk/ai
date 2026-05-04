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
}

export function App({
  initialBrief,
  runTurn,
  approvalController,
  sessionInfo,
  onSave,
}: AppProps) {
  const [state, dispatch] = useReducer(reduce, initialState);
  const { exit } = useApp();
  const abortRef = useRef<AbortController | null>(null);
  // Auto-fire the first turn from the positional brief (if supplied).
  const [bootBrief, setBootBrief] = useState<string | undefined>(initialBrief);

  const stateRef = useRef<TuiState>(state);
  stateRef.current = state;

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
          case 'unknown':
            dispatch({
              kind: 'system-info',
              content: `unknown command: ${slash.raw}\nrun /help for the list.`,
            });
            return;
        }
      }

      dispatch({ kind: 'user-input', text });
      const ac = new AbortController();
      abortRef.current = ac;
      void (async () => {
        try {
          const result = await runTurn(
            text,
            (ev) => dispatch({ kind: 'engine-event', event: ev }),
            ac.signal,
          );
          dispatch({
            kind: 'turn-finished',
            ok: result.ok,
            output: result.output,
          });
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
    [runTurn, exit, onSave, sessionInfo],
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
      <StatusLine phase={state.phase} telemetry={state.telemetry} />
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
