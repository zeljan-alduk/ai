/**
 * `meridian agent validate <file>` — zod-validate an agent spec YAML.
 *
 * Delegates to `@meridian/registry`'s `validate` via a small adapter so we
 * can inject a mock during testing. Exit code: 0 on ok, 1 on any error.
 */

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { CliIO } from '../io.js';
import { writeErr, writeLine } from '../io.js';
import { getRegistry } from '../registry-adapter.js';

export interface AgentValidateOptions {
  readonly json?: boolean;
}

export async function runAgentValidate(
  file: string,
  opts: AgentValidateOptions,
  io: CliIO,
): Promise<number> {
  const absolute = resolve(process.cwd(), file);

  let text: string;
  try {
    text = await readFile(absolute, 'utf8');
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (opts.json === true) {
      io.stdout(
        `${JSON.stringify(
          { ok: false, file: absolute, errors: [{ path: '$', message: msg }] },
          null,
          2,
        )}\n`,
      );
    } else {
      writeErr(io, `error: could not read ${absolute}: ${msg}`);
    }
    return 1;
  }

  const reg = await getRegistry();
  const result = reg.validate(text);

  if (result.ok) {
    if (opts.json === true) {
      io.stdout(`${JSON.stringify({ ok: true, file: absolute }, null, 2)}\n`);
    } else {
      writeLine(io, `ok: ${absolute}`);
    }
    return 0;
  }

  if (opts.json === true) {
    io.stdout(`${JSON.stringify({ ok: false, file: absolute, errors: result.errors }, null, 2)}\n`);
  } else {
    writeErr(io, `invalid: ${absolute}`);
    for (const err of result.errors) {
      writeErr(io, `  ${err.path}: ${err.message}`);
    }
  }
  return 1;
}
