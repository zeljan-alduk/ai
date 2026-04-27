/**
 * Typed fetch + Zod parse for the eval-harness endpoints.
 *
 * Mirrors the shape of `lib/api.ts` (envelope-checked, ApiClientError on
 * any deviation) so error handling is uniform across the control plane.
 *
 * LLM-agnostic: model identifiers are opaque `provider.model` strings —
 * we never branch on them.
 */

import {
  ApiError,
  EvalSuite,
  ListSuitesResponse,
  ListSweepsResponse,
  type PromoteAgentRequest,
  PromoteAgentResponse,
  type StartSweepRequest,
  StartSweepResponse,
  Sweep,
  type SweepStatus,
} from '@aldo-ai/api-contract';
import { z } from 'zod';
import { API_BASE, ApiClientError } from './api';

const GetSuiteResponseSchema = z.object({ suite: EvalSuite });
export type GetSuiteResponse = { suite: EvalSuite };

const GetSweepResponseSchema = z.object({ sweep: Sweep });
export type GetSweepResponse = { sweep: Sweep };

function buildUrl(path: string, query?: Record<string, string | number | undefined>): string {
  const url = new URL(path.startsWith('/') ? path : `/${path}`, API_BASE);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined || v === '') continue;
      url.searchParams.set(k, String(v));
    }
  }
  return url.toString();
}

async function parseEnvelope<T>(url: string, res: Response, schema: z.ZodType<T>): Promise<T> {
  const text = await res.text();
  let json: unknown = undefined;
  if (text.length > 0) {
    try {
      json = JSON.parse(text);
    } catch (err) {
      throw new ApiClientError('parse', `Invalid JSON from ${url}`, {
        status: res.status,
        cause: err,
      });
    }
  }

  if (!res.ok) {
    const parsedErr = ApiError.safeParse(json);
    if (parsedErr.success) {
      throw new ApiClientError(
        res.status >= 500 ? 'http_5xx' : 'http_4xx',
        parsedErr.data.error.message,
        {
          status: res.status,
          code: parsedErr.data.error.code,
          details: parsedErr.data.error.details,
        },
      );
    }
    throw new ApiClientError(
      res.status >= 500 ? 'http_5xx' : 'http_4xx',
      `HTTP ${res.status} from ${url}`,
      { status: res.status, details: json },
    );
  }

  const parsed = schema.safeParse(json ?? {});
  if (!parsed.success) {
    throw new ApiClientError('envelope', `Response from ${url} did not match the expected schema`, {
      status: res.status,
      details: parsed.error.issues,
    });
  }
  return parsed.data;
}

async function getJson<T>(
  path: string,
  schema: z.ZodType<T>,
  query?: Record<string, string | number | undefined>,
  init?: { cache?: RequestCache; signal?: AbortSignal },
): Promise<T> {
  const url = buildUrl(path, query);
  const reqInit: RequestInit = {
    headers: { accept: 'application/json' },
    cache: init?.cache ?? 'no-store',
  };
  if (init?.signal) reqInit.signal = init.signal;
  let res: Response;
  try {
    res = await fetch(url, reqInit);
  } catch (err) {
    throw new ApiClientError('network', `Network error contacting API at ${url}`, { cause: err });
  }
  return parseEnvelope(url, res, schema);
}

async function postJson<T>(path: string, body: unknown, schema: z.ZodType<T>): Promise<T> {
  const url = buildUrl(path);
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(body ?? {}),
      cache: 'no-store',
    });
  } catch (err) {
    throw new ApiClientError('network', `Network error contacting API at ${url}`, { cause: err });
  }
  return parseEnvelope(url, res, schema);
}

/* -------------------------------- Suites -------------------------------- */

export function listSuites() {
  return getJson('/v1/eval/suites', ListSuitesResponse);
}

export function getSuite(name: string): Promise<GetSuiteResponse> {
  return getJson(
    `/v1/eval/suites/${encodeURIComponent(name)}`,
    GetSuiteResponseSchema as unknown as z.ZodType<GetSuiteResponse>,
  );
}

/* -------------------------------- Sweeps -------------------------------- */

export type ListSweepsQuery = {
  agent?: string | undefined;
  status?: SweepStatus | undefined;
};

export function listSweeps(query: ListSweepsQuery = {}) {
  return getJson('/v1/eval/sweeps', ListSweepsResponse, {
    agent: query.agent,
    status: query.status,
  });
}

export function getSweep(id: string, init?: { signal?: AbortSignal }): Promise<GetSweepResponse> {
  return getJson(
    `/v1/eval/sweeps/${encodeURIComponent(id)}`,
    GetSweepResponseSchema as unknown as z.ZodType<GetSweepResponse>,
    undefined,
    init,
  );
}

export function startSweep(req: StartSweepRequest) {
  return postJson('/v1/eval/sweeps', req, StartSweepResponse);
}

/* ------------------------------ Promotion ------------------------------- */

export function promoteAgent(name: string, req: Omit<PromoteAgentRequest, 'agentName'>) {
  return postJson(
    `/v1/agents/${encodeURIComponent(name)}/promote`,
    { agentName: name, ...req },
    PromoteAgentResponse,
  );
}

/* ---------------------------- Polling helper ---------------------------- */

const TERMINAL_STATUSES = new Set<SweepStatus>(['completed', 'failed', 'cancelled']);

export function isTerminalSweepStatus(status: SweepStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}
