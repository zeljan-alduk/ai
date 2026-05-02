import type { AgentRef, RunId, UsageRecord } from '@aldo-ai/types';
import {
  type ChildRunSummary,
  CompositeChildFailedError,
  type SpawnedChildHandle,
  type Strategy,
  type SubagentInvocation,
  type SupervisorDeps,
} from '../types.js';

/**
 * Spawn a single subagent through the runtime adapter, emit the
 * `composite.child_started` parent-side event, and return the child
 * handle. Cost roll-up is deferred until `awaitChild` completes.
 */
export async function spawnChild(
  invocation: SubagentInvocation,
  strategy: Strategy,
  deps: SupervisorDeps,
): Promise<SpawnedChildHandle> {
  const handle = await deps.runtime.spawnChild({
    agent: invocation.agent,
    inputs: invocation.inputs,
    parentRunId: deps.ctx.parentRunId,
    rootRunId: deps.ctx.rootRunId,
    tenant: deps.ctx.tenant,
    privacy: invocation.privacy,
    compositeStrategy: strategy,
    // Wave-17: forward the supervisor's project assignment to the
    // child. The engine adapter persists it via recordRunStart;
    // when undefined here the child row is INSERTed with NULL and
    // the migration-021 backfill / route pre-record handles it.
    ...(deps.ctx.projectId !== undefined ? { projectId: deps.ctx.projectId } : {}),
    ...(deps.ctx.signal !== undefined ? { signal: deps.ctx.signal } : {}),
  });
  deps.emit('composite.child_started', {
    childRunId: handle.runId,
    agent: invocation.agent,
    role: 'subagent',
    strategy,
  });
  return handle;
}

/**
 * Await a previously-spawned child and emit the post-run event. Returns
 * a normalised summary including a typed-error envelope on failure.
 *
 * IMPORTANT: this never throws. Callers (sequential / iterative) decide
 * whether to short-circuit on failure; parallel/debate fan-out collects
 * summaries and lets the caller raise.
 */
export async function awaitChild(
  handle: SpawnedChildHandle,
  invocation: SubagentInvocation,
  deps: SupervisorDeps,
): Promise<ChildRunSummary> {
  const startedAt = Date.now();
  let res: { ok: boolean; output: unknown };
  try {
    res = await handle.wait();
  } catch (err) {
    const e = err instanceof Error ? err : new Error(String(err));
    const durationMs = Date.now() - startedAt;
    const error = { code: 'composite_child_failed', message: e.message };
    const usage = handle.collectUsage();
    deps.emit('composite.child_failed', {
      childRunId: handle.runId,
      agent: invocation.agent,
      errorCode: error.code,
      errorMessage: error.message,
    });
    return makeSummary({ handle, invocation, ok: false, output: null, durationMs, error, usage });
  }
  const durationMs = Date.now() - startedAt;
  const usage = handle.collectUsage();
  if (!res.ok) {
    const errorMessage =
      typeof res.output === 'object' && res.output !== null && 'error' in res.output
        ? String((res.output as { error: unknown }).error)
        : 'child run reported ok=false';
    const error = { code: 'composite_child_failed', message: errorMessage };
    deps.emit('composite.child_failed', {
      childRunId: handle.runId,
      agent: invocation.agent,
      errorCode: error.code,
      errorMessage: error.message,
    });
    return makeSummary({
      handle,
      invocation,
      ok: false,
      output: res.output,
      durationMs,
      error,
      usage,
    });
  }
  deps.emit('composite.child_completed', {
    childRunId: handle.runId,
    agent: invocation.agent,
    durationMs,
    outputSummary: summariseOutput(res.output),
  });
  return makeSummary({
    handle,
    invocation,
    ok: true,
    output: res.output,
    durationMs,
    usage,
  });
}

interface MakeSummaryArgs {
  readonly handle: SpawnedChildHandle;
  readonly invocation: SubagentInvocation;
  readonly ok: boolean;
  readonly output: unknown;
  readonly durationMs: number;
  readonly usage: UsageRecord;
  readonly error?: { readonly code: string; readonly message: string };
}

function makeSummary(args: MakeSummaryArgs): ChildRunSummary {
  return {
    runId: args.handle.runId,
    agent: args.invocation.agent,
    ...(args.invocation.alias !== undefined ? { alias: args.invocation.alias } : {}),
    ok: args.ok,
    output: args.output,
    durationMs: args.durationMs,
    usage: args.usage,
    ...(args.error !== undefined ? { error: args.error } : {}),
  };
}

/**
 * Truncate the child output to a small string for the
 * `composite.child_completed` event. Avoid persisting a giant blob
 * twice (the child's run-event log already has the full output).
 */
function summariseOutput(output: unknown): string {
  if (output === undefined || output === null) return '';
  const s = typeof output === 'string' ? output : JSON.stringify(output);
  return s.length > 240 ? `${s.slice(0, 237)}...` : s;
}

/**
 * Translate a non-ok ChildRunSummary into a typed CompositeChildFailedError
 * the caller can re-throw on the parent run.
 */
export function toCompositeError(summary: ChildRunSummary): CompositeChildFailedError {
  const cause = new Error(summary.error?.message ?? 'unknown child failure');
  return new CompositeChildFailedError(summary.runId as RunId, summary.agent as AgentRef, cause);
}
