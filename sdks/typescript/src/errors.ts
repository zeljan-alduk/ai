/**
 * Typed errors. Every method on the SDK either resolves with the
 * expected response shape or rejects with an `AldoApiError` (HTTP
 * 4xx/5xx with a parsed envelope) / `AldoNetworkError` (no response).
 */

import type { ApiErrorEnvelope } from './types.js';

export class AldoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AldoError';
  }
}

export class AldoApiError extends AldoError {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;
  readonly raw: unknown;

  constructor(args: {
    status: number;
    code: string;
    message: string;
    details?: unknown;
    raw: unknown;
  }) {
    super(`${args.status} ${args.code}: ${args.message}`);
    this.name = 'AldoApiError';
    this.status = args.status;
    this.code = args.code;
    this.details = args.details;
    this.raw = args.raw;
  }
}

export class AldoNetworkError extends AldoError {
  override readonly cause?: unknown;
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'AldoNetworkError';
    if (cause !== undefined) this.cause = cause;
  }
}

/**
 * Narrow an unknown response body into an ApiErrorEnvelope shape.
 * The server always returns this shape on non-2xx; we still defend
 * against malformed bodies (HTML error pages from a misconfigured
 * edge proxy, etc.).
 */
export function parseApiError(status: number, body: unknown): AldoApiError {
  if (
    typeof body === 'object' &&
    body !== null &&
    'error' in body &&
    typeof (body as ApiErrorEnvelope).error?.code === 'string' &&
    typeof (body as ApiErrorEnvelope).error?.message === 'string'
  ) {
    const e = (body as ApiErrorEnvelope).error;
    return new AldoApiError({
      status,
      code: e.code,
      message: e.message,
      details: e.details,
      raw: body,
    });
  }
  return new AldoApiError({
    status,
    code: 'http_error',
    message: `HTTP ${status}`,
    raw: body,
  });
}
