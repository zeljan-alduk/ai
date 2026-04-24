/**
 * `aldo dev` — stub. Will boot the local gateway + engine + observability
 * for a fast inner loop. Today it just describes what it would start.
 */

import type { CliIO } from '../io.js';
import { writeErr, writeLine } from '../io.js';
import { STUB_EXIT, STUB_MSG } from './stubs.js';

export interface DevOptions {
  readonly port?: number;
  readonly json?: boolean;
}

export async function runDev(opts: DevOptions, io: CliIO): Promise<number> {
  const port = opts.port ?? 8787;
  const plan = {
    wouldStart: [
      `gateway on http://127.0.0.1:${port}`,
      'engine (in-process)',
      'observability hooks (OTEL → local collector)',
    ],
  };
  if (opts.json === true) {
    io.stdout(`${JSON.stringify({ ok: false, stub: true, plan }, null, 2)}\n`);
  } else {
    writeLine(io, 'would start:');
    for (const line of plan.wouldStart) writeLine(io, `  - ${line}`);
    writeErr(io, `dev: ${STUB_MSG}`);
  }
  return STUB_EXIT;
}
