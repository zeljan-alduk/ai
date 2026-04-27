/**
 * `aldo evaluators {ls,new,test}` — wave-16.
 *
 * Thin wrappers around the control-plane `/v1/evaluators` API.
 *
 * `new` accepts a `--config` JSON string (or `--config-file <path>`) so
 * llm_judge configs (with embedded prompts + output schemas) can be
 * authored in an editor and shipped to the API in one shot.
 *
 * `test` runs an evaluator against a sample (output + optional
 * input/expected) and prints the pass/score result. The endpoint
 * accepts both a saved evaluator id and inline `kind`+`config` for
 * a "test before save" flow.
 *
 * LLM-agnostic: llm_judge configs carry a capability-class string
 * (e.g. `reasoning-medium`); the gateway picks the actual model.
 */

import { readFile } from 'node:fs/promises';
import { resolve as resolvePath } from 'node:path';
import {
  ApiError,
  type Evaluator,
  type EvaluatorKind,
  ListEvaluatorsResponse,
  TestEvaluatorResponse,
} from '@aldo-ai/api-contract';
import { z } from 'zod';
import type { CliIO } from '../io.js';
import { writeErr, writeJson, writeLine } from '../io.js';

// ───────────────────────────────────────────────── shared

export interface EvaluatorsHooks {
  readonly fetch?: typeof fetch;
  readonly env?: Readonly<Record<string, string | undefined>>;
}

interface BaseOptions {
  readonly json?: boolean;
  readonly apiBase?: string;
}

const VALID_KINDS: ReadonlyArray<EvaluatorKind> = [
  'exact_match',
  'contains',
  'regex',
  'json_schema',
  'llm_judge',
];

const EvaluatorEnvelope = z.object({ evaluator: z.unknown() });

function trimTrailingSlash(s: string): string {
  return s.endsWith('/') ? s.slice(0, -1) : s;
}

function asMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function resolveBase(opts: BaseOptions, hooks: EvaluatorsHooks): string {
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
      // fall through
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

function formatEvaluatorRow(e: Evaluator): string {
  return `${e.id}\t${e.kind}\t${e.name}\t${e.isShared ? 'shared' : 'private'}`;
}

// ───────────────────────────────────────────────── ls

export async function runEvaluatorsLs(
  opts: BaseOptions,
  io: CliIO,
  hooks: EvaluatorsHooks = {},
): Promise<number> {
  const url = `${resolveBase(opts, hooks)}/v1/evaluators`;
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
  const parsed = ListEvaluatorsResponse.safeParse(await res.json());
  if (!parsed.success) {
    writeErr(io, `error: unexpected response: ${parsed.error.message}`);
    return 1;
  }
  if (opts.json === true) {
    writeJson(io, { ok: true, evaluators: parsed.data.evaluators });
    return 0;
  }
  if (parsed.data.evaluators.length === 0) {
    writeLine(io, 'no evaluators');
    return 0;
  }
  for (const e of parsed.data.evaluators) writeLine(io, formatEvaluatorRow(e));
  return 0;
}

// ───────────────────────────────────────────────── new

export interface EvaluatorsNewOptions extends BaseOptions {
  readonly kind: string;
  readonly config?: string;
  readonly configFile?: string;
  readonly shared?: boolean;
}

async function loadConfig(opts: { config?: string; configFile?: string }): Promise<
  { ok: true; config: Record<string, unknown> } | { ok: false; reason: string }
> {
  if (opts.config !== undefined && opts.configFile !== undefined) {
    return { ok: false, reason: '--config and --config-file are mutually exclusive' };
  }
  let raw: string | undefined;
  if (opts.config !== undefined) raw = opts.config;
  else if (opts.configFile !== undefined) {
    try {
      raw = await readFile(resolvePath(process.cwd(), opts.configFile), 'utf8');
    } catch (e) {
      return { ok: false, reason: `could not read ${opts.configFile}: ${asMessage(e)}` };
    }
  }
  if (raw === undefined) return { ok: true, config: {} };
  try {
    const parsed = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { ok: false, reason: 'config must be a JSON object' };
    }
    return { ok: true, config: parsed as Record<string, unknown> };
  } catch (e) {
    return { ok: false, reason: `invalid JSON in config: ${asMessage(e)}` };
  }
}

