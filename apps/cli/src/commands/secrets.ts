/**
 * `aldo secrets ls | set | rm` — thin HTTP wrappers around `/v1/secrets`.
 *
 * The CLI never writes Postgres directly: every CRUD goes through the
 * control-plane API so the host process is the only place a master key
 * is held and the only place audit rows are written.
 *
 * `set` reads the value from one of:
 *   --value <V>            — literal CLI arg (will land in shell history;
 *                            documented as the dev-only path)
 *   --from-env <VAR>       — the named env var; the recommended path
 *   --from-file <PATH>     — file contents (trimmed of trailing newline)
 *
 * Outputs intentionally never echo the value back. `--json` produces a
 * machine-readable summary.
 */

import { readFile } from 'node:fs/promises';
import { resolve as resolvePath } from 'node:path';
import {
  ApiError,
  ListSecretsResponse,
  SetSecretResponse,
  type SecretSummary,
} from '@aldo-ai/api-contract';
import type { CliIO } from '../io.js';
import { writeErr, writeJson, writeLine } from '../io.js';

// ───────────────────────────────────────────────── shared

export interface SecretsHooks {
  /** Test seam: replace `globalThis.fetch`. */
  readonly fetch?: typeof fetch;
  /** Test seam: read env (defaults to `process.env`). */
  readonly env?: Readonly<Record<string, string | undefined>>;
}

interface BaseOptions {
  readonly json?: boolean;
  /** Override the API base URL. Defaults to `API_BASE` env, then localhost:3001. */
  readonly apiBase?: string;
}

function trimTrailingSlash(s: string): string {
  return s.endsWith('/') ? s.slice(0, -1) : s;
}

function asMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function resolveBase(opts: BaseOptions, hooks: SecretsHooks): string {
  const env = hooks.env ?? process.env;
  return trimTrailingSlash(opts.apiBase ?? env.API_BASE ?? 'http://localhost:3001');
}

async function parseError(io: CliIO, res: Response, opts: BaseOptions): Promise<void> {
  const text = await res.text();
  let parsed: unknown = null;
  if (text.length > 0) {
    try {
      parsed = JSON.parse(text);
    } catch {
      // surfaced verbatim below
    }
  }
  const apiErr = ApiError.safeParse(parsed);
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
}

// ───────────────────────────────────────────────── ls

export interface SecretsLsOptions extends BaseOptions {}

export async function runSecretsLs(
  opts: SecretsLsOptions,
  io: CliIO,
  hooks: SecretsHooks = {},
): Promise<number> {
  const url = `${resolveBase(opts, hooks)}/v1/secrets`;
  const fetchFn = hooks.fetch ?? globalThis.fetch;

  let res: Response;
  try {
    res = await fetchFn(url, { method: 'GET' });
  } catch (e) {
    writeErr(io, `error: could not GET ${url}: ${asMessage(e)}`);
    return 1;
  }
  if (!res.ok) {
    await parseError(io, res, opts);
    return 1;
  }
  const parsed = ListSecretsResponse.safeParse(await res.json());
  if (!parsed.success) {
    writeErr(io, `error: unexpected response from ${url}: ${parsed.error.message}`);
    return 1;
  }
  if (opts.json === true) {
    writeJson(io, { ok: true, secrets: parsed.data.secrets });
    return 0;
  }
  if (parsed.data.secrets.length === 0) {
    writeLine(io, 'no secrets');
    return 0;
  }
  for (const s of parsed.data.secrets) {
    writeLine(io, formatSummary(s));
  }
  return 0;
}

function formatSummary(s: SecretSummary): string {
  return `${s.name}\t****${s.preview}\t${s.fingerprint.slice(0, 8)}\tupdated ${s.updatedAt}`;
}

// ───────────────────────────────────────────────── set

export interface SecretsSetOptions extends BaseOptions {
  readonly value?: string;
  readonly fromEnv?: string;
  readonly fromFile?: string;
}

