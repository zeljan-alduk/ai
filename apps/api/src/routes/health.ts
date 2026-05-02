/**
 * `GET /health` — liveness + readiness with a real DB ping.
 *
 * Wave-MVP follow-up (Tier 2.12): the v0 shape was just `{ ok: true,
 * version }` with no actual DB probe — STATUS.md called this out and
 * `/status` was inferring DB liveness from the API liveness as a
 * workaround. The endpoint now runs a `SELECT 1` against the live
 * pool with a 1-second timeout and surfaces:
 *
 *   {
 *     ok: boolean,           // legacy alias of `status === 'ok'`,
 *                             // kept for backwards compatibility
 *     status: 'ok'|'degraded',
 *     api: 'ok',             // we're answering, so always 'ok'
 *     db:  'ok' | 'down',    // result of `SELECT 1`
 *     version: string,
 *     timestamp: string,     // ISO-8601
 *   }
 *
 * `status` is `'degraded'` when the DB ping fails. The endpoint never
 * 5xxs on a DB failure — operators rely on the JSON body to drive
 * dashboards (HTTP 503 would knock the whole API out of the uptime
 * monitor's success-rate metric for what is a partial degradation).
 *
 * Backwards compatible: the original `ok: true` + `version` fields
 * are preserved so pre-MVP callers (uptime monitors, the original
 * status-board polling client) keep working.
 */

import { Hono } from 'hono';
import type { Deps } from '../deps.js';

const DB_PING_TIMEOUT_MS = 1_000;

export function healthRoutes(deps: Deps): Hono {
  const app = new Hono();
  app.get('/health', async (c) => {
    const dbOk = await pingDb(deps);
    const status = dbOk ? 'ok' : 'degraded';
    return c.json({
      ok: dbOk,
      status,
      api: 'ok' as const,
      db: dbOk ? ('ok' as const) : ('down' as const),
      version: deps.version,
      timestamp: new Date().toISOString(),
    });
  });
  return app;
}

/**
 * Run `SELECT 1` against the SqlClient with a hard 1-second timeout.
 * Returns `true` on a successful single-row response, `false` on any
 * thrown error or timeout. Never propagates an exception — the
 * endpoint must always answer with a JSON body.
 */
async function pingDb(deps: Deps): Promise<boolean> {
  try {
    const probe = (async () => {
      const r = await deps.db.query<{ ok: number }>('SELECT 1 AS ok');
      return r.rows[0]?.ok === 1;
    })();
    const timeout = new Promise<false>((resolve) =>
      setTimeout(() => resolve(false), DB_PING_TIMEOUT_MS),
    );
    return await Promise.race([probe, timeout]);
  } catch {
    return false;
  }
}
