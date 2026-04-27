/**
 * `aldo datasets {ls,new,import,show,destroy}` — wave-16.
 *
 * Thin wrappers around the control-plane `/v1/datasets` API so that CLI
 * users can author + maintain eval datasets from a script. The CLI
 * never writes Postgres directly: every mutation goes through the API
 * so audit + RBAC stay centralised.
 *
 * `import` accepts a JSON, JSONL, or CSV file and sends a multipart
 * upload to `/v1/datasets/:id/import`. The format is detected from the
 * filename extension when not explicitly set via `--format`.
 *
 * LLM-agnostic: dataset payloads never name a provider; capability
 * classes are pure-string fields that the gateway interprets at run
 * time.
 */

import { readFile } from 'node:fs/promises';
import { basename, extname, resolve as resolvePath } from 'node:path';
import {
  ApiError,
  BulkCreateDatasetExamplesResponse,
  type Dataset,
  ListDatasetsResponse,
} from '@aldo-ai/api-contract';
import { z } from 'zod';
import type { CliIO } from '../io.js';
import { writeErr, writeJson, writeLine } from '../io.js';

// ───────────────────────────────────────────────── shared

export interface DatasetsHooks {
  /** Test seam: replace `globalThis.fetch`. */
  readonly fetch?: typeof fetch;
  readonly env?: Readonly<Record<string, string | undefined>>;
}

interface BaseOptions {
  readonly json?: boolean;
  readonly apiBase?: string;
}

const DatasetEnvelope = z.object({ dataset: z.unknown() });

function trimTrailingSlash(s: string): string {
  return s.endsWith('/') ? s.slice(0, -1) : s;
}

function asMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function resolveBase(opts: BaseOptions, hooks: DatasetsHooks): string {
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
      // surfaced verbatim
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

function formatDatasetRow(d: Dataset): string {
  const tags = d.tags.length === 0 ? '-' : d.tags.join(',');
  return `${d.id}\t${d.name}\t${d.exampleCount}\t${tags}\tupdated ${d.updatedAt}`;
}

// ───────────────────────────────────────────────── ls

export async function runDatasetsLs(
  opts: BaseOptions,
  io: CliIO,
  hooks: DatasetsHooks = {},
): Promise<number> {
  const url = `${resolveBase(opts, hooks)}/v1/datasets`;
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
  const parsed = ListDatasetsResponse.safeParse(await res.json());
  if (!parsed.success) {
    writeErr(io, `error: unexpected response from ${url}: ${parsed.error.message}`);
    return 1;
  }
  if (opts.json === true) {
    writeJson(io, { ok: true, datasets: parsed.data.datasets });
    return 0;
  }
  if (parsed.data.datasets.length === 0) {
    writeLine(io, 'no datasets');
    return 0;
  }
  for (const d of parsed.data.datasets) writeLine(io, formatDatasetRow(d));
  return 0;
}

// ───────────────────────────────────────────────── new

export interface DatasetsNewOptions extends BaseOptions {
  readonly description?: string;
  readonly tags?: string;
}

export async function runDatasetsNew(
  name: string,
  opts: DatasetsNewOptions,
  io: CliIO,
  hooks: DatasetsHooks = {},
): Promise<number> {
  if (!name || name.trim().length === 0) {
    writeErr(io, 'error: name is required');
    return 1;
  }
  const tags =
    opts.tags === undefined
      ? []
      : opts.tags
          .split(',')
          .map((t) => t.trim().toLowerCase())
          .filter((t) => t.length > 0);

  const url = `${resolveBase(opts, hooks)}/v1/datasets`;
  const fetchFn = hooks.fetch ?? globalThis.fetch;

  const body = {
    name,
    description: opts.description ?? '',
    tags,
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
  const json = (await res.json()) as { dataset?: Dataset };
  const env = DatasetEnvelope.safeParse(json);
  if (!env.success) {
    writeErr(io, `error: unexpected response: ${env.error.message}`);
    return 1;
  }
  const ds = json.dataset as Dataset;
  if (opts.json === true) {
    writeJson(io, { ok: true, dataset: ds });
    return 0;
  }
  writeLine(io, `created dataset ${ds.id}\t${ds.name}`);
  return 0;
}

// ───────────────────────────────────────────────── import

export type ImportFormat = 'csv' | 'jsonl' | 'json';

export interface DatasetsImportOptions extends BaseOptions {
  readonly format?: ImportFormat;
}

function detectFormat(filePath: string): ImportFormat {
  const ext = extname(filePath).toLowerCase();
  if (ext === '.csv') return 'csv';
  if (ext === '.jsonl' || ext === '.ndjson') return 'jsonl';
  return 'json';
}

export async function runDatasetsImport(
  datasetId: string,
  filePath: string,
  opts: DatasetsImportOptions,
  io: CliIO,
  hooks: DatasetsHooks = {},
): Promise<number> {
  if (!datasetId) {
    writeErr(io, 'error: dataset id is required');
    return 1;
  }
  if (!filePath) {
    writeErr(io, 'error: file path is required');
    return 1;
  }
  const resolved = resolvePath(process.cwd(), filePath);
  // Single-step read — no stat-then-read TOCTOU. readFile errors with
  // ENOENT when the path is missing, which we handle as a single error.
  let raw: string;
  try {
    raw = await readFile(resolved, 'utf8');
  } catch (e) {
    writeErr(io, `error: could not read ${resolved}: ${asMessage(e)}`);
    return 1;
  }
  const format = opts.format ?? detectFormat(resolved);

  const url = `${resolveBase(opts, hooks)}/v1/datasets/${encodeURIComponent(datasetId)}/import`;
  const fetchFn = hooks.fetch ?? globalThis.fetch;

  const form = new FormData();
  // Content-Type per format; the API uses both the filename and the
  // mime-type to decide the parser.
  const mime =
    format === 'csv'
      ? 'text/csv'
      : format === 'jsonl'
        ? 'application/x-ndjson'
        : 'application/json';
  form.append('file', new Blob([raw], { type: mime }), basename(resolved));

  let res: Response;
  try {
    res = await fetchFn(url, { method: 'POST', body: form });
  } catch (e) {
    writeErr(io, `error: could not POST ${url}: ${asMessage(e)}`);
    return 1;
  }
  if (!res.ok) {
    await parseError(io, res, opts);
    return 1;
  }
  const parsed = BulkCreateDatasetExamplesResponse.safeParse(await res.json());
  if (!parsed.success) {
    writeErr(io, `error: unexpected response: ${parsed.error.message}`);
    return 1;
  }
  if (opts.json === true) {
    writeJson(io, { ok: true, ...parsed.data });
    return 0;
  }
  writeLine(
    io,
    `imported ${parsed.data.inserted} row${parsed.data.inserted === 1 ? '' : 's'} (skipped ${parsed.data.skipped}, errors ${parsed.data.errors.length})`,
  );
  for (const e of parsed.data.errors) {
    writeLine(io, `  row ${e.index}: ${e.message}`);
  }
  return parsed.data.errors.length === 0 ? 0 : 1;
}

// ───────────────────────────────────────────────── show

export async function runDatasetsShow(
  datasetId: string,
  opts: BaseOptions,
  io: CliIO,
  hooks: DatasetsHooks = {},
): Promise<number> {
  if (!datasetId) {
    writeErr(io, 'error: dataset id is required');
    return 1;
  }
  const url = `${resolveBase(opts, hooks)}/v1/datasets/${encodeURIComponent(datasetId)}`;
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
  const json = (await res.json()) as { dataset?: Dataset };
  const env = DatasetEnvelope.safeParse(json);
  if (!env.success) {
    writeErr(io, `error: unexpected response: ${env.error.message}`);
    return 1;
  }
  const ds = json.dataset as Dataset;
  if (opts.json === true) {
    writeJson(io, { ok: true, dataset: ds });
    return 0;
  }
  writeLine(io, `id:           ${ds.id}`);
  writeLine(io, `name:         ${ds.name}`);
  writeLine(io, `examples:     ${ds.exampleCount}`);
  writeLine(io, `tags:         ${ds.tags.join(', ') || '-'}`);
  writeLine(io, `updated:      ${ds.updatedAt}`);
  if (ds.description) writeLine(io, `description:  ${ds.description}`);
  return 0;
}

// ───────────────────────────────────────────────── destroy

export async function runDatasetsDestroy(
  datasetId: string,
  opts: BaseOptions,
  io: CliIO,
  hooks: DatasetsHooks = {},
): Promise<number> {
  if (!datasetId) {
    writeErr(io, 'error: dataset id is required');
    return 1;
  }
  const url = `${resolveBase(opts, hooks)}/v1/datasets/${encodeURIComponent(datasetId)}`;
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
      writeJson(io, { ok: true, id: datasetId });
      return 0;
    }
    writeLine(io, `removed ${datasetId}`);
    return 0;
  }
  await parseError(io, res, opts);
  return 1;
}
