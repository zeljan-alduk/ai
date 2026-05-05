/**
 * Hosted-API runner for the hybrid CLI (MISSING_PIECES §14-A).
 *
 * Thin REST wrapper around the platform's `POST /v1/runs` + polling.
 * The CLI dispatches the run remotely and prints a tail-with-spinner
 * to the operator's terminal. v0 polls; a follow-up wires SSE when
 * the API surface lands.
 *
 * Runs are LLM-agnostic at this layer — the request is just
 * `{ agentName, agentVersion?, inputs?, project? }`. The hosted plane
 * picks the model from its catalog using the agent's modelPolicy +
 * the tenant's privacy tier. Identical contract to the local path.
 */

import type {
  CreateRunRequest,
  CreateRunResponse,
  GetRunResponse,
  RunDetail,
} from '@aldo-ai/api-contract';
import type { CliIO } from '../io.js';
import { writeErr, writeLine } from '../io.js';

export interface HostedRunnerConfig {
  readonly baseUrl: string;
  readonly token: string;
  /** Override `globalThis.fetch` for tests. */
  readonly fetch?: typeof globalThis.fetch;
  /** ms between status polls. Default 1500. */
  readonly pollIntervalMs?: number;
  /** ms ceiling for the entire dispatch+complete cycle. Default 600_000 (10 min). */
  readonly maxWaitMs?: number;
}

export interface HostedRunOptions {
  readonly agentName: string;
  readonly agentVersion?: string;
  readonly inputs?: unknown;
  readonly project?: string;
  /** When set, log per-poll status transitions to `io`. */
  readonly verbose?: boolean;
}

const TERMINAL_STATUSES = new Set(['completed', 'failed', 'rejected', 'canceled', 'cancelled']);

export class HostedDispatchError extends Error {
  readonly status: number;
  readonly code: string | undefined;
  readonly responseBody: string;
  constructor(status: number, code: string | undefined, message: string, body: string) {
    super(message);
    this.name = 'HostedDispatchError';
    this.status = status;
    this.code = code;
    this.responseBody = body;
  }
}

export class HostedRunTimeoutError extends Error {
  readonly runId: string;
  readonly lastStatus: string;
  constructor(runId: string, lastStatus: string, maxWaitMs: number) {
    super(
      `hosted run ${runId} did not reach a terminal status within ${maxWaitMs}ms (last: ${lastStatus}).`,
    );
    this.name = 'HostedRunTimeoutError';
    this.runId = runId;
    this.lastStatus = lastStatus;
  }
}

/**
 * Dispatch a run on the hosted plane and wait for it to reach a
 * terminal status. Returns the final RunDetail with events + usage
 * already populated.
 */
export async function runOnHostedApi(
  cfg: HostedRunnerConfig,
  opts: HostedRunOptions,
  io: CliIO,
): Promise<RunDetail> {
  const fetchImpl = cfg.fetch ?? globalThis.fetch;
  const pollIntervalMs = cfg.pollIntervalMs ?? 1500;
  const maxWaitMs = cfg.maxWaitMs ?? 600_000;

  const body: CreateRunRequest = {
    agentName: opts.agentName,
    ...(opts.agentVersion !== undefined ? { agentVersion: opts.agentVersion } : {}),
    ...(opts.inputs !== undefined ? { inputs: opts.inputs } : {}),
    ...(opts.project !== undefined ? { project: opts.project } : {}),
  };

  const dispatch = await fetchImpl(joinUrl(cfg.baseUrl, '/v1/runs'), {
    method: 'POST',
    headers: {
      authorization: `Bearer ${cfg.token}`,
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify(body),
  });
  const dispatchText = await dispatch.text();
  if (!dispatch.ok) {
    const parsed = tryParseError(dispatchText);
    throw new HostedDispatchError(
      dispatch.status,
      parsed?.code,
      parsed?.message ?? `POST /v1/runs failed: HTTP ${dispatch.status}`,
      dispatchText,
    );
  }
  const created: CreateRunResponse = JSON.parse(dispatchText);
  const runId = created.run.id;

  if (opts.verbose === true) {
    writeLine(io, `→ hosted run dispatched: ${runId} (${created.run.status})`);
  }

  // Poll until terminal. The platform's executor usually moves
  // queued → running within a few hundred ms.
  const started = Date.now();
  let lastStatus: string = created.run.status;
  while (Date.now() - started < maxWaitMs) {
    await sleep(pollIntervalMs);
    const get = await fetchImpl(joinUrl(cfg.baseUrl, `/v1/runs/${encodeURIComponent(runId)}`), {
      method: 'GET',
      headers: {
        authorization: `Bearer ${cfg.token}`,
        accept: 'application/json',
      },
    });
    const getText = await get.text();
    if (!get.ok) {
      // Transient errors during polling shouldn't kill the run; log
      // and retry.
      writeErr(io, `! poll error ${get.status}: ${getText.slice(0, 200)}`);
      continue;
    }
    const detail = (JSON.parse(getText) as GetRunResponse).run;
    if (detail.status !== lastStatus) {
      lastStatus = detail.status;
      if (opts.verbose === true) {
        writeLine(io, `… hosted run ${runId} status → ${detail.status}`);
      }
    }
    if (TERMINAL_STATUSES.has(detail.status)) {
      return detail;
    }
  }
  throw new HostedRunTimeoutError(runId, lastStatus, maxWaitMs);
}

function tryParseError(body: string): { code?: string; message?: string } | null {
  try {
    const obj = JSON.parse(body) as { error?: { code?: string; message?: string } };
    return obj.error ?? null;
  } catch {
    return null;
  }
}

function joinUrl(base: string, path: string): string {
  const trimmed = base.replace(/\/+$/, '');
  return `${trimmed}${path}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
