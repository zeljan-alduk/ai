/**
 * Tag normalization for /v1/runs/:id/tags surfaces.
 *
 * Rules (per the Wave-4 brief):
 *   * lowercase
 *   * leading + trailing whitespace stripped
 *   * 1–32 characters
 *   * alphanumeric + dashes only (`[a-z0-9-]`)
 *
 * Pure module so vitest can pin every branch without a DB or a Hono
 * harness. The route layer wraps these in a 422 / `invalid_tag`
 * response when validation fails.
 *
 * LLM-agnostic: tag values are opaque user-supplied strings — no
 * provider name or model id is special-cased here.
 */

/** Maximum length of a single normalized tag, in characters. */
export const MAX_TAG_LENGTH = 32;

/** Tag character set: lowercase ASCII letters, digits, hyphen. */
const TAG_PATTERN = /^[a-z0-9-]+$/;

/** Per-run cap on tag count. Prevents an `add` loop from ballooning a row. */
export const MAX_TAGS_PER_RUN = 32;

export type NormalizeTagResult =
  | { readonly ok: true; readonly tag: string }
  | { readonly ok: false; readonly reason: string; readonly input: string };

/**
 * Normalize a single tag.
 *
 * Returns `{ ok: true, tag }` on success and `{ ok: false, reason }`
 * on failure. The route layer maps `ok: false` to HTTP 422.
 *
 * The function never throws — invalid input is a value, not an
 * exception, so a bulk-normalize over a user-supplied list can
 * partition cleanly into accepted + rejected without a try/catch.
 */
export function normalizeTag(raw: unknown): NormalizeTagResult {
  if (typeof raw !== 'string') {
    return { ok: false, reason: 'tag must be a string', input: String(raw) };
  }
  const trimmed = raw.trim().toLowerCase();
  if (trimmed.length === 0) {
    return { ok: false, reason: 'tag must not be empty', input: raw };
  }
  if (trimmed.length > MAX_TAG_LENGTH) {
    return {
      ok: false,
      reason: `tag must be at most ${MAX_TAG_LENGTH} characters (got ${trimmed.length})`,
      input: raw,
    };
  }
  if (!TAG_PATTERN.test(trimmed)) {
    return {
      ok: false,
      reason: 'tag must be alphanumeric + dashes only ([a-z0-9-])',
      input: raw,
    };
  }
  return { ok: true, tag: trimmed };
}

/**
 * Normalize a list of tags.
 *
 * Returns `{ ok: true, tags }` with duplicates collapsed and order
 * preserved (first-seen wins) when every entry validates. Returns
 * `{ ok: false, errors }` listing every rejection when at least one
 * entry fails — the route layer surfaces all errors at once so the
 * UI can render them inline.
 */
export type NormalizeTagsResult =
  | { readonly ok: true; readonly tags: readonly string[] }
  | { readonly ok: false; readonly errors: ReadonlyArray<{ input: string; reason: string }> };

export function normalizeTags(raw: unknown): NormalizeTagsResult {
  if (!Array.isArray(raw)) {
    return { ok: false, errors: [{ input: String(raw), reason: 'tags must be an array' }] };
  }
  const errors: Array<{ input: string; reason: string }> = [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of raw) {
    const r = normalizeTag(entry);
    if (!r.ok) {
      errors.push({ input: r.input, reason: r.reason });
      continue;
    }
    if (seen.has(r.tag)) continue;
    seen.add(r.tag);
    out.push(r.tag);
  }
  if (errors.length > 0) return { ok: false, errors };
  if (out.length > MAX_TAGS_PER_RUN) {
    return {
      ok: false,
      errors: [
        {
          input: `${out.length} tags`,
          reason: `at most ${MAX_TAGS_PER_RUN} tags allowed per run`,
        },
      ],
    };
  }
  return { ok: true, tags: out };
}
