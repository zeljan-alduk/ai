/**
 * Typed fetch client for the ALDO AI control-plane API.
 *
 * Every response is parsed through the corresponding @aldo-ai/api-contract
 * Zod schema — never trust the wire. On parse failure or non-2xx status we
 * throw a typed `ApiClientError` that the page-level error boundary turns
 * into a clean error UI (never a stack trace).
 *
 * LLM-agnostic: this module never references a specific provider name.
 * Provider strings come back from the server as opaque values and are
 * displayed as-is.
 */

import {
  ApiError,
  GetAgentResponse,
  GetRunResponse,
  type ListAgentsQuery,
  ListAgentsResponse,
  ListModelsResponse,
  type ListRunsQuery,
  ListRunsResponse,
} from '@aldo-ai/api-contract';
import type { z } from 'zod';

export const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? 'http://localhost:3001';

export type ApiClientErrorKind = 'network' | 'http_4xx' | 'http_5xx' | 'parse' | 'envelope';

export class ApiClientError extends Error {
  readonly kind: ApiClientErrorKind;
  readonly status: number | undefined;
  readonly code: string | undefined;
  readonly details: unknown;

  constructor(
    kind: ApiClientErrorKind,
    message: string,
    opts: {
      status?: number;
      code?: string;
      details?: unknown;
      cause?: unknown;
    } = {},
  ) {
    super(message);
    this.name = 'ApiClientError';
    this.kind = kind;
    this.status = opts.status;
    this.code = opts.code;
    this.details = opts.details;
    if (opts.cause !== undefined) (this as { cause?: unknown }).cause = opts.cause;
  }
}

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

async function request<T>(
  path: string,
  schema: z.ZodType<T>,
  init: RequestInit & { query?: Record<string, string | number | undefined> } = {},
): Promise<T> {
  const { query, ...rest } = init;
  const url = buildUrl(path, query);

  let res: Response;
  try {
    res = await fetch(url, {
      ...rest,
      headers: {
        accept: 'application/json',
        ...(rest.headers ?? {}),
      },
      // Server components: fresh fetches; keep cache off for v0.
      cache: 'no-store',
    });
  } catch (err) {
    throw new ApiClientError('network', `Network error contacting API at ${url}`, {
      cause: err,
    });
  }

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

  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    throw new ApiClientError('envelope', `Response from ${url} did not match the expected schema`, {
      status: res.status,
      details: parsed.error.issues,
    });
  }
  return parsed.data;
}

/* -------------------------------- Runs ---------------------------------- */

export function listRuns(query: Partial<ListRunsQuery> = {}) {
  return request('/v1/runs', ListRunsResponse, { query });
}

export function getRun(id: string) {
  return request(`/v1/runs/${encodeURIComponent(id)}`, GetRunResponse);
}

/* ------------------------------- Agents --------------------------------- */

export function listAgents(query: Partial<ListAgentsQuery> = {}) {
  return request('/v1/agents', ListAgentsResponse, { query });
}

export function getAgent(name: string) {
  return request(`/v1/agents/${encodeURIComponent(name)}`, GetAgentResponse);
}

/* ------------------------------- Models --------------------------------- */

export function listModels() {
  return request('/v1/models', ListModelsResponse);
}
