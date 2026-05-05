#!/usr/bin/env node
// Run the dry-run in live mode and print the post-mortem.
import { runDryRun } from './healthz-db.ts';

try {
  const r = await runDryRun({ mode: 'live' });
  process.stdout.write(r.postMortem);
  process.stderr.write(`\n\n---\nok=${r.ok} runStoreCount=${r.runStoreCount}\n`);
} catch (err) {
  console.error('LIVE MODE THREW:', err);
  process.exit(1);
}
