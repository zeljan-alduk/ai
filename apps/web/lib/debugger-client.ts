/**
 * Typed SSE client + command POSTers for the replay debugger.
 *
 * Every event coming over the wire is validated through the
 * `DebugRunEvent` discriminated union from `@aldo-ai/api-contract` —
 * we never trust the wire. The same module exposes the four debugger
 * commands (continue, edit-and-resume, swap-model, breakpoint toggle)
 * which POST through `lib/api.ts` style envelopes.
 *
 * LLM-agnostic: provider/model strings are opaque values rendered as-is.
 */

import {
  ApiError,
  Breakpoint,
  type ContinueCommand,
  CreateBreakpointRequest,
  DebugRunEvent,
  type EditAndResumeCommand,
  ListBreakpointsResponse,
  type SwapModelCommand,
} from '@aldo-ai/api-contract';
import { z } from 'zod';
import { API_BASE, ApiClientError } from './api';

/* -------------------------- SSE event stream --------------------------- */

export type DebuggerStreamHandlers = {
  onEvent: (event: DebugRunEvent) => void;
  onOpen?: () => void;
  onError?: (err: Error) => void;
  onStatusChange?: (status: 'connecting' | 'open' | 'closed' | 'reconnecting') => void;
};

export type DebuggerStream = {
  /** Tear down both the EventSource and any pending reconnect timer. */
  close: () => void;
};

/**
 * Open an SSE stream against `/v1/runs/:id/events` and dispatch validated
 * events to the caller. Reconnects with exponential backoff (1s → 30s,
 * capped) on close. We use the browser-native `EventSource` — every modern
 * browser supports it, SSE doesn't need credentials, and we explicitly do
 * not want to drag in a polyfill or reach for WebSocket.
 */
export function openDebuggerStream(
  runId: string,
  handlers: DebuggerStreamHandlers,
): DebuggerStream {
  let closed = false;
  let backoffMs = 1_000;
  let source: EventSource | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  const setStatus = (s: 'connecting' | 'open' | 'closed' | 'reconnecting') => {
    handlers.onStatusChange?.(s);
  };

  const connect = () => {
    if (closed) return;
    setStatus(source ? 'reconnecting' : 'connecting');

    const url = `${API_BASE}/v1/runs/${encodeURIComponent(runId)}/events`;
    let es: EventSource;
    try {
      es = new EventSource(url);
    } catch (err) {
      handlers.onError?.(err instanceof Error ? err : new Error(String(err)));
      scheduleReconnect();
      return;
    }
    source = es;

    es.onopen = () => {
      backoffMs = 1_000;
      setStatus('open');
      handlers.onOpen?.();
    };

    es.onmessage = (ev: MessageEvent<string>) => {
      let parsedJson: unknown;
      try {
        parsedJson = JSON.parse(ev.data);
      } catch (err) {
        handlers.onError?.(new Error(`Invalid JSON in SSE frame: ${(err as Error).message}`));
        return;
      }
      const result = DebugRunEvent.safeParse(parsedJson);
      if (!result.success) {
        handlers.onError?.(
          new Error(`SSE frame failed DebugRunEvent validation: ${result.error.message}`),
        );
        return;
      }
      handlers.onEvent(result.data);
    };

    es.onerror = () => {
      // EventSource auto-reconnects on transient errors, but on a hard
      // close (server end) it transitions to CLOSED. Treat it uniformly:
      // tear down and reconnect ourselves with backoff so we control
      // the cap.
      es.close();
      if (source === es) source = null;
      if (closed) return;
      handlers.onError?.(new Error('SSE connection lost'));
      scheduleReconnect();
    };
  };

  const scheduleReconnect = () => {
    if (closed) return;
    setStatus('reconnecting');
    const delay = Math.min(backoffMs, 30_000);
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      backoffMs = Math.min(backoffMs * 2, 30_000);
      connect();
    }, delay);
  };

  connect();

  return {
    close() {
      closed = true;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      if (source) {
        source.close();
        source = null;
      }
      setStatus('closed');
    },
  };
}

/* ----------------------------- Commands -------------------------------- */

