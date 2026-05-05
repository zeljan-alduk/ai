#!/usr/bin/env node
// Operator-facing live:network dogfood smoke runner.
//
// Usage:
//   pnpm --filter @aldo-ai/api exec tsx tests/agency-dry-run/run-live-network.mjs
//
// Stages stream to stderr in real time so a wedged dispatch is
// surfaced as "stuck at stage X for Yms" rather than going silent.
// Override per-stage timeouts via:
//   ALDO_DRY_RUN_STAGE_TIMEOUT_<STAGE>=<ms>
// e.g. ALDO_DRY_RUN_STAGE_TIMEOUT_PROVIDERS_RESOLVED=60000
import { runDryRun } from './healthz-db.ts';

try {
  const r = await runDryRun({ mode: 'live:network' });
  process.stdout.write(r.postMortem);
  process.stderr.write(
    `\n\n---\nok=${r.ok} runStoreCount=${r.runStoreCount ?? 'undefined'} events=${r.events.length} spawns=${r.spawns.length}\n`,
  );
  if (r.stages !== undefined && r.stages.length > 0) {
    process.stderr.write(`stages: ${r.stages.length} reported\n`);
    for (const s of r.stages) {
      const tag = s.ok ? 'OK' : s.timedOut ? 'TIMEOUT' : 'FAILED';
      process.stderr.write(
        `  ${tag.padEnd(7)} ${s.name.padEnd(28)} ${s.durationMs}ms${s.reason ? ` — ${s.reason}` : ''}\n`,
      );
    }
  }
  if (r.failureReason) {
    process.stderr.write(`failureReason=${r.failureReason}\n`);
  }
  // Hard-exit so dangling stdio refs from MCP server child processes
  // (aldo-fs / aldo-shell / aldo-git / aldo-memory, all spawned via
  // the engine's tool host) don't keep the Node event loop alive.
  // Without this, a failed composite-running stage records the failure
  // in <1s but the process hangs ~10 minutes waiting on the children
  // — operator running the smoke on CI sees a false hang. The OS
  // reaps the children when the parent exits.
  process.exit(r.ok ? 0 : 1);
} catch (err) {
  console.error('LIVE:NETWORK MODE THREW:', err);
  process.exit(1);
}
