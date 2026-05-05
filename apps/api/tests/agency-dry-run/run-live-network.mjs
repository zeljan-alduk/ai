#!/usr/bin/env node
// Run the dry-run in live:network mode and print the post-mortem + raw result.
// Used for operator-invokable dogfood smoke against real provider creds or
// a local model server. CI never runs this — env-gated by the test suite.
import { runDryRun } from './healthz-db.ts';

try {
  const r = await runDryRun({ mode: 'live:network' });
  process.stdout.write(r.postMortem);
  process.stderr.write(
    `\n\n---\nok=${r.ok} runStoreCount=${r.runStoreCount ?? 'undefined'} events=${r.events.length} spawns=${r.spawns.length}\n`,
  );
  if (r.failureReason) {
    process.stderr.write(`failureReason=${r.failureReason}\n`);
  }
} catch (err) {
  console.error('LIVE:NETWORK MODE THREW:', err);
  process.exit(1);
}
