/**
 * git.pull — fast-forward-only merge from a remote branch.
 *
 * `--ff-only` is hard-coded: a merge commit produced by the agent is
 * harder to review than an explicit "rebase needed" failure. Callers
 * see `INTERNAL` with git's non-fast-forward stderr when the remote
 * has diverged.
 */

import { z } from 'zod';
import { type GitPolicy, assertRemoteAllowed, resolveRepoCwd } from '../policy.js';
import { runGit } from './run.js';

const REF_RE = /^[A-Za-z0-9._/\-]{1,200}$/;

export const pullInputSchema = z
  .object({
    cwd: z.string().optional(),
    remote: z.string().regex(REF_RE).default('origin'),
    branch: z.string().regex(REF_RE).optional(),
  })
  .strict();

export type PullInput = z.infer<typeof pullInputSchema>;

export const pullOutputSchema = z
  .object({
    cwd: z.string(),
    remote: z.string(),
    branch: z.string().nullable(),
    upToDate: z.boolean(),
    stderrTail: z.string(),
  })
  .strict();

export type PullOutput = z.infer<typeof pullOutputSchema>;

export async function gitPull(policy: GitPolicy, input: PullInput): Promise<PullOutput> {
  const cwd = resolveRepoCwd(policy, input.cwd);
  assertRemoteAllowed(policy, input.remote);
  const args: string[] = ['pull', '--ff-only', input.remote];
  if (input.branch) args.push(input.branch);
  const result = await runGit(policy, cwd, args);
  return {
    cwd,
    remote: input.remote,
    branch: input.branch ?? null,
    upToDate: /already up to date/i.test(result.stdout) || /already up to date/i.test(result.stderr),
    stderrTail: result.stderr,
  };
}
