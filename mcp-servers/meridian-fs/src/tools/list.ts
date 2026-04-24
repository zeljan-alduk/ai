/**
 * fs.list — list entries directly under a directory in an allowed root.
 */

import type { Dirent } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import type { Acl } from '../acl.js';
import { FsError, checkRead } from '../acl.js';

export const LIST_MAX_ENTRIES = 5_000;

export const listInputSchema = z
  .object({
    path: z.string().describe('Directory to list. Absolute or relative to first root.'),
    /**
     * If true, also return entries inside the listed directory's children
     * recursively. Bounded by `maxEntries`.
     */
    recursive: z.boolean().default(false),
    maxEntries: z
      .number()
      .int()
      .positive()
      .max(LIST_MAX_ENTRIES)
      .optional()
      .describe(`Cap on returned entries. Hard ceiling: ${LIST_MAX_ENTRIES}.`),
  })
  .strict();

export type ListInput = z.infer<typeof listInputSchema>;

export const listEntrySchema = z.object({
  name: z.string(),
  path: z.string(),
  kind: z.enum(['file', 'dir', 'symlink', 'other']),
});

export const listOutputSchema = z
  .object({
    path: z.string(),
    entries: z.array(listEntrySchema),
    truncated: z.boolean(),
  })
  .strict();

export type ListOutput = z.infer<typeof listOutputSchema>;

export async function fsList(acl: Acl, input: ListInput): Promise<ListOutput> {
  const { real } = await checkRead(acl, input.path);
  const cap = Math.min(input.maxEntries ?? LIST_MAX_ENTRIES, LIST_MAX_ENTRIES);

  const entries: Array<{ name: string; path: string; kind: 'file' | 'dir' | 'symlink' | 'other' }> =
    [];
  let truncated = false;

  // BFS so caller gets shallow entries first. Symlink dirs are NOT
  // traversed — they would defeat the ACL guarantees.
  const stack: string[] = [real];
  while (stack.length > 0) {
    if (entries.length >= cap) {
      truncated = true;
      break;
    }
    const dir = stack.shift();
    if (dir === undefined) break;

    let dirents: Dirent[];
    try {
      // eslint-disable-next-line no-await-in-loop
      dirents = await readdir(dir, { withFileTypes: true });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOTDIR') {
        throw new FsError('NOT_FOUND', `not a directory: ${dir}`);
      }
      throw err;
    }
    // Stable order so output is deterministic.
    dirents.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const d of dirents) {
      if (entries.length >= cap) {
        truncated = true;
        break;
      }
      const full = join(dir, d.name);
      const kind: 'file' | 'dir' | 'symlink' | 'other' = d.isFile()
        ? 'file'
        : d.isDirectory()
          ? 'dir'
          : d.isSymbolicLink()
            ? 'symlink'
            : 'other';
      entries.push({ name: d.name, path: full, kind });
      if (input.recursive && kind === 'dir') stack.push(full);
    }
  }

  return { path: real, entries, truncated };
}
