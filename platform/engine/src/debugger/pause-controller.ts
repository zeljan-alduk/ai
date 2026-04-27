import type { CheckpointId, RunId } from '@aldo-ai/types';
import type { Breakpoint } from './breakpoint-store.js';

/**
 * Async barrier the engine awaits when a matching breakpoint fires.
 *
 * Lifecycle per pause:
 *
 *   1. The agent loop discovers ≥1 matching breakpoint, persists a
 *      "paused" checkpoint, then calls `pause(...)` which returns a
 *      promise.
 *   2. Subscribers (typically the API layer) receive a `PauseEvent` so
 *      they can fan out a `paused` `DebugRunEvent` to clients.
 *   3. The caller (API → user → API) eventually invokes `continue('run')`
 *      or `continue('step')`. Both resolve the awaited promise; `step`
 *      additionally instructs the controller to re-pause after the next
 *      checked event.
 *
 * The controller is a simple in-process broker — multi-process delivery
 * (when `apps/api` runs on more than one node) would push pause requests
 * over a queue keyed by `runId`. For v0 the API talks to a single engine
 * process per run.
 */

export type ContinueMode = 'run' | 'step';

export interface PauseEvent {
  readonly runId: RunId;
  readonly checkpointId: CheckpointId;
  readonly reason: string;
  /** The matching breakpoint that triggered this pause (first match wins). */
  readonly breakpoint: Breakpoint;
  /** The kind of event the engine is about to perform. */
  readonly aboutTo: 'tool_call' | 'model_call' | 'after_node' | 'event';
  /** ISO timestamp the pause was raised at. */
  readonly at: string;
}

export interface ResumeEvent {
  readonly runId: RunId;
  readonly checkpointId: CheckpointId;
  readonly mode: ContinueMode;
  readonly at: string;
}

type PauseListener = (e: PauseEvent) => void;
type ResumeListener = (e: ResumeEvent) => void;

interface Pending {
  readonly event: PauseEvent;
  readonly resolve: (mode: ContinueMode) => void;
}

/**
 * Per-engine-process PauseController.
 *
 * The controller is shared between the AgentRun (which calls `pause` and
 * awaits the returned promise) and the API layer (which calls
 * `subscribePause` to learn about pauses and `continue` to release them).
 *
 * Step semantics:
 *   - When `continue('step')` is invoked, the controller flips a per-run
 *     `stepArmed` flag. The next call to `shouldStepPause(runId)` returns
 *     true and the engine treats it as a synthetic breakpoint hit.
 *   - The flag is single-shot: it clears as soon as it is observed.
 */
export class PauseController {
  private readonly pendingByRun = new Map<RunId, Pending>();
  private readonly stepArmed = new Set<RunId>();
  private readonly pauseListeners = new Set<PauseListener>();
  private readonly resumeListeners = new Set<ResumeListener>();

  /**
   * Block the agent loop until `continue(runId, mode)` is invoked.
   *
   * Returns the mode the caller chose so the loop knows whether to
   * re-arm step mode for the next event.
   */
  async pause(event: PauseEvent): Promise<ContinueMode> {
    const existing = this.pendingByRun.get(event.runId);
    if (existing) {
      // Should not happen — only one pause per run at a time. Resolve the
      // stale one defensively to avoid a deadlock.
      existing.resolve('run');
    }
    return new Promise<ContinueMode>((resolve) => {
      this.pendingByRun.set(event.runId, { event, resolve });
      for (const l of this.pauseListeners) {
        try {
          l(event);
        } catch {
          // Listener errors must never break the engine loop.
        }
      }
    });
  }

  /**
   * Release a paused run. If `mode === 'step'`, the controller arms a
   * one-shot re-pause for the next checked event.
   *
   * Returns `true` if a paused run was released, `false` if the run
   * was not paused (idempotent / safe to call from a flaky client).
   */
  continue(runId: RunId, mode: ContinueMode = 'run'): boolean {
    const pending = this.pendingByRun.get(runId);
    if (!pending) return false;
    this.pendingByRun.delete(runId);
    if (mode === 'step') this.stepArmed.add(runId);
    else this.stepArmed.delete(runId);
    pending.resolve(mode);
    const ev: ResumeEvent = {
      runId,
      checkpointId: pending.event.checkpointId,
      mode,
      at: new Date().toISOString(),
    };
    for (const l of this.resumeListeners) {
      try {
        l(ev);
      } catch {
        // ignore
      }
    }
    return true;
  }

  /** Convenience wrapper for `continue(runId, 'step')`. */
  step(runId: RunId): boolean {
    return this.continue(runId, 'step');
  }

  /**
   * Single-shot check: if the previous resume was `step`, returns true
   * once and clears the armed flag. The engine treats a true return as
   * a synthetic breakpoint and pauses immediately.
   */
  shouldStepPause(runId: RunId): boolean {
    if (!this.stepArmed.has(runId)) return false;
    this.stepArmed.delete(runId);
    return true;
  }

  /** Whether a given run is currently waiting on a pause. */
  isPaused(runId: RunId): boolean {
    return this.pendingByRun.has(runId);
  }

  /** Subscribe to pause events. Returns an unsubscribe function. */
  subscribePause(listener: PauseListener): () => void {
    this.pauseListeners.add(listener);
    return () => {
      this.pauseListeners.delete(listener);
    };
  }

  /** Subscribe to resume events. Returns an unsubscribe function. */
  subscribeResume(listener: ResumeListener): () => void {
    this.resumeListeners.add(listener);
    return () => {
      this.resumeListeners.delete(listener);
    };
  }
}
