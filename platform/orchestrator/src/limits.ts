/**
 * Resolve the depth + concurrency limits from env, with defaults that
 * match the wave-9 brief.
 *
 *   ALDO_MAX_AGENT_DEPTH      default 5  — max nested supervisor depth
 *   ALDO_MAX_PARALLEL_CHILDREN default 8 — max concurrent children in
 *                                          a parallel strategy
 *
 * Both are read fresh on each call so tests can mutate process.env
 * without process restarts.
 */

export const DEFAULT_MAX_AGENT_DEPTH = 5;
export const DEFAULT_MAX_PARALLEL_CHILDREN = 8;

function readPositiveInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return n;
}

export function maxAgentDepth(): number {
  return readPositiveInt('ALDO_MAX_AGENT_DEPTH', DEFAULT_MAX_AGENT_DEPTH);
}

export function maxParallelChildren(override?: number): number {
  if (override !== undefined && override >= 1) return override;
  return readPositiveInt('ALDO_MAX_PARALLEL_CHILDREN', DEFAULT_MAX_PARALLEL_CHILDREN);
}
