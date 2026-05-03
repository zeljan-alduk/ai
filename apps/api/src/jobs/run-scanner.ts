/**
 * apps/api/src/jobs/run-scanner.ts
 *
 * Background sweep that picks up `queued` runs the inline executor
 * either never started (process crashed between persist + kickoff) or
 * never completed (engine threw before recordRunEnd, leaving the row
 * stuck). Runs every TICK_MS; for each orphan it calls
 * executeQueuedRun, which is idempotent on (run_id) thanks to the
 * pinned-runId plumbing in spawn() — the engine's
 * INSERT ... ON CONFLICT (id) DO NOTHING + COALESCE-on-update mean a
 * second kickoff on the same row is safe.
 *
 * Conservative defaults: only picks up rows older than ORPHAN_GRACE_MS
 * so the inline kickoff (~ms latency) always wins; caps the per-tick
 * batch at MAX_PER_TICK so a backlog spike doesn't wedge the API.
 */

import type { Deps } from '../deps.js';
import { executeQueuedRun } from './run-executor.js';

/** How long a row must sit in `queued` before we consider it orphaned. */
const ORPHAN_GRACE_MS = 60_000;
/** Max orphans we kick off per tick. */
const MAX_PER_TICK = 8;

interface OrphanRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly project_id: string | null;
  readonly agent_name: string;
  readonly agent_version: string;
  readonly inputs_json: string | null;
  // Required to satisfy SqlRow's index-signature constraint.
  readonly [k: string]: unknown;
}

export interface ScanResult {
  readonly picked: number;
}

export async function scanForOrphanedQueuedRuns(deps: Deps): Promise<ScanResult> {
  const cutoff = new Date(Date.now() - ORPHAN_GRACE_MS).toISOString();
  // The runs table doesn't store inputs_json today (we'd have to add a
  // column to do so), so the scanner re-spawns with empty inputs. The
  // inline-kickoff path is the source of truth for inputs; this scanner
  // is a recovery net for the small fraction of runs that never reached
  // the engine. When this turns out to matter for a customer, the right
  // fix is migration NN that adds runs.inputs_jsonb + the API route
  // persisting it; the scanner then reads from the row.
  const res = await deps.db.query<OrphanRow>(
    `SELECT id, tenant_id, project_id, agent_name, agent_version, NULL::text AS inputs_json
       FROM runs
      WHERE status = 'queued'
        AND started_at < $1
      ORDER BY started_at ASC
      LIMIT $2`,
    [cutoff, MAX_PER_TICK],
  );
  if (res.rows.length === 0) return { picked: 0 };

  for (const row of res.rows) {
    let inputs: unknown = {};
    if (row.inputs_json !== null) {
      try {
        inputs = JSON.parse(row.inputs_json);
      } catch {
        inputs = {};
      }
    }
    void executeQueuedRun({
      deps,
      tenantId: row.tenant_id,
      runId: row.id,
      agentName: row.agent_name,
      agentVersion: row.agent_version,
      inputs,
      projectId: row.project_id,
    }).catch((err) => {
      console.error(`[run-scanner] kickoff for ${row.id} threw`, err);
    });
  }
  console.log(`[run-scanner] picked up ${res.rows.length} orphaned queued run(s)`);
  return { picked: res.rows.length };
}
