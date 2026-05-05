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
} catch (err) {
  console.error('LIVE:NETWORK MODE THREW:', err);
  process.exit(1);
}
