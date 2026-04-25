/**
 * One-line access log: `method path status durationMs`.
 *
 * No structured fields yet — wave 5 swaps this for an OTEL span exporter
 * that hangs off the same context. Keeping it stdout-only here so the
 * dev shell remains readable and tests don't drown.
 */

import type { MiddlewareHandler } from 'hono';

export interface LoggerOptions {
  readonly write?: (line: string) => void;
}

export function logger(opts: LoggerOptions = {}): MiddlewareHandler {
  const write = opts.write ?? ((line: string) => console.log(line));
  return async (c, next) => {
    const start = Date.now();
    await next();
    const durationMs = Date.now() - start;
    write(`${c.req.method} ${c.req.path} ${c.res.status} ${durationMs}ms`);
  };
}
