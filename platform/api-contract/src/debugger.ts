/**
 * Replay-debugger wire types — shared by `apps/api` (server) and
 * `apps/web` (client). The debugger sits between a live agent run
 * (server-side, owned by `@aldo-ai/engine`) and the user (browser
 * client). The client subscribes to a server-sent event stream of
 * RunEvents and POSTs commands back through this contract.
 *
 * LLM-agnostic: provider is an opaque string everywhere.
 */
import { z } from 'zod';

/** A single live event emitted by the engine while a run executes. */
export const DebugRunEvent = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('checkpoint'),
    runId: z.string(),
    checkpointId: z.string(),
    nodePath: z.string(),
    at: z.string(),
    /** Free-form payload — the debugger renders this as JSON. */
    payload: z.unknown(),
  }),
  z.object({
    kind: z.literal('message'),
    runId: z.string(),
    role: z.enum(['system', 'user', 'assistant', 'tool']),
    text: z.string(),
    at: z.string(),
  }),
  z.object({
    kind: z.literal('tool_call'),
    runId: z.string(),
    callId: z.string(),
    tool: z.string(),
    args: z.unknown(),
    at: z.string(),
  }),
  z.object({
    kind: z.literal('tool_result'),
    runId: z.string(),
    callId: z.string(),
    result: z.unknown(),
    isError: z.boolean().optional(),
    at: z.string(),
  }),
  z.object({
    kind: z.literal('paused'),
    runId: z.string(),
    /** Why the run paused — usually `breakpoint:<id>`. */
    reason: z.string(),
    /** The checkpoint that was just persisted. Use it as the resume target. */
    checkpointId: z.string(),
    at: z.string(),
  }),
  z.object({
    kind: z.literal('resumed'),
    runId: z.string(),
    fromCheckpoint: z.string(),
    at: z.string(),
  }),
  z.object({
    kind: z.literal('completed'),
    runId: z.string(),
    finishReason: z.enum(['stop', 'length', 'tool_use', 'error', 'cancelled']),
    at: z.string(),
  }),
  z.object({
    kind: z.literal('error'),
    runId: z.string(),
    message: z.string(),
    at: z.string(),
  }),
]);
export type DebugRunEvent = z.infer<typeof DebugRunEvent>;

/** A breakpoint binds to a specific point in a run's graph. */
export const Breakpoint = z.object({
  id: z.string(),
  runId: z.string(),
  /** Where to pause: before a tool call, after a node, etc. */
  kind: z.enum(['before_tool_call', 'before_model_call', 'after_node', 'on_event']),
  /** Predicate against the matching surface (e.g. tool name, node path). */
  match: z.string(),
  enabled: z.boolean(),
  hitCount: z.number().int().nonnegative(),
});
export type Breakpoint = z.infer<typeof Breakpoint>;

export const ListBreakpointsResponse = z.object({
  breakpoints: z.array(Breakpoint),
});
export type ListBreakpointsResponse = z.infer<typeof ListBreakpointsResponse>;

export const CreateBreakpointRequest = z.object({
  kind: Breakpoint.shape.kind,
  match: z.string(),
  enabled: z.boolean().default(true),
});
export type CreateBreakpointRequest = z.infer<typeof CreateBreakpointRequest>;

/** Continue a paused run — either run free or step. */
export const ContinueCommand = z.object({
  /** `run` to free-run; `step` to advance one event then re-pause. */
  mode: z.enum(['run', 'step']).default('run'),
});
export type ContinueCommand = z.infer<typeof ContinueCommand>;

/** Edit a message in the current checkpoint and resume from there. */
export const EditAndResumeCommand = z.object({
  checkpointId: z.string(),
  /**
   * 0-based index into the checkpoint's `messages` array. The targeted
   * message has its `text` replaced; other fields preserved.
   */
  messageIndex: z.number().int().nonnegative(),
  newText: z.string(),
});
export type EditAndResumeCommand = z.infer<typeof EditAndResumeCommand>;

/** Swap which model the run uses, starting from a checkpoint. */
export const SwapModelCommand = z.object({
  checkpointId: z.string(),
  /** Either a capability class or an explicit provider+model. Server
   *  validates against the gateway registry. */
  capabilityClass: z.string().optional(),
  provider: z.string().optional(),
  model: z.string().optional(),
});
export type SwapModelCommand = z.infer<typeof SwapModelCommand>;
