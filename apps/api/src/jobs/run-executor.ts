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

  // Default ON — explicit `false` disables. The bridge has been
  // verified end-to-end against local Ollama; leaving it OFF by
  // default would mean every fresh deploy stays in queued-only mode
  // and the operator has to remember to flip the knob.
  const knob = (args.deps.env.API_INLINE_EXECUTOR ?? 'true').toLowerCase();
  if (knob === 'false' || knob === '0' || knob === 'no' || knob === 'off') {
    return { status: 'skipped_no_runtime', reason: `API_INLINE_EXECUTOR=${knob}` };
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
    .then((run) => {
      // Subscribe to the run's event stream so we can mirror `usage`
      // events into the usage_records table — that's what the
      // last_provider / last_model / total_usd projections in
      // /v1/runs read from. The engine's RunStore writes events to
      // run_events but not usage_records.
      void (async () => {
        try {
          for await (const event of run.events()) {
            // The engine's RunEvent union doesn't yet enumerate
            // 'usage' even though it emits it (the type is widened
            // at the wire layer in @aldo-ai/api-contract). Cast for
            // the comparison and trust the runtime check below.
            const t = (event as { type: string }).type;
            if (t === 'usage') {
              await mirrorUsageRecord(deps.db, runId, tenantId, event as unknown as {
                id?: string;
                payload?: Record<string, unknown>;
              }).catch((e) => {
                console.error('[run-executor] mirrorUsageRecord failed', e);
              });
            }
          }
        } catch (e) {
          console.error('[run-executor] event-stream subscriber crashed', e);
        }
      })();
      // Wave-X — for composite runs the events() iterator is closed
      // immediately (children are separate Runs). The actual work
      // happens inside run.wait(). If runComposite throws (orchestrator
      // gate failure, child spawn failure, etc.) we want the error
      // surfaced so an operator can see what failed.
      void (async () => {
        try {
          await (run as unknown as { wait?: () => Promise<unknown> }).wait?.();
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          console.error(`[run-executor] run ${runId} wait() threw: ${msg}`);
          await markRunFailed(deps.db, runId, msg).catch(() => {});
        }
      })();
    })
    .catch(async (err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[run-executor] run ${runId} runAgent rejected: ${msg}`);
      // Best-effort. If the run row already terminated we leave it
      // alone; otherwise stamp a failed row so the operator sees what
      // went wrong.
      await markRunFailed(deps.db, runId, msg).catch((bookErr) => {
        console.error('[run-executor] markRunFailed itself failed', bookErr);
      });
    });

  return { status: 'started' };
}

/**
 * Mirror an engine `usage` RunEvent into the `usage_records` table so
 * the API's last_provider / last_model / total_usd projections light up.
 * The engine doesn't write usage_records itself — RunStore owns runs +
 * run_events only. Idempotent on (run_id, span_id) via a NOT EXISTS
 * guard so a double-emit can't double-bill.
 */
async function mirrorUsageRecord(
  db: SqlClient,
  runId: string,
  tenantId: string,
  event: { id?: string; payload?: Record<string, unknown> },
): Promise<void> {
  const p = event.payload;
  if (!p || typeof p !== 'object') return;
  const provider = typeof p.provider === 'string' ? p.provider : null;
  const model = typeof p.model === 'string' ? p.model : null;
  const tokensIn = typeof p.tokensIn === 'number' ? p.tokensIn : 0;
  const tokensOut = typeof p.tokensOut === 'number' ? p.tokensOut : 0;
  const usd = typeof p.usd === 'number' ? p.usd : 0;
  if (provider === null || model === null) return;
  // span_id: the engine doesn't expose one for the model call yet, so
  // fall back to the event id (each `usage` event is one model call).
  const spanId = String(p.spanId ?? event.id ?? `${runId}-${Date.now()}`);
  await db.query(
    `INSERT INTO usage_records (id, run_id, span_id, provider, model, tokens_in, tokens_out, usd, at)
     SELECT gen_random_uuid()::text, $1, $2, $3, $4, $5, $6, $7, $8
      WHERE NOT EXISTS (
        SELECT 1 FROM usage_records WHERE run_id = $1 AND span_id = $2
      )`,
    [runId, spanId, provider, model, tokensIn, tokensOut, usd, new Date().toISOString()],
  );
  // Tenant id is implicit via the runs row; usage_records doesn't carry tenant_id directly.
  void tenantId;
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