export async function runEvaluatorsNew(
  name: string,
  opts: EvaluatorsNewOptions,
  io: CliIO,
  hooks: EvaluatorsHooks = {},
): Promise<number> {
  if (!name || name.trim().length === 0) {
    writeErr(io, 'error: name is required');
    return 1;
  }
  if (!VALID_KINDS.includes(opts.kind as EvaluatorKind)) {
    writeErr(
      io,
      `error: --kind must be one of ${VALID_KINDS.join(', ')} (got ${JSON.stringify(opts.kind)})`,
    );
    return 1;
  }
  const cfg = await loadConfig(opts);
  if (!cfg.ok) {
    writeErr(io, `error: ${cfg.reason}`);
    return 1;
  }

  const url = `${resolveBase(opts, hooks)}/v1/evaluators`;
  const fetchFn = hooks.fetch ?? globalThis.fetch;
  const body = {
    name,
    kind: opts.kind as EvaluatorKind,
    config: cfg.config,
    isShared: opts.shared === true,
  };

  let res: Response;
  try {
    res = await fetchFn(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (e) {
    writeErr(io, `error: could not POST ${url}: ${asMessage(e)}`);
    return 1;
  }
  if (!res.ok) {
    await parseError(io, res, opts);
    return 1;
  }
  const json = (await res.json()) as { evaluator?: Evaluator };
  const env = EvaluatorEnvelope.safeParse(json);
  if (!env.success) {
    writeErr(io, `error: unexpected response: ${env.error.message}`);
    return 1;
  }
  const ev = json.evaluator as Evaluator;
  if (opts.json === true) {
    writeJson(io, { ok: true, evaluator: ev });
    return 0;
  }
  writeLine(io, `created evaluator ${ev.id}\t${ev.kind}\t${ev.name}`);
  return 0;
}

// ───────────────────────────────────────────────── test

export interface EvaluatorsTestOptions extends BaseOptions {
  readonly id?: string;
  readonly kind?: string;
  readonly config?: string;
  readonly configFile?: string;
  readonly output: string;
  readonly expected?: string;
  readonly input?: string;
}

export async function runEvaluatorsTest(
  opts: EvaluatorsTestOptions,
  io: CliIO,
  hooks: EvaluatorsHooks = {},
): Promise<number> {
  if (opts.output === undefined || opts.output.length === 0) {
    writeErr(io, 'error: --output is required');
    return 1;
  }
  if (!opts.id && !opts.kind) {
    writeErr(io, 'error: either --id <evaluator-id> or --kind <kind> is required');
    return 1;
  }
  if (opts.id && opts.kind) {
    writeErr(io, 'error: --id and --kind are mutually exclusive');
    return 1;
  }
  if (opts.kind && !VALID_KINDS.includes(opts.kind as EvaluatorKind)) {
    writeErr(
      io,
      `error: --kind must be one of ${VALID_KINDS.join(', ')} (got ${JSON.stringify(opts.kind)})`,
    );
    return 1;
  }
  let config: Record<string, unknown> | undefined;
  if (opts.kind) {
    const cfg = await loadConfig(opts);
    if (!cfg.ok) {
      writeErr(io, `error: ${cfg.reason}`);
      return 1;
    }
    config = cfg.config;
  }

  const path = opts.id
    ? `/v1/evaluators/${encodeURIComponent(opts.id)}/test`
    : '/v1/evaluators/test';
  const url = `${resolveBase(opts, hooks)}${path}`;
  const fetchFn = hooks.fetch ?? globalThis.fetch;
  const body: Record<string, unknown> = {
    output: opts.output,
  };
  if (opts.id) body.evaluatorId = opts.id;
  if (opts.kind) body.kind = opts.kind;
  if (config) body.config = config;
  if (opts.expected !== undefined) body.expected = opts.expected;
  if (opts.input !== undefined) body.input = opts.input;

  let res: Response;
  try {
    res = await fetchFn(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (e) {
    writeErr(io, `error: could not POST ${url}: ${asMessage(e)}`);
    return 1;
  }
  if (!res.ok) {
    await parseError(io, res, opts);
    return 1;
  }
  const parsed = TestEvaluatorResponse.safeParse(await res.json());
  if (!parsed.success) {
    writeErr(io, `error: unexpected response: ${parsed.error.message}`);
    return 1;
  }
  if (opts.json === true) {
    writeJson(io, { ok: true, ...parsed.data });
    return parsed.data.passed ? 0 : 1;
  }
  writeLine(io, `${parsed.data.passed ? 'PASS' : 'FAIL'}\tscore=${parsed.data.score.toFixed(3)}`);
  return parsed.data.passed ? 0 : 1;
}