async function postJson<T>(path: string, body: unknown, schema: z.ZodType<T>): Promise<T> {
  const url = `${API_BASE}${path}`;
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

async function deleteJson<T>(path: string, schema: z.ZodType<T>): Promise<T> {
  const url = `${API_BASE}${path}`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'DELETE',
      headers: { accept: 'application/json' },
      cache: 'no-store',
    });
  } catch (err) {
    throw new ApiClientError('network', `Network error contacting API at ${url}`, { cause: err });
  }
  return parseEnvelope(url, res, schema);
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

  // For 204 No Content, accept anything that the schema can parse from undefined.
  const parsed = schema.safeParse(json ?? {});
  if (!parsed.success) {
    throw new ApiClientError('envelope', `Response from ${url} did not match the expected schema`, {
      status: res.status,
      details: parsed.error.issues,
    });
  }
  return parsed.data;
}

/** Continue a paused run — `mode: 'run'` to free-run, `'step'` to single-step. */
export const ContinueResponse = z.object({ ok: z.literal(true) });
export type ContinueResponse = z.infer<typeof ContinueResponse>;

export function continueRun(runId: string, cmd: ContinueCommand) {
  return postJson(`/v1/runs/${encodeURIComponent(runId)}/continue`, cmd, ContinueResponse);
}

/** Edit a message in a checkpoint and resume from there. Server forks the
 *  run and returns the new run id; the UI navigates to it. */
export const EditAndResumeResponse = z.object({ newRunId: z.string() });
export type EditAndResumeResponse = z.infer<typeof EditAndResumeResponse>;

export function editAndResume(runId: string, cmd: EditAndResumeCommand) {
  return postJson(
    `/v1/runs/${encodeURIComponent(runId)}/edit-and-resume`,
    cmd,
    EditAndResumeResponse,
  );
}

/** Swap the model from a checkpoint. The server forks the run (keeping
 *  the original intact) and returns the new run id. ASSUMPTION (engineer
 *  B's contract): swap-model returns `{ newRunId }` so the UI can
 *  navigate; if the server later decides to mutate the run in-place it
 *  can return the same id and navigation is a no-op. */
export const SwapModelResponse = z.object({ newRunId: z.string() });
export type SwapModelResponse = z.infer<typeof SwapModelResponse>;

export function swapModel(runId: string, cmd: SwapModelCommand) {
  return postJson(`/v1/runs/${encodeURIComponent(runId)}/swap-model`, cmd, SwapModelResponse);
}

/** Cancel a run. */
export const CancelResponse = z.object({ ok: z.literal(true) });
export type CancelResponse = z.infer<typeof CancelResponse>;

export function cancelRun(runId: string) {
  return postJson(`/v1/runs/${encodeURIComponent(runId)}/cancel`, {}, CancelResponse);
}

/* --------------------------- Breakpoints -------------------------------- */

export function listBreakpoints(runId: string) {
  return fetch(`${API_BASE}/v1/runs/${encodeURIComponent(runId)}/breakpoints`, {
    headers: { accept: 'application/json' },
    cache: 'no-store',
  }).then((res) => parseEnvelope(`/v1/runs/${runId}/breakpoints`, res, ListBreakpointsResponse));
}

export const CreateBreakpointResponse = z.object({ breakpoint: Breakpoint });
export type CreateBreakpointResponse = z.infer<typeof CreateBreakpointResponse>;

export function createBreakpoint(runId: string, req: CreateBreakpointRequest) {
  return postJson(
    `/v1/runs/${encodeURIComponent(runId)}/breakpoints`,
    req,
    CreateBreakpointResponse,
  );
}

export const ToggleBreakpointResponse = z.object({ breakpoint: Breakpoint });
export type ToggleBreakpointResponse = z.infer<typeof ToggleBreakpointResponse>;

export function toggleBreakpoint(runId: string, bpId: string, enabled: boolean) {
  return postJson(
    `/v1/runs/${encodeURIComponent(runId)}/breakpoints/${encodeURIComponent(bpId)}/toggle`,
    { enabled },
    ToggleBreakpointResponse,
  );
}

export const DeleteBreakpointResponse = z.object({ ok: z.literal(true) });
export type DeleteBreakpointResponse = z.infer<typeof DeleteBreakpointResponse>;

export function deleteBreakpoint(runId: string, bpId: string) {
  return deleteJson(
    `/v1/runs/${encodeURIComponent(runId)}/breakpoints/${encodeURIComponent(bpId)}`,
    DeleteBreakpointResponse,
  );
}

/* ---------------------------- Re-exports ------------------------------- */

export { CreateBreakpointRequest };
export type { Breakpoint, ContinueCommand, EditAndResumeCommand, SwapModelCommand };
