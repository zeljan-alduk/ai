/**
 * fs.move — rename or move a file/directory between two `:rw` paths.
 *
 * Both `from` and `to` go through `checkWrite` so each must lie inside
 * a writable root and clear the protected-paths denylist. The two paths
 * may be in different rw roots; we use `rename(2)` first and fall back
 * to copy + unlink only when rename fails with EXDEV (cross-device).
 *
 * MISSING_PIECES.md #2.
 */

import { copyFile, mkdir, readdir, rename, rm, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import type { Acl } from '../acl.js';
import { FsError, checkWrite } from '../acl.js';

export const moveInputSchema = z
  .object({
    from: z.string().describe('Source path (must exist).'),
    to: z.string().describe('Destination path.'),
    overwrite: z
      .boolean()
      .default(false)
      .describe('If false, refuse to overwrite an existing destination.'),
    createDirs: z
      .boolean()
      .default(true)
      .describe('Create missing parent directories at the destination.'),
  })
  .strict();

export type MoveInput = z.infer<typeof moveInputSchema>;

export const moveOutputSchema = z
  .object({
    from: z.string(),
    to: z.string(),
    kind: z.enum(['file', 'dir']),
    crossDevice: z.boolean().describe('True if the move fell back to copy+unlink.'),
  })
  .strict();

export type MoveOutput = z.infer<typeof moveOutputSchema>;

export async function fsMove(acl: Acl, input: MoveInput): Promise<MoveOutput> {
  const src = await checkWrite(acl, input.from);
  const dst = await checkWrite(acl, input.to);

  let kind: 'file' | 'dir';
  try {
    const st = await stat(src.abs);
    kind = st.isDirectory() ? 'dir' : 'file';
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new FsError('NOT_FOUND', `source does not exist: ${src.abs}`);
    }
    throw new FsError('INTERNAL', `stat failed: ${(err as Error).message}`, err);
  }

  // Destination existence + overwrite policy.
  let dstExists = false;
  try {
    await stat(dst.abs);
    dstExists = true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw new FsError('INTERNAL', `stat failed: ${(err as Error).message}`, err);
    }
  }
  if (dstExists && !input.overwrite) {
    throw new FsError(
      'PERMISSION_DENIED',
      `destination exists: ${dst.abs} (pass overwrite=true)`,
    );
  }

  if (input.createDirs) {
    await mkdir(dirname(dst.abs), { recursive: true });
  }

  let crossDevice = false;
  try {
    if (dstExists) {
      // rename will overwrite a file, but errors on a non-empty dir; clear it first.
      const dstStat = await stat(dst.abs);
      if (dstStat.isDirectory()) {
        await rm(dst.abs, { recursive: true });
      }
    }
    await rename(src.abs, dst.abs);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'EXDEV') {
      crossDevice = true;
      await copyTree(src.abs, dst.abs);
      await rm(src.abs, { recursive: true });
    } else {
      throw new FsError('INTERNAL', `move failed: ${(err as Error).message}`, err);
    }
  }
  return { from: src.abs, to: dst.abs, kind, crossDevice };
}

async function copyTree(srcAbs: string, dstAbs: string): Promise<void> {
  const st = await stat(srcAbs);
  if (st.isDirectory()) {
    await mkdir(dstAbs, { recursive: true });
    const entries = await readdir(srcAbs);
    await Promise.all(entries.map((e) => copyTree(join(srcAbs, e), join(dstAbs, e))));
  } else {
    await copyFile(srcAbs, dstAbs);
  }
}
