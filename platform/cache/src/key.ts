/**
 * Pure cache-key builder for LLM responses.
 *
 * Goals:
 *   1. Determinism — the same logical request always produces the same
 *      key, regardless of object-property insertion order.
 *   2. Sensitivity to every field that influences the model's output.
 *      Anything that DOES NOT influence the output (request ids, run
 *      ids, trace ids, span ids, timestamps) MUST stay out of the key.
 *   3. Privacy-tier awareness — `privacy_tier` is part of the key. A
 *      `sensitive` request MUST NEVER hit a `public` cached entry of
 *      the same prompt. That would cross a tier boundary inside the
 *      cache and constitute a privacy LEAK (CLAUDE.md non-negotiable
 *      #3 — privacy is enforced platform-side).
 *
 * Algorithm: SHA-256 over the UTF-8 encoding of a canonical JSON form
 * (recursively sort object keys; preserve array order). Returns a
 * lowercase hex digest.
 *
 * LLM-agnostic: the key carries an opaque `model` string. We never
 * branch on provider — `openai:gpt-4o`, `ollama:llama3.3`, and
 * `anthropic:claude-3-5-sonnet` are all just strings here.
 */

import { createHash } from 'node:crypto';
import type { CompletionRequest, ToolSchema } from '@aldo-ai/types';
import type { PrivacyTier } from '@aldo-ai/types';

/**
 * Inputs hashed into the cache key. Anything not listed here is
 * deliberately excluded — see the field-by-field rationale below.
 */
export interface CacheKeyInput {
  /** Opaque model id. The provider name is part of this string. */
  readonly model: string;
  /** Privacy tier at the call site. MUST be part of the key. */
  readonly privacyTier: PrivacyTier;
  /**
   * The full request, exactly as sent to the provider adapter. We hash
   * messages + tools + decoding params; everything else (ids, signals,
   * seeds-when-undefined) stays out.
   */
  readonly request: CompletionRequest;
}

export interface CacheKeyDigest {
  /** Lowercase hex SHA-256 digest. */
  readonly hex: string;
  /** The canonical JSON string that was hashed. Useful for debugging. */
  readonly canonical: string;
}

/**
 * Build a deterministic cache key for a model request.
 *
 * Field rationale:
 *   - `model`            — different models produce different outputs.
 *   - `privacyTier`      — tier-isolation guard (see file header).
 *   - `messages`         — the actual prompt; order is significant.
 *   - `tools`            — tool schemas alter the model's reasoning,
 *                          so they're part of the key. Order is
 *                          preserved (tool ordering can affect choice).
 *   - `temperature`      — output distribution.
 *   - `top_p`            — output distribution. Pulled from the
 *                          `responseFormat`-adjacent decoding params on
 *                          `CompletionRequest` (we don't have a
 *                          dedicated `top_p` field today; future-proof).
 *   - `max_tokens`       — affects truncation point.
 *   - `responseFormat`   — text vs json vs json_schema changes shape.
 *   - `stop`             — terminates generation differently.
 *   - `seed`             — pinning seed = pinning output.
 *
 * Excluded:
 *   - `runId` / `traceId` / message ids — vary per call but don't
 *     change the response shape.
 *   - `signal` — control plane, not a content input.
 *   - `tenantId` — not part of the key (the cache is tenant-scoped at
 *     the STORE layer; the key namespace is per-tenant). Crossing
 *     tenants requires both the tenant filter AND a key collision,
 *     which the SHA-256 makes infeasible.
 */
export function buildCacheKey(input: CacheKeyInput): CacheKeyDigest {
  const canonicalForm = canonicalizeRequest(input);
  const canonical = stableStringify(canonicalForm);
  const hex = createHash('sha256').update(canonical, 'utf8').digest('hex');
  return { hex, canonical };
}

/**
 * Build the canonical, hash-stable representation of a request. Pure
 * function — no Node-specific globals.
 */
function canonicalizeRequest(input: CacheKeyInput): Record<string, unknown> {
  const req = input.request;
  // System prompt is `messages[role==='system']` in our model. We treat
  // it identically to any other message — its order in the messages
  // array IS hashed. The brief calls it out separately because Helicone
  // and friends often have a separate system field; we don't.
  const messages = req.messages.map((m) => ({
    role: m.role,
    content: m.content.map((p) => canonicalizePart(p as unknown as Record<string, unknown>)),
  }));
  const tools: readonly ToolSchema[] | undefined = req.tools;
  const toolsCanon = tools?.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
  }));
  return {
    model: input.model,
    privacy_tier: input.privacyTier,
    messages,
    ...(toolsCanon !== undefined ? { tools: toolsCanon } : {}),
    ...(req.responseFormat !== undefined ? { response_format: req.responseFormat } : {}),
    ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
    // `top_p` isn't on `CompletionRequest` today — future-proof: when
    // it lands we hash it under this key. Pull from a typed escape
    // hatch so the field is hashed if the caller stuffed it on the
    // request object as an extension.
    ...maybeTopP(req),
    ...(req.maxOutputTokens !== undefined ? { max_tokens: req.maxOutputTokens } : {}),
    ...(req.stop !== undefined ? { stop: [...req.stop] } : {}),
    ...(req.seed !== undefined ? { seed: req.seed } : {}),
  };
}

function canonicalizePart(part: Record<string, unknown>): unknown {
  // Strip transient ids — `callId` is NOT a cache-key input. The CALL
  // is unique per run, but a tool_call `{tool, args}` pair with the
  // same args yields the same continuation regardless of the per-run
  // call id. Drop it for stability.
  if (part.type === 'tool_call') {
    return { type: 'tool_call', tool: part.tool, args: part.args };
  }
  if (part.type === 'tool_result') {
    return {
      type: 'tool_result',
      result: part.result,
      ...(part.isError === true ? { isError: true } : {}),
    };
  }
  if (part.type === 'image') {
    return {
      type: 'image',
      url: part.url,
      ...(part.mimeType !== undefined ? { mimeType: part.mimeType } : {}),
    };
  }
  // text and any other future shape — pass through.
  return part;
}

function maybeTopP(req: CompletionRequest): { top_p?: number } {
  const r = req as unknown as { top_p?: unknown; topP?: unknown };
  const v = typeof r.top_p === 'number' ? r.top_p : typeof r.topP === 'number' ? r.topP : undefined;
  return v !== undefined ? { top_p: v } : {};
}

/**
 * Stable JSON.stringify: recursively sorts object keys; preserves
 * array order. Objects are serialised as `{"k":v,...}` with sorted
 * keys; primitives via JSON.stringify; arrays element-by-element in
 * the order they appear.
 */
export function stableStringify(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function canonicalize(value: unknown): unknown {
  if (value === null) return null;
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const sortedKeys = Object.keys(obj).sort();
    const out: Record<string, unknown> = {};
    for (const k of sortedKeys) {
      const v = obj[k];
      if (v === undefined) continue;
      out[k] = canonicalize(v);
    }
    return out;
  }
  return value;
}
