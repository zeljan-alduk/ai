/**
 * `@path` inline file references for `aldo code`.
 *
 * Every `@<relative-path>` token in a user brief is replaced with a
 * fenced block containing the file's contents. Mirrors how every
 * modern AI coding tool (Claude Code, Aider, Codex) injects context:
 * the user types `@apps/web/page.tsx fix the layout` and the LLM
 * sees the file body inline without a tool call.
 *
 * Rules:
 *   - Paths must resolve INSIDE the workspace root. Absolute paths
 *     and `..` traversals are rejected with a typed error so the
 *     agent can't be tricked into reading `/etc/passwd`.
 *   - Binary files (bytes outside the printable + whitespace range)
 *     are skipped with a `[skipped: binary]` marker.
 *   - Files larger than `maxBytesPerFile` (default 64 KB) are truncated
 *     with an explicit `(truncated; <N> bytes total)` tail.
 *   - Unknown paths produce a `[skipped: not found]` marker — the
 *     brief still flows through, the LLM sees the gap.
 *   - The token boundary is `[a-zA-Z0-9_./@-]+` after the `@` —
 *     punctuation that follows (commas, periods at end of sentence,
 *     parentheses) is left alone. Multiple `@`s in one brief all
 *     expand.
 *
 * Pure: no I/O state mutated; reads the filesystem only. The caller
 * decides what to do with the resulting (expanded) string.
 */

import { readFileSync, statSync } from 'node:fs';
import { isAbsolute, relative, resolve as resolvePath } from 'node:path';

export interface ExpandAtReferencesOptions {
  readonly workspaceRoot: string;
  readonly maxBytesPerFile?: number;
}

export interface ExpandAtReferencesResult {
  readonly expanded: string;
  readonly references: ReadonlyArray<{
    readonly token: string;
    readonly resolvedPath: string;
    readonly status: 'ok' | 'not-found' | 'binary' | 'outside-workspace' | 'too-large' | 'error';
    readonly bytes?: number;
    readonly reason?: string;
  }>;
}

// Path token: leading char is alphanumeric / `_` / `.`, body is the
// usual path-safe set, but the LAST char must NOT be a `.` or `/` —
// trailing punctuation (period at end of sentence, slash at end of
// directory mention) is left alone so "@hello.ts." → token `hello.ts`
// and the trailing `.` stays in the brief.
const TOKEN_RE = /@([A-Za-z0-9_./-]*[A-Za-z0-9_-])/g;
const DEFAULT_MAX_BYTES = 64 * 1024;

export function expandAtReferences(
  brief: string,
  opts: ExpandAtReferencesOptions,
): ExpandAtReferencesResult {
  const maxBytes = opts.maxBytesPerFile ?? DEFAULT_MAX_BYTES;
  const root = resolvePath(opts.workspaceRoot);
  const refs: Array<ExpandAtReferencesResult['references'][number]> = [];

  const expanded = brief.replace(TOKEN_RE, (match, raw: string) => {
    // The leading `@` is in `match` but not `raw`; we keep `match` for
    // skip cases so the original token survives in the brief.
    if (raw.length === 0) return match;
    if (isAbsolute(raw)) {
      refs.push({
        token: match,
        resolvedPath: raw,
        status: 'outside-workspace',
        reason: 'absolute paths are not expanded; relative paths only',
      });
      return match;
    }
    const target = resolvePath(root, raw);
    const rel = relative(root, target);
    if (rel.startsWith('..') || isAbsolute(rel)) {
      refs.push({
        token: match,
        resolvedPath: target,
        status: 'outside-workspace',
        reason: '`..` traversal blocked — path resolves outside the workspace root',
      });
      return match;
    }

    let bytes: Buffer;
    try {
      const st = statSync(target);
      if (!st.isFile()) {
        refs.push({
          token: match,
          resolvedPath: target,
          status: 'error',
          reason: 'not a regular file',
        });
        return match;
      }
      bytes = readFileSync(target);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      refs.push({
        token: match,
        resolvedPath: target,
        status: code === 'ENOENT' ? 'not-found' : 'error',
        reason: code ?? 'read failed',
      });
      // Leave the token in the brief — the LLM sees an unexpanded
      // @path which is meaningful signal.
      return match;
    }

    if (looksBinary(bytes)) {
      refs.push({
        token: match,
        resolvedPath: target,
        status: 'binary',
        bytes: bytes.length,
      });
      return `\`@${rel}\` [skipped: binary, ${bytes.length} bytes]`;
    }

    const truncated = bytes.length > maxBytes;
    const text = truncated
      ? `${bytes.slice(0, maxBytes).toString('utf8')}\n…\n(truncated; ${bytes.length} bytes total)`
      : bytes.toString('utf8');
    refs.push({
      token: match,
      resolvedPath: target,
      status: truncated ? 'too-large' : 'ok',
      bytes: bytes.length,
    });
    const lang = languageFromPath(rel);
    const fence = lang.length > 0 ? `\`\`\`${lang}\n` : '```\n';
    return `\n\n${fence}// @${rel}\n${text}\n\`\`\`\n`;
  });

  return { expanded, references: refs };
}

/**
 * Heuristic binary check — null bytes anywhere in the first 4 KB =
 * binary. Matches the same heuristic GitHub / Aider use; not perfect
 * for UTF-16 but correct for the 99.9% case of source code.
 */
function looksBinary(buf: Buffer): boolean {
  const head = buf.slice(0, Math.min(buf.length, 4096));
  for (let i = 0; i < head.length; i++) {
    if (head[i] === 0) return true;
  }
  return false;
}

/** Map a file path to a fence language tag. Best-effort. */
function languageFromPath(rel: string): string {
  const ext = rel.toLowerCase().split('.').pop() ?? '';
  switch (ext) {
    case 'ts':
    case 'tsx':
      return 'typescript';
    case 'js':
    case 'jsx':
    case 'mjs':
    case 'cjs':
      return 'javascript';
    case 'py':
      return 'python';
    case 'go':
      return 'go';
    case 'rs':
      return 'rust';
    case 'rb':
      return 'ruby';
    case 'java':
      return 'java';
    case 'kt':
      return 'kotlin';
    case 'swift':
      return 'swift';
    case 'sh':
    case 'bash':
    case 'zsh':
      return 'bash';
    case 'sql':
      return 'sql';
    case 'json':
      return 'json';
    case 'yaml':
    case 'yml':
      return 'yaml';
    case 'toml':
      return 'toml';
    case 'md':
    case 'markdown':
      return 'markdown';
    case 'html':
      return 'html';
    case 'css':
      return 'css';
    default:
      return '';
  }
}
