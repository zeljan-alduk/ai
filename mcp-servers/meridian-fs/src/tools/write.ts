/**
 * fs.write — create or overwrite a file under an allowed `rw` root.
 *
 * Writes are atomic-ish: we write to a sibling tempfile and then rename.
 * Parent directories are created on demand (recursive: true), but only
 * after the ACL has confirmed the deepest existing ancestor lies inside
 * an allowed root.
 */

import { mkdir, rename, stat, writeFile, unlink } from 'node:fs/promises';
import { dirname, basename, join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import type { Acl } from '../acl.js';
import { FsError, checkWrite } from '../acl.js';

export const WRITE_MAX_BYTES = 8 * 1024 * 1024; // 8 MiB

export const writeInputSchema = z
  .object({
    path: z.string().describe('Absolute path or path relative to first allowed root.'),
    content: z.string().describe('File content (interpreted per `encoding`).'),
    encoding: z
      .enum(['utf8', 'base64'])
      .default('utf8')
      .describe('utf8 writes content as text; base64 decodes content first.'),
    createDirs: z
      .boolean()
      .default(true)
      .describe('Create missing parent directories (recursive).'),
    overwrite: z
      .boolean()
      .default(true)
      .describe('If false, refuse to overwrite an existing file (returns PERMISSION_DENIED).'),
  })
  .strict();

export type WriteInput = z.infer<typeof writeInputSchema>;

export const writeOutputSchema = z
  .object({
    path: z.string(),
    bytes: z.number().int().nonnegative(),
    created: z.boolean(),
  })
  .strict();

export type WriteOutput = z.infer<typeof writeOutputSchema>;

export async function fsWrite(acl: Acl, input: WriteInput): Promise<WriteOutput> {
  const buf = input.encoding === 'base64'
    ? Buffer.from(input.content, 'base64')
    : Buffer.from(input.content, 'utf8');
  if (buf.byteLength > WRITE_MAX_BYTES) {
    throw new FsError(
      'TOO_LARGE',
      `payload is ${buf.byteLength} bytes; exceeds cap ${WRITE_MAX_BYTES}.`,
    );
  }

  // ACL: target (or its deepest existing ancestor) must be inside a rw root
  // and must not be reached via an out-of-root symlink.
  const { abs } = await checkWrite(acl, input.path);

  // Pre-existing target?
  let existed = false;
  try {
    const st = await stat(abs);
    existed = st.isFile() || st.isDirectory();
    if (st.isDirectory()) {
      throw new FsError('PERMISSION_DENIED', `target is a directory: ${abs}`);
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
  if (existed && !input.overwrite) {
    throw new FsError('PERMISSION_DENIED', `refusing to overwrite ${abs} (overwrite=false)`);
  }

  if (input.createDirs) {
    await mkdir(dirname(abs), { recursive: true });
  }

  // Atomic-ish write: temp file + rename. Same dir so rename is on one fs.
  const tmp = join(dirname(abs), `.${basename(abs)}.${randomBytes(6).toString('hex')}.tmp`);
  try {
    await writeFile(tmp, buf, { mode: 0o644 });
    await rename(tmp, abs);
  } catch (err) {
    // Best-effort cleanup of the tempfile.
    try {
      await unlink(tmp);
    } catch {
      /* ignore */
    }
    throw new FsError('INTERNAL', `write failed: ${(err as Error).message}`, err);
  }

  return { path: abs, bytes: buf.byteLength, created: !existed };
}
