#!/usr/bin/env node
// Render the dry-run post-mortem to stdout.
// Usage: pnpm exec tsx apps/api/tests/agency-dry-run/run.mjs
import { runDryRun } from './healthz-db.ts';

const r = await runDryRun({ mode: 'stub' });
process.stdout.write(r.postMortem);