/**
 * Choose the value source. Exactly one of `--value`, `--from-env`,
 * `--from-file` must be supplied. We trim a single trailing newline
 * from file contents (a pragmatic choice; secrets stored via
 * `echo "..." > file` should not carry a stray \n).
 */
async function pickValue(
  opts: SecretsSetOptions,
  hooks: SecretsHooks,
): Promise<{ ok: true; value: string } | { ok: false; reason: string }> {
  const sources = [opts.value !== undefined, opts.fromEnv !== undefined, opts.fromFile !== undefined];
  const supplied = sources.filter(Boolean).length;
  if (supplied === 0) {
    return { ok: false, reason: 'one of --value, --from-env, --from-file is required' };
  }
  if (supplied > 1) {
    return { ok: false, reason: '--value, --from-env, --from-file are mutually exclusive' };
  }
  if (opts.value !== undefined) {
    return { ok: true, value: opts.value };
  }
  if (opts.fromEnv !== undefined) {
    const env = hooks.env ?? process.env;
    const v = env[opts.fromEnv];
    if (v === undefined || v === '') {
      return { ok: false, reason: `env var ${opts.fromEnv} is not set or empty` };
    }
    return { ok: true, value: v };
  }
  if (opts.fromFile !== undefined) {
    try {
      const raw = await readFile(resolvePath(process.cwd(), opts.fromFile), 'utf8');
      // Drop a single trailing newline so `echo X > file` doesn't pollute.
      const trimmed = raw.endsWith('\n') ? raw.slice(0, -1) : raw;
      if (trimmed.length === 0) {
        return { ok: false, reason: `file is empty: ${opts.fromFile}` };
      }
      return { ok: true, value: trimmed };
    } catch (e) {
      return { ok: false, reason: `could not read ${opts.fromFile}: ${asMessage(e)}` };
    }
  }
  return { ok: false, reason: 'unreachable' };
}

export async function runSecretsSet(
  name: string,
  opts: SecretsSetOptions,
  io: CliIO,
  hooks: SecretsHooks = {},
): Promise<number> {
  const picked = await pickValue(opts, hooks);
  if (!picked.ok) {
    writeErr(io, `error: ${picked.reason}`);
    return 1;
  }

  const url = `${resolveBase(opts, hooks)}/v1/secrets`;
  const fetchFn = hooks.fetch ?? globalThis.fetch;

  let res: Response;
  try {
    res = await fetchFn(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, value: picked.value }),
    });
  } catch (e) {
    writeErr(io, `error: could not POST ${url}: ${asMessage(e)}`);
    return 1;
  }
  if (!res.ok) {
    await parseError(io, res, opts);
    return 1;
  }
  const parsed = SetSecretResponse.safeParse(await res.json());
  if (!parsed.success) {
    writeErr(io, `error: unexpected response from ${url}: ${parsed.error.message}`);
    return 1;
  }
  if (opts.json === true) {
    writeJson(io, { ok: true, secret: parsed.data });
    return 0;
  }
  // Never echo the value. Show the summary instead.
  writeLine(io, `set ${parsed.data.name} (****${parsed.data.preview}, ${parsed.data.fingerprint.slice(0, 8)})`);
  return 0;
}

// ───────────────────────────────────────────────── rm

export interface SecretsRmOptions extends BaseOptions {}

export async function runSecretsRm(
  name: string,
  opts: SecretsRmOptions,
  io: CliIO,
  hooks: SecretsHooks = {},
): Promise<number> {
  const url = `${resolveBase(opts, hooks)}/v1/secrets/${encodeURIComponent(name)}`;
  const fetchFn = hooks.fetch ?? globalThis.fetch;

  let res: Response;
  try {
    res = await fetchFn(url, { method: 'DELETE' });
  } catch (e) {
    writeErr(io, `error: could not DELETE ${url}: ${asMessage(e)}`);
    return 1;
  }
  if (res.status === 204) {
    if (opts.json === true) {
      writeJson(io, { ok: true, name });
      return 0;
    }
    writeLine(io, `removed ${name}`);
    return 0;
  }
  await parseError(io, res, opts);
  return 1;
}
