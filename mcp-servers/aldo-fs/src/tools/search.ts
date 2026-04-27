/**
 * fs.search — case-insensitive substring grep within an allowed root.
 *
 * Three caps (constants below) bound the work this tool performs in a
 * single call. They are *defaults*; callers can tighten further but
 * cannot loosen them.
 *
 *   - SEARCH_MAX_RESULTS = 200    matched lines returned at most
 *   - SEARCH_MAX_LINES   = 5000   lines scanned per file at most
 *   - SEARCH_MAX_FILES   = 1000   files visited at most
 *
 * Symlinks are not traversed.
 */

import type { Dirent } from 'node:fs';
import { createReadStream } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { z } from 'zod';
import type { Acl } from '../acl.js';
import { FsError, checkRead } from '../acl.js';

export const SEARCH_MAX_RESULTS = 200;
export const SEARCH_MAX_LINES = 5_000;
export const SEARCH_MAX_FILES = 1_000;

export const searchInputSchema = z
  .object({
    path: z.string().describe('Root of the search. Absolute or relative to first root.'),
    query: z.string().min(1).describe('Substring to find. Case-insensitive.'),
    maxResults: z.number().int().positive().max(SEARCH_MAX_RESULTS).optional(),
    /**
     * Optional inclusive list of filename suffixes (case-sensitive) to
     * scan. Default: scan every regular file we encounter.
     */
    suffixes: z.array(z.string()).optional(),
  })
  .strict();

export type SearchInput = z.infer<typeof searchInputSchema>;

export const searchHitSchema = z.object({
  path: z.string(),
  line: z.number().int().positive(),
  text: z.string(),
});

export const searchOutputSchema = z
  .object({
    query: z.string(),
    hits: z.array(searchHitSchema),
    filesScanned: z.number().int().nonnegative(),
    truncated: z.boolean(),
  })
  .strict();

export type SearchOutput = z.infer<typeof searchOutputSchema>;

export async function fsSearch(acl: Acl, input: SearchInput): Promise<SearchOutput> {
  const { real, root } = await checkRead(acl, input.path);
  const cap = Math.min(input.maxResults ?? SEARCH_MAX_RESULTS, SEARCH_MAX_RESULTS);
  const needle = input.query.toLowerCase();

  const hits: Array<z.infer<typeof searchHitSchema>> = [];
  let filesScanned = 0;
  let truncated = false;

  const stack: string[] = [real];
  outer: while (stack.length > 0 && filesScanned < SEARCH_MAX_FILES) {
    const dir = stack.shift();
    if (dir === undefined) break;
    let dirents: Dirent[];
    try {
      // eslint-disable-next-line no-await-in-loop
      dirents = await readdir(dir, { withFileTypes: true });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOTDIR') {
        // Caller pointed `path` at a single file. Just scan it.
        // eslint-disable-next-line no-await-in-loop
        const r = await scanFile(dir, needle, hits, cap);
        filesScanned += 1;
        if (r === 'cap') truncated = true;
        break;
      }
      throw new FsError('INTERNAL', `readdir ${dir}: ${(err as Error).message}`, err);
    }
    dirents.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const d of dirents) {
      if (filesScanned >= SEARCH_MAX_FILES || hits.length >= cap) {
        truncated = true;
        break outer;
      }
      const full = join(dir, d.name);
      if (d.isSymbolicLink()) continue; // never follow symlinks while scanning
      if (d.isDirectory()) {
        // Verify the dir is still inside the matching root (cheap, lexical).
        if (full.startsWith(root.path)) stack.push(full);
        continue;
      }
      if (!d.isFile()) continue;
      if (input.suffixes && !input.suffixes.some((s) => d.name.endsWith(s))) continue;
      try {
        // eslint-disable-next-line no-await-in-loop
        const st = await stat(full);
        if (!st.isFile()) continue;
      } catch {
        continue;
      }
      filesScanned += 1;
      // eslint-disable-next-line no-await-in-loop
      const r = await scanFile(full, needle, hits, cap);
      if (r === 'cap') {
        truncated = true;
        break outer;
      }
    }
  }
  if (filesScanned >= SEARCH_MAX_FILES) truncated = true;
  if (hits.length >= cap) truncated = true;

  return { query: input.query, hits, filesScanned, truncated };
}

/**
 * Read up to SEARCH_MAX_LINES of a file, push hits, return 'cap' if
 * `hits` reached `cap` (caller stops scanning further files).
 */
async function scanFile(
  path: string,
  needle: string,
  hits: Array<{ path: string; line: number; text: string }>,
  cap: number,
): Promise<'ok' | 'cap'> {
  return new Promise<'ok' | 'cap'>((res, rej) => {
    let line = 0;
    const stream = createReadStream(path, { encoding: 'utf8' });
    stream.on('error', (err) => {
      // Binary-ish file or permission error — skip silently.
      if ((err as NodeJS.ErrnoException).code === 'EISDIR') return res('ok');
      // Surface other errors to the caller.
      rej(new FsError('INTERNAL', `read ${path}: ${(err as Error).message}`, err));
    });
    const rl = createInterface({ input: stream, crlfDelay: Number.POSITIVE_INFINITY });
    rl.on('line', (text) => {
      line += 1;
      if (line > SEARCH_MAX_LINES) {
        rl.close();
        return;
      }
      if (text.toLowerCase().includes(needle)) {
        hits.push({ path, line, text: text.length > 1024 ? `${text.slice(0, 1024)}…` : text });
        if (hits.length >= cap) {
          rl.close();
        }
      }
    });
    rl.on('close', () => res(hits.length >= cap ? 'cap' : 'ok'));
  });
}
