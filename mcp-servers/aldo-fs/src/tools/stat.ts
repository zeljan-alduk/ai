/**
 * fs.stat — return metadata for a path under an allowed root.
 */

import { stat as fsStat, lstat } from 'node:fs/promises';
import { z } from 'zod';
import type { Acl } from '../acl.js';
import { checkRead } from '../acl.js';

export const statInputSchema = z
  .object({
    path: z.string().describe('Path to stat. Absolute or relative to first root.'),
    /** When true, do not follow symlinks (lstat). Defaults to false (stat). */
    noFollow: z.boolean().default(false),
  })
  .strict();

export type StatInput = z.infer<typeof statInputSchema>;

export const statOutputSchema = z
  .object({
    path: z.string(),
    kind: z.enum(['file', 'dir', 'symlink', 'other']),
    size: z.number().int().nonnegative(),
    mtimeMs: z.number().nonnegative(),
    ctimeMs: z.number().nonnegative(),
    mode: z.number().int().nonnegative(),
    isSymlink: z.boolean(),
  })
  .strict();

export type StatOutput = z.infer<typeof statOutputSchema>;

export async function fsStatTool(acl: Acl, input: StatInput): Promise<StatOutput> {
  const { real, abs } = await checkRead(acl, input.path);
  const target = input.noFollow ? abs : real;
  const st = input.noFollow ? await lstat(target) : await fsStat(target);
  const kind: StatOutput['kind'] = st.isFile()
    ? 'file'
    : st.isDirectory()
      ? 'dir'
      : st.isSymbolicLink()
        ? 'symlink'
        : 'other';
  return {
    path: real,
    kind,
    size: st.size,
    mtimeMs: st.mtimeMs,
    ctimeMs: st.ctimeMs,
    mode: st.mode,
    isSymlink: st.isSymbolicLink(),
  };
}
