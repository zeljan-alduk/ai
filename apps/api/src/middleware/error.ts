/**
 * Central error handling for the control-plane API.
 *
 * Every non-2xx response goes out as the `ApiError` envelope from
 * `@aldo-ai/api-contract`. Routes throw `HttpError` (defined here) for
 * expected failures; unhandled exceptions become 500 with `code:
 * "internal_error"` and the message is masked unless `details` is
 * explicitly provided.
 *
 * Zod parse errors are caught and rendered as 400 `validation_error`s
 * with the `issues` array in `details` so the web client can highlight
 * specific fields.
 */

import type { ApiError } from '@aldo-ai/api-contract';
import type { Context, ErrorHandler } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { ZodError } from 'zod';

export class HttpError extends Error {
  public readonly status: number;
  public readonly code: string;
  public readonly details: unknown | undefined;
  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function notFound(message = 'not found', details?: unknown): HttpError {
  return new HttpError(404, 'not_found', message, details);
}

export function validationError(message: string, details?: unknown): HttpError {
  return new HttpError(400, 'validation_error', message, details);
}

function envelope(code: string, message: string, details?: unknown): ApiError {
  const out: ApiError = { error: { code, message } };
  if (details !== undefined) {
    return { error: { code, message, details } };
  }
  return out;
}

/** Hono `app.onError` handler wired in by the app builder. */
export const errorHandler: ErrorHandler = (err, c: Context) => {
  if (err instanceof HttpError) {
    // biome-ignore lint/suspicious/noExplicitAny: hono's StatusCode union is opaque
    return c.json(envelope(err.code, err.message, err.details), err.status as any);
  }
  if (err instanceof ZodError) {
    return c.json(envelope('validation_error', 'invalid request', err.issues), 400);
  }
  if (err instanceof HTTPException) {
    return c.json(envelope('http_error', err.message), err.status);
  }
  // Default: don't leak internal error messages.
  return c.json(envelope('internal_error', 'internal server error'), 500);
};
