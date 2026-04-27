/**
 * `GET /health` — liveness + version stamp.
 *
 * No DB ping yet; readiness checks land in wave 5 once we have an
 * orchestrator pinning a tenant per request. For now `ok: true` plus
 * the build version is enough for the web shell and uptime monitors.
 */

import { Hono } from 'hono';
import type { Deps } from '../deps.js';

export function healthRoutes(deps: Deps): Hono {
  const app = new Hono();
  app.get('/health', (c) => c.json({ ok: true, version: deps.version }));
  return app;
}
