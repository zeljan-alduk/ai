/**
 * Resolve `secret://<NAME>` references inside arbitrary payloads.
 *
 * Two entry points:
 *
 *   * `resolveRefs(text, store, ctx)` walks a single string and
 *     substitutes each `${secret://X}` / `secret://X` reference. Throws
 *     `UnknownSecretError` if any name fails to resolve — callers
 *     should treat that as a configuration error and refuse the tool
 *     call.
 *
 *   * `resolveInArgs(args, store, ctx)` walks an arbitrary JSON-shaped
 *     value (string / array / object) recursively, applying
 *     `resolveRefs` to every string leaf. This is what the engine's
 *     ToolHost uses to scrub tool args on the way in.
 *
 * Every successful resolve appends one row to the store's audit log
 * (`recordAudit`). The audit row is the only thing that ever leaves
 * this module about the resolve — the resolved value flows on into the
 * tool, but the run-event stream still only ever sees the original
 * `secret://NAME` reference. ToolHost is responsible for ensuring the
 * pre-resolve args are what gets emitted in `tool_call` events.
 */

import { type SecretRefMatch, findRefs } from './parser.js';
import type { SecretStore } from './store.js';

/** Caller context for audit purposes. */
export interface ResolveContext {
  readonly tenantId: string;
  /** Agent name doing the resolve — written to `secret_audit.caller`. */
  readonly caller: string;
  /** Optional run id; written to `secret_audit.run_id`. */
  readonly runId?: string;
}

export class UnknownSecretError extends Error {
  public override readonly name = 'UnknownSecretError';
  public readonly secretName: string;
  constructor(secretName: string) {
    super(`unknown secret: ${secretName}`);
    this.secretName = secretName;
  }
}

/**
 * Resolve every `secret://` reference inside `text`. Each successful
 * resolve writes one audit row. Throws `UnknownSecretError` if any
 * reference fails — partial substitution is never returned.
 */
export async function resolveRefs(
  text: string,
  store: SecretStore,
  ctx: ResolveContext,
): Promise<string> {
  const matches = findRefs(text);
  if (matches.length === 0) return text;

  // Resolve once per distinct name to avoid hammering the store on
  // duplicates — but still write one audit row per textual occurrence,
  // so reviewing "how many times was X referenced in this run" is
  // accurate.
  const uniqueNames = new Set(matches.map((m) => m.name));
  const cache = new Map<string, string>();
  for (const name of uniqueNames) {
    const resolved = await store.resolve(ctx.tenantId, name);
    if (resolved === null) {
      throw new UnknownSecretError(name);
    }
    cache.set(name, resolved.value);
  }

  // Walk in reverse so substitution offsets stay valid.
  let out = text;
  const sorted: readonly SecretRefMatch[] = [...matches].sort((a, b) => b.start - a.start);
  for (const m of sorted) {
    const value = cache.get(m.name);
    if (value === undefined) {
      throw new UnknownSecretError(m.name);
    }
    out = `${out.slice(0, m.start)}${value}${out.slice(m.end)}`;
  }

  // Audit one row per textual occurrence, in original order.
  for (const m of matches) {
    await store.recordAudit({
      tenantId: ctx.tenantId,
      secretName: m.name,
      caller: ctx.caller,
      ...(ctx.runId !== undefined ? { runId: ctx.runId } : {}),
    });
  }
  return out;
}

/**
 * Recursively resolve every string leaf inside a JSON-shaped value.
 * Numbers, booleans, null, undefined are returned unchanged.
 */
export async function resolveInArgs(
  value: unknown,
  store: SecretStore,
  ctx: ResolveContext,
): Promise<unknown> {
  if (typeof value === 'string') {
    return resolveRefs(value, store, ctx);
  }
  if (Array.isArray(value)) {
    const out: unknown[] = [];
    for (const item of value) {
      out.push(await resolveInArgs(item, store, ctx));
    }
    return out;
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = await resolveInArgs(v, store, ctx);
    }
    return out;
  }
  return value;
}

/**
 * Convenience: does this payload contain any `secret://` references?
 * Lets the engine skip the recursive walk on the common case where
 * tool args are already fully resolved literals.
 */
export function hasRefs(value: unknown): boolean {
  if (typeof value === 'string') {
    return findRefs(value).length > 0;
  }
  if (Array.isArray(value)) {
    return value.some(hasRefs);
  }
  if (value !== null && typeof value === 'object') {
    for (const v of Object.values(value)) {
      if (hasRefs(v)) return true;
    }
  }
  return false;
}
