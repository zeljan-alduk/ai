/**
 * fs.delete — remove a file or directory under an allowed `:rw` root.
 *
 * The protected-paths denylist on the ACL is enforced by `checkWrite`
 * (called via the `assertNotProtected` step). Recursive directory
 * removal is opt-in: a single-file delete stays cheap, a tree delete
 * has to be requested explicitly so a model that confused two paths
 * can't blow away half the workspace by accident.
 *
 * MISSING_PIECES.md #2.
 */

import { rm, stat } from 'node:fs/promises';
import { z } from 'zod';
import type { Acl } from '../acl.js';
import { FsError, checkWrite } from '../acl.js';

export const deleteInputSchema = z
  .object({
    path: z.string().describe('Absolute path or path relative to first allowed root.'),
    recursive: z
      .boolean()
      .default(false)
      .describe('Remove a directory and its contents. Refuses to delete a non-empty dir without this flag.'),
    missingOk: z
      .boolean()
      .default(false)
      .describe('If true, deleting a non-existent path returns existed=false instead of NOT_FOUND.'),
  })
  .strict();

export type DeleteInput = z.infer<typeof deleteInputSchema>;

export const deleteOutputSchema = z
  .object({
    path: z.string(),
    existed: z.boolean(),
    kind: z.enum(['file', 'dir']).optional(),
  })
  .strict();

export type DeleteOutput = z.infer<typeof deleteOutputSchema>;

export async function fsDelete(acl: Acl, input: DeleteInput): Promise<DeleteOutput> {
  const { abs } = await checkWrite(acl, input.path);

  let kind: 'file' | 'dir' | undefined;
  try {
    const st = await stat(abs);
    kind = st.isDirectory() ? 'dir' : 'file';
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw new FsError('INTERNAL', `stat failed: ${(err as Error).message}`, err);
    }
    if (input.missingOk) return { path: abs, existed: false };
    throw new FsError('NOT_FOUND', `no such path: ${abs}`);
  }

  if (kind === 'dir' && !input.recursive) {
    throw new FsError(
      'PERMISSION_DENIED',
      `target is a directory; pass recursive=true to remove "${abs}"`,
    );
  }

  try {
    await rm(abs, { recursive: input.recursive, force: false });
  } catch (err) {
    throw new FsError('INTERNAL', `rm failed: ${(err as Error).message}`, err);
  }
  return { path: abs, existed: true, kind };
}
