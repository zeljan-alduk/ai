/**
 * @aldo-ai/runtime-config — load `.env` files into the running process.
 *
 * Deliberately minimal: a tiny dotenv parser (no external dependency) that
 * reads `KEY=VALUE` lines and merges them into a returned record without
 * mutating `process.env` unless asked. The CLI's `config.ts` is the
 * public consumer; this package is provider-agnostic by design.
 */

import { readFileSync } from 'node:fs';

export interface LoadDotenvOptions {
  /** Files to read in order; later wins on overlap. Missing files are skipped. */
  readonly files?: readonly string[];
  /**
   * Apply parsed values to `process.env`. Existing `process.env` keys are
   * NOT overwritten (so caller-supplied env beats files). Defaults to true.
   */
  readonly applyToProcessEnv?: boolean;
}

/**
 * Read and merge dotenv-style files. Returns the merged record. When
 * `applyToProcessEnv` is true (default), keys not already in `process.env`
 * are written back so downstream library code (e.g. provider adapters
 * reading `process.env.GROQ_API_KEY`) sees them.
 */
export function loadDotenv(opts: LoadDotenvOptions = {}): Record<string, string> {
  const files = opts.files ?? ['.env'];
  const apply = opts.applyToProcessEnv !== false;
  const merged: Record<string, string> = {};

  for (const path of files) {
    let text: string;
    try {
      text = readFileSync(path, 'utf8');
    } catch {
      continue; // missing files are not fatal
    }
    const parsed = parseDotenv(text);
    for (const [k, v] of Object.entries(parsed)) {
      merged[k] = v;
    }
  }

  if (apply) {
    for (const [k, v] of Object.entries(merged)) {
      if (process.env[k] === undefined || process.env[k] === '') {
        process.env[k] = v;
      }
    }
  }

  return merged;
}

/**
 * Parse a dotenv-formatted string. Recognises:
 *   - `KEY=VALUE` lines (whitespace around `=` ignored)
 *   - blank lines and `#`-prefixed comments
 *   - single- or double-quoted values (quotes stripped; double-quoted values
 *     interpret \n as newline, \t as tab, \\ as backslash)
 *   - trailing inline comments after a non-quoted value (separated by ` #`)
 *
 * `KEY=` (empty value) yields the empty string. Lines that don't match
 * `KEY=...` are silently skipped — we don't want a malformed comment to
 * blow up the CLI.
 */
export function parseDotenv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    let value = line.slice(eq + 1).trim();

    if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) {
      value = value.slice(1, -1).replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\\\/g, '\\');
    } else if (value.startsWith("'") && value.endsWith("'") && value.length >= 2) {
      value = value.slice(1, -1);
    } else {
      // Strip trailing inline comments only when value is unquoted.
      const hashIdx = value.indexOf(' #');
      if (hashIdx >= 0) value = value.slice(0, hashIdx).trimEnd();
    }
    out[key] = value;
  }
  return out;
}
