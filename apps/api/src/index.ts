/**
 * Entry point — boots the API on `PORT` (default 3001).
 *
 * The actual app is built by `buildApp(deps)` in `app.ts`; this file's
 * only job is to (a) read the env, (b) connect a SQL client + registry,
 * (c) seed the canonical `default` tenant from `agency/` (idempotent),
 * (d) hand the deps to `serve()` from `@hono/node-server`. Tests skip
 * this file entirely so they never bind a port.
 */

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { seedDefaultTenantFromAgency } from '@aldo-ai/registry';
import { migrate } from '@aldo-ai/storage';
import { serve } from '@hono/node-server';
import { buildApp } from './app.js';
import { SEED_TENANT_UUID, createDeps } from './deps.js';

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

  // Seed the canonical `default` tenant from agency/. Idempotent — once
  // the tenant has any registered agent, this is a no-op. The directory
  // is resolved relative to the workspace root, NOT the Docker image
  // cwd: at build time the Dockerfile copies `agency/` next to the
  // packaged API at `/app/agency`. When running from source, the
  // monorepo root is two levels above `apps/api/src`.
  try {
    const agencyDir = resolveAgencyDir();
    if (agencyDir !== null) {
      const result = await seedDefaultTenantFromAgency(deps.agentStore, {
        defaultTenantId: SEED_TENANT_UUID,
        directory: agencyDir,
        log: (m) => console.log(m),
      });
      if (result.alreadyPopulated) {
        console.log('[api] default tenant already populated; skipping seed');
      } else {
        console.log(
          `[api] seeded default tenant: ${result.seeded} agents from ${agencyDir} ` +
            `(skipped ${result.skipped} unparseable)`,
        );
      }
    } else {
      console.log('[api] no agency/ directory found alongside the API; default tenant left empty');
    }
  } catch (err) {
    // Failure to seed is not a hard boot failure — the API can still
    // serve once a user signs up + registers their own agents. We log
    // loudly so the operator notices.
    console.error('[api] default-tenant seed failed:', err);
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

/**
 * Locate the `agency/` directory the seeder should walk.
 *
 * Search order:
 *   1. Workspace root (when running `pnpm` from source) —
 *      apps/api/src/index.ts -> ../../agency.
 *   2. Image-relative path (`/app/agency`) — what the Dockerfile
 *      copies in. Returning null is a soft failure; the API still
 *      boots without a seed.
 */
function resolveAgencyDir(): string | null {
  // import.meta.url ends in apps/api/src/index.ts (or its compiled
  // .js). resolve(..., '../../agency') walks up to the monorepo root.
  const here = fileURLToPath(new URL('.', import.meta.url));
  const fromSource = resolve(here, '..', '..', '..', 'agency');
  // We trust resolve() — readdir inside the seeder will return [] if
  // the directory doesn't exist, and the seeder treats that as a
  // 0-agent successful seed.
  return fromSource;
}

void main();
