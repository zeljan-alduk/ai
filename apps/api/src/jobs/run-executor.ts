/**
 * apps/api/src/jobs/run-executor.ts
 *
 * Inline executor: invoked fire-and-forget at the end of POST /v1/runs
 * when API_INLINE_EXECUTOR=true. Calls runtime.runAgent(...) on the
 * already-persisted queued row, lets the engine's RunStore stamp
 * events + status as it goes, and on hard failure writes a single
 * `error` event + flips the row to `failed` so the API surface always
 * reflects reality.
 *
 * Why fire-and-forget rather than a poll loop:
 *   - Simplest correct path. The queued row is already persisted so a
 *     crash before kickoff is recoverable by hand (and a future
 *     scanner will pick it up).
 *   - Keeps POST /v1/runs latency under the SSE-shape budget; the
 *     202 lands before the model call starts.
 *   - Avoids two-source-of-truth ambiguity: there's no separate queue
 *     table, only the existing runs table.
 *
 * What this DOES NOT do (deliberately, for v0):
 *   - Composite orchestration. The runtime-bootstrap doesn't wire the
 *     Supervisor; runs whose spec carries a `composite` block throw
 *     `CompositeRuntimeMissingError` and the executor flips them to
 *     failed with that exact message. This makes the gap explicit.
 *   - Retry on transient errors. The first failure is final.
 *   - Stream back to the request. The 202 has already shipped.
 */

import type { AgentRef, RunId } from '@aldo-ai/types';
import type { SqlClient } from '@aldo-ai/storage';
import type { Deps } from '../deps.js';
import { getOrBuildRuntimeAsync } from '../runtime-bootstrap.js';

export interface ExecuteRunArgs {
  readonly deps: Deps;
  readonly tenantId: string;
  readonly runId: string;
  readonly agentName: string;
  readonly agentVersion: string;
  readonly inputs: unknown;
  readonly projectId?: string | null;
}

export interface ExecuteRunResult {
  readonly status: 'started' | 'skipped_no_runtime' | 'failed_to_start';
  readonly reason?: string;
}

/**
 * Kick off engine execution for a queued run. Returns immediately
 * after dispatching; the engine's RunStore takes over for event +
 * status persistence.
 *
 * Errors that surface BEFORE the runtime accepts the spawn (no
 * runtime, agent missing, composite without orchestrator) are
 * persisted to the run row directly so the API surface is honest.
 */
export async function executeQueuedRun(args: ExecuteRunArgs): Promise<ExecuteRunResult> {
  const { deps, tenantId, runId, agentName, inputs, projectId } = args;

  const knob = (args.deps.env.API_INLINE_EXECUTOR ?? '').toLowerCase();
  if (knob !== 'true') {
    return { status: 'skipped_no_runtime', reason: 'API_INLINE_EXECUTOR != true' };
  }

  let bundle;
  try {
    bundle = await getOrBuildRuntimeAsync(deps, tenantId);
  } catch (e) {
    console.error('[run-executor] getOrBuildRuntime threw:', e);
    await markRunFailed(deps.db, runId, `runtime bootstrap failed: ${e instanceof Error ? e.message : String(e)}`).catch(() => {});
    return { status: 'failed_to_start', reason: 'bootstrap threw' };
  }
  if (bundle === null) {
    await markRunFailed(deps.db, runId, 'no providers configured (no model adapters enabled)');
    return { status: 'skipped_no_runtime', reason: 'no providers configured' };
  }

  const ref: AgentRef = { name: agentName };

  // Fire-and-forget. The engine's RunStore writes events + status to
  // the same `runs` / `run_events` tables /v1/runs reads. We only need
  // to catch errors that escape the runtime altogether.
  bundle.runtime
    .runAgent(ref, inputs, {
      // Wave-X — pin the engine's run id to the API's so events land on
      // the same row /v1/runs/:id is polling. Without this, the engine
      // generates a fresh UUID and the API's queued row never updates.
      runId: runId as unknown as import('@aldo-ai/types').RunId,
      ...(projectId !== null && projectId !== undefined ? { projectId } : {}),
    })
    .catch(async (err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      // Best-effort. If the run row already terminated we leave it
      // alone; otherwise stamp a failed row so the operator sees what
      // went wrong.
      await markRunFailed(deps.db, runId, msg).catch((bookErr) => {
        console.error('[run-executor] markRunFailed itself failed', bookErr);
      });
      console.error(`[run-executor] run ${runId} failed: ${msg}`);
    });

  return { status: 'started' };
}

/** Best-effort: flip a queued run to failed with a short reason. */
async function markRunFailed(db: SqlClient, runId: string, reason: string): Promise<void> {
  await db.query(
    `UPDATE runs
        SET status = 'failed',
            ended_at = COALESCE(ended_at, now())
      WHERE id = $1
        AND status IN ('queued', 'running')`,
    [runId],
  );
  // Also append a final `error` event so the timeline tab in /runs/[id]
  // shows the operator-visible reason. id is generated client-side to
  // stay independent of the engine's id allocator.
  await db.query(
    `INSERT INTO run_events (id, run_id, tenant_id, project_id, type, payload_jsonb, at)
       SELECT gen_random_uuid()::text,
              r.id,
              r.tenant_id,
              r.project_id,
              'error',
              $2::jsonb,
              now()
         FROM runs r
        WHERE r.id = $1
          AND NOT EXISTS (
            SELECT 1 FROM run_events e
             WHERE e.run_id = r.id
               AND e.type = 'error'
               AND e.payload_jsonb->>'source' = 'inline-executor'
          )`,
    [runId, JSON.stringify({ source: 'inline-executor', message: reason })],
  );
}

// Type aug: extend Env so TypeScript knows about the knob.
declare module '../deps.js' {
  interface Env {
    readonly API_INLINE_EXECUTOR?: string;
  }
}
