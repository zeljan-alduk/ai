/**
 * `meridian run <agent> --inputs <json>` — stub.
 *
 * When the engine lands this will resolve a ref via the registry, call
 * `Runtime.spawn(ref, inputs)`, and stream `AgentRun.events()` to stdout.
 * For now it just describes what it would do and exits with STUB_EXIT.
 */

import type { CliIO } from '../io.js';
import { writeErr, writeLine } from '../io.js';
import { STUB_EXIT, STUB_MSG } from './stubs.js';

export interface RunOptions {
  readonly inputs?: string;
  readonly provider?: string;
  readonly model?: string;
  readonly json?: boolean;
}

export async function runRun(agent: string, opts: RunOptions, io: CliIO): Promise<number> {
  const plan = {
    agent,
    inputs: opts.inputs ?? null,
    overrides: {
      provider: opts.provider ?? null,
      model: opts.model ?? null,
    },
    wouldDo: [
      'resolve agent ref via @meridian/registry',
      'call Runtime.spawn(ref, inputs)',
      'stream AgentRun.events() to stdout',
    ],
  };

  if (opts.json === true) {
    io.stdout(`${JSON.stringify({ ok: false, stub: true, plan }, null, 2)}\n`);
  } else {
    writeLine(io, `would run: ${agent}`);
    if (opts.inputs !== undefined) writeLine(io, `  inputs: ${opts.inputs}`);
    if (opts.provider !== undefined) writeLine(io, `  provider override: ${opts.provider}`);
    if (opts.model !== undefined) writeLine(io, `  model override: ${opts.model}`);
    writeErr(io, `run: ${STUB_MSG}`);
  }
  return STUB_EXIT;
}
