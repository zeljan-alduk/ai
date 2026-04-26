/**
 * `/v1/runs/compare?a=<id>&b=<id>` — wave-13 convenience endpoint.
 *
 * Returns both runs (full detail) + a small server-computed diff in a
 * single round-trip so the web's run-comparison view doesn't have to
 * fan out four parallel calls. Both ids are tenant-scoped through
 * `getRun()` — an id that exists in another tenant returns 404 with the
 * standard `not_found` envelope, never `cross_tenant_access`.
 *
 * LLM-agnostic: the diff payload reports whether the chosen `lastModel`
 * differs as a plain boolean over opaque strings. Nothing here branches
 * on a specific provider name.
 *
 * This file is intentionally separate from `runs.ts` so wave-13's
 * parallel work (Engineer 13A is editing `runs.ts` for full-text
 * search + saved views + bulk-actions) doesn't merge-conflict with
 * Engineer 13B's compare endpoint.
 */

import { RunCompareQuery, RunCompareResponse } from '@aldo-ai/api-contract';
import { Hono } from 'hono';
import { getAuth } from '../auth/middleware.js';
import { getRun } from '../db.js';
import type { Deps } from '../deps.js';
import { notFound, validationError } from '../middleware/error.js';

export function runsCompareRoutes(deps: Deps): Hono {
  const app = new Hono();

  app.get('/v1/runs/compare', async (c) => {
    const parsed = RunCompareQuery.safeParse(
      Object.fromEntries(new URL(c.req.url).searchParams.entries()),
    );
    if (!parsed.success) {
      throw validationError('invalid compare query', parsed.error.issues);
    }
    if (parsed.data.a === parsed.data.b) {
      // Compare-with-self is almost always a UI bug; return 400 so the
      // operator can see it instead of a meaningless empty diff.
      throw validationError('compare requires two distinct run ids');
    }
    const tenantId = getAuth(c).tenantId;
    const [a, b] = await Promise.all([
      getRun(deps.db, tenantId, parsed.data.a),
      getRun(deps.db, tenantId, parsed.data.b),
    ]);
    if (a === null) throw notFound(`run not found: ${parsed.data.a}`);
    if (b === null) throw notFound(`run not found: ${parsed.data.b}`);

    const eventCountDiff = Math.abs(a.events.length - b.events.length);
    const modelChanged = (a.lastModel ?? '') !== (b.lastModel ?? '');
    const costDiff = Number((b.totalUsd - a.totalUsd).toFixed(6));
    const durationDiff =
      a.durationMs !== null && b.durationMs !== null ? b.durationMs - a.durationMs : null;
    const sameAgent = a.agentName === b.agentName && a.agentVersion === b.agentVersion;

    const body = RunCompareResponse.parse({
      a,
      b,
      diff: {
        eventCountDiff,
        modelChanged,
        costDiff,
        durationDiff,
        sameAgent,
      },
    });
    return c.json(body);
  });

  return app;
}
