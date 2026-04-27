/**
 * `aldo openapi {dump,validate}` — pipe-friendly access to the
 * canonical OpenAPI 3.1 spec.
 *
 *   - `aldo openapi dump --format json|yaml` writes the spec to stdout.
 *     Useful for piping into `openapi-generator`, `oapi-codegen`,
 *     `swagger-cli`, etc.
 *   - `aldo openapi validate <file>` runs our structural validator
 *     against a saved spec.
 */

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { buildOpenApiSpec, dumpYaml, validateOpenApi } from '@aldo-ai/openapi';
import type { CliIO } from '../io.js';
import { writeErr, writeLine } from '../io.js';

export interface OpenApiDumpOptions {
  readonly format?: 'json' | 'yaml';
  readonly version?: string;
}

export async function runOpenApiDump(opts: OpenApiDumpOptions, io: CliIO): Promise<number> {
  const fmt = opts.format ?? 'json';
  if (fmt !== 'json' && fmt !== 'yaml') {
    writeErr(io, `error: --format must be json or yaml (got ${String(fmt)})`);
    return 2;
  }
  const spec = buildOpenApiSpec({ version: opts.version ?? '0.0.0' });
  if (fmt === 'yaml') {
    io.stdout(dumpYaml(spec));
  } else {
    io.stdout(`${JSON.stringify(spec, null, 2)}\n`);
  }
  return 0;
}

export interface OpenApiValidateOptions {
  readonly json?: boolean;
}

export async function runOpenApiValidate(
  file: string,
  opts: OpenApiValidateOptions,
  io: CliIO,
): Promise<number> {
  const abs = resolve(process.cwd(), file);
  let text: string;
  try {
    text = await readFile(abs, 'utf8');
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    writeErr(io, `error: could not read ${abs}: ${msg}`);
    return 1;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (opts.json === true) {
      io.stdout(
        `${JSON.stringify(
          {
            ok: false,
            file: abs,
            issues: [{ path: '$', message: `invalid JSON: ${msg}` }],
          },
          null,
          2,
        )}\n`,
      );
    } else {
      writeErr(io, `invalid: ${abs}: not parseable as JSON: ${msg}`);
    }
    return 1;
  }

  const result = validateOpenApi(parsed);
  if (result.ok) {
    if (opts.json === true) {
      io.stdout(`${JSON.stringify({ ok: true, file: abs }, null, 2)}\n`);
    } else {
      writeLine(io, `ok: ${abs}`);
    }
    return 0;
  }
  if (opts.json === true) {
    io.stdout(`${JSON.stringify({ ok: false, file: abs, issues: [...result.issues] }, null, 2)}\n`);
  } else {
    writeErr(io, `invalid: ${abs}`);
    for (const issue of result.issues) {
      writeErr(io, `  ${issue.path}: ${issue.message}`);
    }
  }
  return 1;
}
