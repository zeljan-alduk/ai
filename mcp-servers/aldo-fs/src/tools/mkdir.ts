/**
 * fs.mkdir — create a directory under an allowed `:rw` root.
 *
 * Recursive by default — matches the common ergonomic case where an
 * agent wants to ensure a deep path exists before writing. Existing
 * directories are tolerated; existing files at the target raise
 * PERMISSION_DENIED so we never silently mask a stale file with a dir.
 *
 * MISSING_PIECES.md #2.
 */

import { mkdir, stat } from 'node:fs/promises';
import { z } from 'zod';
import type { Acl } from '../acl.js';
import { FsError, checkWrite } from '../acl.js';

export const mkdirInputSchema = z
  .object({
    path: z.string().describe('Absolute path or path relative to first allowed root.'),
    recursive: z
      .boolean()
      .default(true)
      .describe('Create missing parent directories. Default true matches `mkdir -p`.'),
  })
  .strict();

export type MkdirInput = z.infer<typeof mkdirInputSchema>;

export const mkdirOutputSchema = z
  .object({
    path: z.string(),
    created: z.boolean(),
  })
  .strict();

export type MkdirOutput = z.infer<typeof mkdirOutputSchema>;

export async function fsMkdir(acl: Acl, input: MkdirInput): Promise<MkdirOutput> {
  const { abs } = await checkWrite(acl, input.path);

  // If something already exists, allow only when it's a directory.
  try {
    const st = await stat(abs);
    if (!st.isDirectory()) {
      throw new FsError(
        'PERMISSION_DENIED',
        `target exists and is not a directory: ${abs}`,
      );
    }
    return { path: abs, created: false };
  } catch (err) {
    if (err instanceof FsError) throw err;
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw new FsError('INTERNAL', `stat failed: ${(err as Error).message}`, err);
    }
  }

  try {
    await mkdir(abs, { recursive: input.recursive });
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' && !input.recursive) {
      throw new FsError(
        'NOT_FOUND',
        `parent does not exist (pass recursive=true): ${abs}`,
      );
    }
    throw new FsError('INTERNAL', `mkdir failed: ${(err as Error).message}`, err);
  }
  return { path: abs, created: true };
}
