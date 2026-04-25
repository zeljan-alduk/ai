import type { GuardSeverity } from '@aldo-ai/types';

/**
 * Regex-based output scanner. Detects common exfiltration / prompt-injection
 * indicators in either inbound tool output or outbound model text.
 *
 * The rules are deliberately conservative: this is a tripwire, not a
 * sandbox. The middleware decides what to do (warn vs block) based on the
 * agent's `severityBlock` policy.
 */

export type FindingKind =
  | 'url_not_allowlisted'
  | 'large_base64_blob'
  | 'prompt_leak_marker'
  | 'high_link_density';

export interface ScanFinding {
  readonly kind: FindingKind;
  readonly severity: GuardSeverity;
  readonly message: string;
  /** Inclusive start offset within the scanned text. */
  readonly start: number;
  /** Exclusive end offset within the scanned text. */
  readonly end: number;
  /** The matched span (clipped if very long). */
  readonly snippet: string;
}

export interface ScanResult {
  readonly findings: readonly ScanFinding[];
  /** Highest severity present in `findings`, or undefined when clean. */
  readonly maxSeverity?: GuardSeverity;
}

export interface ScanPolicy {
  /**
   * Allowlist of URL hosts (or `host/prefix*` globs). URLs not matching any
   * pattern are flagged. Empty allowlist means *every* URL is flagged when
   * URL scanning is enabled.
   */
  readonly urlAllowlist?: readonly string[];
  /** Minimum length for a base64-looking run before flagging. Default 256. */
  readonly base64MinChars?: number;
  /**
   * Minimum number of markdown links before the link-density rule applies,
   * and the per-100-character threshold for flagging. Defaults: 5 links and
   * 1.5 links / 100 chars.
   */
  readonly linkDensity?: {
    readonly minLinks?: number;
    readonly per100CharsThreshold?: number;
  };
}

// ---------------------------------------------------------------------------
// Curated prompt-leak markers.
//
// Sources I cross-referenced when curating this list:
//  - Simon Willison's prompt-injection writeups (2022-2024).
//  - OWASP LLM-Top-10 2025 (LLM01: prompt injection).
//  - Microsoft's PyRIT injection rule pack.
//  - Public jailbreak corpora (DAN-style, GPTfuzzer dataset).
// I kept entries that cluster across all three sources and dropped ones
// that produced too many false positives on real PR review traffic.
// ---------------------------------------------------------------------------

const PROMPT_LEAK_PATTERNS: readonly { readonly pattern: RegExp; readonly label: string }[] = [
  {
    pattern: /\bignore (?:all |the )?previous (?:instructions|prompts?)\b/i,
    label: 'ignore previous',
  },
  {
    pattern: /\bdisregard (?:all |the )?(?:above|previous) (?:instructions|prompts?)\b/i,
    label: 'disregard above',
  },
  { pattern: /\byou are now\b/i, label: 'you are now' },
  {
    pattern: /\bact as (?:a |an )?(?:unrestricted|jailbroken|developer-mode)\b/i,
    label: 'act as unrestricted',
  },
  { pattern: /\bpretend (?:that )?you (?:are|have)\b/i, label: 'pretend you are' },
  { pattern: /\bsystem prompt\b/i, label: 'system prompt' },
  { pattern: /\bdeveloper mode\b/i, label: 'developer mode' },
  { pattern: /\bDAN(?:\s+mode)?\b/, label: 'DAN' },
  { pattern: /\bjailbreak\b/i, label: 'jailbreak' },
  { pattern: /\breveal (?:your |the )?(?:system|hidden) prompt\b/i, label: 'reveal system prompt' },
  { pattern: /\bprint (?:your |the )?instructions\b/i, label: 'print your instructions' },
  { pattern: /\b<\|im_start\|>\b/i, label: 'im_start token' },
  { pattern: /\b<\|im_end\|>\b/i, label: 'im_end token' },
];

export function getPromptLeakPatterns(): readonly {
  readonly label: string;
  readonly pattern: RegExp;
}[] {
  return PROMPT_LEAK_PATTERNS;
}

// ---------------------------------------------------------------------------
// Helpers.

function clipSnippet(text: string, start: number, end: number, max = 96): string {
  const span = text.slice(start, end);
  if (span.length <= max) return span;
  return `${span.slice(0, max - 3)}...`;
}

