/**
 * Entry point — boots the API on `PORT` (default 3001).
 *
 * The actual app is built by `buildApp(deps)` in `app.ts`; this file's
 * only job is to (a) read the env, (b) connect a SQL client + registry,
 * (c) hand them to `serve()` from `@hono/node-server`. Tests skip this
 * file entirely so they never bind a port.
 */

import { serve } from '@hono/node-server';
import { migrate } from '@aldo-ai/storage';
import { buildApp } from './app.js';
import { createDeps } from './deps.js';

async function main(): Promise<void> {
  const deps = await createDeps(process.env);

  // Apply pending migrations on boot. Idempotent — safe across restarts.
  // Skipped silently if the migrations directory is missing (e.g. shipping
  // a prebuilt artifact without source maps).
  try {
    await migrate(deps.db);
  } catch (err) {
    console.error('[api] migration failed:', err);
    process.exit(1);
  }

  const app = buildApp(deps);
  const port = Number(process.env.PORT ?? 3001);
  const host = process.env.HOST ?? '0.0.0.0';

  serve({ fetch: app.fetch, port, hostname: host }, (info) => {
    console.log(`[api] listening on http://${info.address}:${info.port}`);
  });

  const shutdown = async (signal: string): Promise<void> => {
    console.log(`[api] received ${signal}, shutting down`);
    try {
      await deps.close();
    } finally {
      process.exit(0);
    }
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

void main();
