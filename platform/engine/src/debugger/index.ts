/**
 * Replay-debugger primitives for `@aldo-ai/engine`.
 *
 * These three pieces — `BreakpointStore`, `PauseController`, and
 * `editAndResume` — let the API layer (`apps/api`) suspend, inspect, and
 * mutate a live `AgentRun` without owning any of the engine internals.
 *
 * The wire format consumed by the web debugger lives in
 * `@aldo-ai/api-contract/debugger.ts`; the events emitted by these
 * primitives map onto that contract one-for-one but are encoded as plain
 * `RunEvent`s on the engine side so we don't bend the cross-package
 * `@aldo-ai/types` surface.
 */

export {
  type Breakpoint,
  type BreakpointKind,
  type BreakpointStore,
  type CreateBreakpointInput,
  InMemoryBreakpointStore,
  PostgresBreakpointStore,
  type PostgresBreakpointStoreOptions,
} from './breakpoint-store.js';

export {
  type ContinueMode,
  PauseController,
  type PauseEvent,
  type ResumeEvent,
} from './pause-controller.js';

export {
  type EditAndResumeArgs,
  editAndResume,
  rewriteCheckpoint,
} from './edit-and-resume.js';
