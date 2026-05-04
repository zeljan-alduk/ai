/**
 * git.status — branch, ahead/behind tracking info, and per-file working
 * tree state.
 *
 * Uses `git status --porcelain=v2 --branch` so the parser sees a stable
 * machine-readable shape rather than the human "On branch ..." text.
 */

import { z } from 'zod';
import { type GitPolicy, resolveRepoCwd } from '../policy.js';
import { runGit } from './run.js';

export const statusInputSchema = z
  .object({
    cwd: z
      .string()
      .optional()
      .describe('Absolute repo root. Must be inside an allowedRoots entry and contain `.git`.'),
  })
  .strict();

export type StatusInput = z.infer<typeof statusInputSchema>;

const fileEntrySchema = z.object({
  path: z.string(),
  status: z.string(),
  staged: z.boolean(),
  unstaged: z.boolean(),
});

export const statusOutputSchema = z
  .object({
    cwd: z.string(),
    branch: z.string().nullable(),
    upstream: z.string().nullable(),
    ahead: z.number().int().nonnegative(),
    behind: z.number().int().nonnegative(),
    detached: z.boolean(),
    clean: z.boolean(),
    files: z.array(fileEntrySchema),
  })
  .strict();

export type StatusOutput = z.infer<typeof statusOutputSchema>;

export async function gitStatus(policy: GitPolicy, input: StatusInput): Promise<StatusOutput> {
  const cwd = resolveRepoCwd(policy, input.cwd);
  const result = await runGit(policy, cwd, ['status', '--porcelain=v2', '--branch']);
  return parsePorcelainV2(cwd, result.stdout);
}

export function parsePorcelainV2(cwd: string, raw: string): StatusOutput {
  let branch: string | null = null;
  let upstream: string | null = null;
  let ahead = 0;
  let behind = 0;
  let detached = false;
  const files: z.infer<typeof fileEntrySchema>[] = [];

  for (const line of raw.split('\n')) {
    if (line.length === 0) continue;
    if (line.startsWith('# branch.head ')) {
      const head = line.slice('# branch.head '.length).trim();
      if (head === '(detached)') {
        detached = true;
      } else {
        branch = head;
      }
    } else if (line.startsWith('# branch.upstream ')) {
      upstream = line.slice('# branch.upstream '.length).trim();
    } else if (line.startsWith('# branch.ab ')) {
      // "+1 -2"
      const tail = line.slice('# branch.ab '.length).trim().split(' ');
      ahead = Math.abs(Number.parseInt(tail[0] ?? '+0', 10));
      behind = Math.abs(Number.parseInt(tail[1] ?? '-0', 10));
    } else if (line.startsWith('1 ') || line.startsWith('2 ')) {
      // "1 XY sub mH mI mW hH hI path"
      // "2 XY sub mH mI mW hH hI X<score> path<TAB>orig"
      const parts = line.split(' ');
      const xy = parts[1] ?? '..';
      const path = line.startsWith('2 ')
        ? (parts.slice(9).join(' ').split('\t')[0] ?? '')
        : parts.slice(8).join(' ');
      const staged = xy[0] !== '.';
      const unstaged = xy[1] !== '.';
      files.push({ path, status: xy, staged, unstaged });
    } else if (line.startsWith('? ')) {
      files.push({
        path: line.slice(2),
        status: '??',
        staged: false,
        unstaged: true,
      });
    } else if (line.startsWith('u ')) {
      // unmerged: "u XY sub m1 m2 m3 mW h1 h2 h3 path"
      const parts = line.split(' ');
      const xy = parts[1] ?? 'UU';
      const path = parts.slice(10).join(' ');
      files.push({ path, status: xy, staged: false, unstaged: true });
    }
  }

  return {
    cwd,
    branch,
    upstream,
    ahead,
    behind,
    detached,
    clean: files.length === 0,
    files,
  };
}
