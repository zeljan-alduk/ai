/**
 * `aldo eval suite create <file>` — upload an eval-suite YAML to the
 * control-plane API.
 *
 * The CLI never writes Postgres directly: every suite registration
 * goes through `POST /v1/eval/suites` so the API enforces validation,
 * dedupe, and audit. This command is the thin wrapper around fetch.
 *
 * Endpoint contract:
 *   request:  CreateSuiteRequest  { yaml: string }
 *   response: CreateSuiteResponse { name, version, caseCount }
 *
 * Configuration:
 *   - API_BASE env var (defaults to `http://localhost:3001`)
 *   - --json flag for machine output; otherwise prints a one-line summary
 */

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  ApiError,
  CreateSuiteResponse,
  type CreateSuiteResponse as CreateSuiteResponseT,
} from '@aldo-ai/api-contract';
import type { CliIO } from '../io.js';
import { writeErr, writeJson, writeLine } from '../io.js';

export interface EvalSuiteCreateOptions {
  readonly json?: boolean;
  /** Override API base URL. Defaults to `process.env.API_BASE` then `http://localhost:3001`. */
  readonly apiBase?: string;
}

export interface EvalSuiteCreateHooks {
  /** Test seam: replace `globalThis.fetch`. */
  readonly fetch?: typeof fetch;
  /** Test seam: read env (defaults to `process.env`). */
  readonly env?: Readonly<Record<string, string | undefined>>;
}

export async function runEvalSuiteCreate(
  file: string,
  opts: EvalSuiteCreateOptions,
  io: CliIO,
  hooks: EvalSuiteCreateHooks = {},
): Promise<number> {
  const path = resolve(process.cwd(), file);
  let yaml: string;
  try {
    yaml = await readFile(path, 'utf8');
  } catch (e) {
    writeErr(io, `error: could not read suite ${path}: ${asMessage(e)}`);
    return 1;
  }

  const env = hooks.env ?? process.env;
  const base = opts.apiBase ?? env.API_BASE ?? 'http://localhost:3001';
  const url = `${trimTrailingSlash(base)}/v1/eval/suites`;
  const fetchFn = hooks.fetch ?? globalThis.fetch;

  let res: Response;
  try {
    res = await fetchFn(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ yaml }),
    });
  } catch (e) {
    writeErr(io, `error: could not POST ${url}: ${asMessage(e)}`);
    return 1;
  }

  const text = await res.text();
  let parsedJson: unknown = null;
  if (text.length > 0) {
    try {
      parsedJson = JSON.parse(text);
    } catch {
      // Non-JSON body — surfaced verbatim below.
    }
  }

  if (!res.ok) {
    const apiErr = ApiError.safeParse(parsedJson);
    if (opts.json === true) {
      writeJson(io, {
        ok: false,
        status: res.status,
        ...(apiErr.success ? { error: apiErr.data.error } : { body: text }),
      });
    } else if (apiErr.success) {
      writeErr(io, `error: ${apiErr.data.error.code}: ${apiErr.data.error.message}`);
    } else {
      writeErr(io, `error: HTTP ${res.status}: ${text || res.statusText}`);
    }
    return 1;
  }

  const parsed = CreateSuiteResponse.safeParse(parsedJson);
  if (!parsed.success) {
    writeErr(io, `error: unexpected response shape from ${url}: ${parsed.error.message}`);
    return 1;
  }
  const body: CreateSuiteResponseT = parsed.data;

  if (opts.json === true) {
    writeJson(io, { ok: true, ...body });
    return 0;
  }
  writeLine(io, `created ${body.name}@${body.version} (${body.caseCount} cases)`);
  return 0;
}

function asMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function trimTrailingSlash(s: string): string {
  return s.endsWith('/') ? s.slice(0, -1) : s;
}
