/**
 * git.branch.list — local branches with their upstreams and HEAD shas.
 *
 * Uses `git for-each-ref` so the output is field-stable across git
 * versions, instead of `git branch -vv` which is human-formatted.
 */

import { z } from 'zod';
import { type GitPolicy, resolveRepoCwd } from '../policy.js';
import { runGit } from './run.js';

export const branchListInputSchema = z.object({ cwd: z.string().optional() }).strict();
export type BranchListInput = z.infer<typeof branchListInputSchema>;

const branchSchema = z.object({
  name: z.string(),
  sha: z.string(),
  upstream: z.string().nullable(),
  ahead: z.number().int().nonnegative(),
  behind: z.number().int().nonnegative(),
});

export const branchListOutputSchema = z
  .object({
    cwd: z.string(),
    current: z.string().nullable(),
    branches: z.array(branchSchema),
  })
  .strict();

export type BranchListOutput = z.infer<typeof branchListOutputSchema>;

const FIELD = '\x1f';
const FORMAT =
  ['%(refname:short)', '%(objectname)', '%(upstream:short)', '%(upstream:track)'].join(FIELD);

export async function gitBranchList(
  policy: GitPolicy,
  input: BranchListInput,
): Promise<BranchListOutput> {
  const cwd = resolveRepoCwd(policy, input.cwd);
  const branchesResult = await runGit(policy, cwd, [
    'for-each-ref',
    'refs/heads/',
    `--format=${FORMAT}`,
  ]);
  const headResult = await runGit(policy, cwd, [
    'symbolic-ref',
    '--short',
    '-q',
    'HEAD',
  ], { allowExit: [0, 1] });
  const current = headResult.exitCode === 0 ? headResult.stdout.trim() || null : null;

  const branches: z.infer<typeof branchSchema>[] = [];
  for (const line of branchesResult.stdout.split('\n')) {
    if (line.length === 0) continue;
    const parts = line.split(FIELD);
    const [name, sha, upstreamRaw, trackRaw] = parts as [string, string, string, string];
    const upstream = upstreamRaw && upstreamRaw.length > 0 ? upstreamRaw : null;
    const { ahead, behind } = parseTrack(trackRaw ?? '');
    branches.push({ name, sha, upstream, ahead, behind });
  }
  return { cwd, current, branches };
}

export function parseTrack(track: string): { ahead: number; behind: number } {
  // Examples: "[ahead 2]", "[behind 1]", "[ahead 1, behind 3]", "" (in sync), "[gone]"
  let ahead = 0;
  let behind = 0;
  const aheadMatch = track.match(/ahead (\d+)/);
  const behindMatch = track.match(/behind (\d+)/);
  if (aheadMatch?.[1]) ahead = Number.parseInt(aheadMatch[1], 10);
  if (behindMatch?.[1]) behind = Number.parseInt(behindMatch[1], 10);
  return { ahead, behind };
}