const URL_RE = /\bhttps?:\/\/([a-z0-9.-]+)(\/[\w\-./?=&%~:#+,;@!$'()*]*)?/gi;

function urlMatchesAllowlist(host: string, path: string, allowlist: readonly string[]): boolean {
  for (const entry of allowlist) {
    // Strip protocol for matching convenience.
    const stripped = entry.replace(/^https?:\/\//i, '');
    // Glob support: trailing /* or *.
    if (stripped.endsWith('/*')) {
      const prefix = stripped.slice(0, -2);
      if (`${host}${path}`.startsWith(prefix)) return true;
      continue;
    }
    if (stripped.endsWith('*')) {
      const prefix = stripped.slice(0, -1);
      if (`${host}${path}`.startsWith(prefix)) return true;
      continue;
    }
    // Exact host match (or host with path prefix).
    if (host === stripped) return true;
    if (`${host}${path}`.startsWith(stripped)) return true;
  }
  return false;
}

const BASE64_RE = /[A-Za-z0-9+/]{40,}={0,2}/g;

function isLikelyBase64(span: string, minChars: number): boolean {
  if (span.length < minChars) return false;
  // Heuristic: lots of mixed-case letters + digits, no spaces.
  let upper = 0;
  let lower = 0;
  let digit = 0;
  for (const ch of span) {
    if (ch >= 'A' && ch <= 'Z') upper++;
    else if (ch >= 'a' && ch <= 'z') lower++;
    else if (ch >= '0' && ch <= '9') digit++;
  }
  return upper > 2 && lower > 2 && digit >= 1;
}

const MARKDOWN_LINK_RE = /\[[^\]\n]{1,200}\]\((https?:[^\s)]+)\)/g;

// ---------------------------------------------------------------------------
// Public API.

export function scanOutput(text: string, policy: ScanPolicy = {}): ScanResult {
  const findings: ScanFinding[] = [];
  URL_RE.lastIndex = 0;
  for (;;) {
    const m = URL_RE.exec(text);
    if (m === null) break;
    const host = m[1] ?? '';
    const path = m[2] ?? '';
    const allowlist = policy.urlAllowlist ?? [];
    if (!urlMatchesAllowlist(host, path, allowlist)) {
      findings.push({
        kind: 'url_not_allowlisted',
        severity: 'warn',
        message: `URL host "${host}" is not in the allowlist`,
        start: m.index,
        end: m.index + m[0].length,
        snippet: clipSnippet(text, m.index, m.index + m[0].length),
      });
    }
  }

  // Rule 2: large base64-looking blobs.
  {
    const minChars = policy.base64MinChars ?? 256;
    BASE64_RE.lastIndex = 0;
    for (;;) {
      const m = BASE64_RE.exec(text);
      if (m === null) break;
      const span = m[0];
      if (span.length >= minChars && isLikelyBase64(span, minChars)) {
        findings.push({
          kind: 'large_base64_blob',
          severity: 'error',
          message: `base64-looking blob of ${span.length} chars`,
          start: m.index,
          end: m.index + span.length,
          snippet: clipSnippet(text, m.index, m.index + span.length),
        });
      }
    }
  }

  // Rule 3: prompt-leak markers.
  for (const { pattern, label } of PROMPT_LEAK_PATTERNS) {
    const re = new RegExp(
      pattern.source,
      pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`,
    );
    re.lastIndex = 0;
    for (;;) {
      const m = re.exec(text);
      if (m === null) break;
      findings.push({
        kind: 'prompt_leak_marker',
        severity: 'critical',
        message: `prompt-leak marker matched: ${label}`,
        start: m.index,
        end: m.index + m[0].length,
        snippet: clipSnippet(text, m.index, m.index + m[0].length),
      });
      // Avoid zero-width infinite loops.
      if (m[0].length === 0) re.lastIndex++;
    }
  }

  // Rule 4: excessive markdown link density.
  {
    const minLinks = policy.linkDensity?.minLinks ?? 5;
    const perHundred = policy.linkDensity?.per100CharsThreshold ?? 1.5;
    MARKDOWN_LINK_RE.lastIndex = 0;
    const matches: RegExpExecArray[] = [];
    for (;;) {
      const m = MARKDOWN_LINK_RE.exec(text);
      if (m === null) break;
      matches.push(m);
    }
    if (matches.length >= minLinks && text.length > 0) {
      const density = (matches.length * 100) / Math.max(text.length, 1);
      if (density >= perHundred) {
        const first = matches[0];
        const last = matches[matches.length - 1];
        if (first && last) {
          findings.push({
            kind: 'high_link_density',
            severity: 'warn',
            message: `${matches.length} markdown links in ${text.length} chars (density=${density.toFixed(2)}/100)`,
            start: first.index,
            end: last.index + last[0].length,
            snippet: clipSnippet(text, first.index, last.index + last[0].length),
          });
        }
      }
    }
  }

  let max: GuardSeverity | undefined;
  for (const f of findings) {
    if (max === undefined) {
      max = f.severity;
      continue;
    }
    const order: Record<GuardSeverity, number> = { info: 0, warn: 1, error: 2, critical: 3 };
    if (order[f.severity] > order[max]) max = f.severity;
  }
  return max !== undefined ? { findings, maxSeverity: max } : { findings };
}
