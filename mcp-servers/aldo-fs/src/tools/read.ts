/**
 * fs.read — read a single file's contents under an allowed root.
 */

import { open } from 'node:fs/promises';
import { z } from 'zod';
import type { Acl } from '../acl.js';
import { FsError, checkRead } from '../acl.js';

/** Default cap on returned bytes for a single read. */
export const READ_MAX_BYTES = 4 * 1024 * 1024; // 4 MiB

export const readInputSchema = z
  .object({
    path: z.string().describe('Absolute path or path relative to first allowed root.'),
    encoding: z
      .enum(['utf8', 'base64'])
      .default('utf8')
      .describe('Output encoding. utf8 (default) returns text; base64 returns raw bytes.'),
    maxBytes: z
      .number()
      .int()
      .positive()
      .max(READ_MAX_BYTES)
      .optional()
      .describe(`Per-call byte cap. Hard ceiling: ${READ_MAX_BYTES} bytes.`),
  })
  .strict();

export type ReadInput = z.infer<typeof readInputSchema>;

export const readOutputSchema = z
  .object({
    path: z.string(),
    encoding: z.enum(['utf8', 'base64']),
    bytes: z.number().int().nonnegative(),
    truncated: z.boolean(),
    content: z.string(),
  })
  .strict();

export type ReadOutput = z.infer<typeof readOutputSchema>;

export async function fsRead(acl: Acl, input: ReadInput): Promise<ReadOutput> {
  const { real } = await checkRead(acl, input.path);
  // Open the path once and inspect / read through the same handle.
  // Avoids the stat-then-readFile TOCTOU window CodeQL flagged: a
  // symlink swap or file replacement between the size check and the
  // read could let an attacker bypass the byte cap.
  const handle = await open(real, 'r');
  try {
    const st = await handle.stat();
    if (!st.isFile()) {
      throw new FsError('NOT_FOUND', `not a regular file: ${input.path}`);
    }
    const cap = Math.min(input.maxBytes ?? READ_MAX_BYTES, READ_MAX_BYTES);
    if (st.size > cap) {
      throw new FsError(
        'TOO_LARGE',
        `file is ${st.size} bytes; exceeds cap ${cap}. Increase maxBytes or stream externally.`,
      );
    }
    const buf = Buffer.alloc(st.size);
    if (st.size > 0) {
      await handle.read(buf, 0, st.size, 0);
    }
    const truncated = false; // we either read the whole file or refuse above
    return {
      path: real,
      encoding: input.encoding,
      bytes: buf.byteLength,
      truncated,
      content: input.encoding === 'utf8' ? buf.toString('utf8') : buf.toString('base64'),
    };
  } finally {
    await handle.close();
  }
}
