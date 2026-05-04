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

import { Box, useApp } from 'ink';
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import type { RunEvent } from '@aldo-ai/types';
import { Conversation } from './components/Conversation.js';
import { Input } from './components/Input.js';
import { StatusLine } from './components/StatusLine.js';
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
}

export function App({ initialBrief, runTurn }: AppProps) {
  const [state, dispatch] = useReducer(reduce, initialState);
  const { exit } = useApp();
  const abortRef = useRef<AbortController | null>(null);
  // Auto-fire the first turn from the positional brief (if supplied).
  const [bootBrief, setBootBrief] = useState<string | undefined>(initialBrief);

  const startTurn = useCallback(
    (text: string) => {
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
    [runTurn],
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

  const busy = isBusy(state);

  return (
    <Box flexDirection="column">
      <Conversation entries={state.entries} />
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
