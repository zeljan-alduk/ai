/**
 * git.commit — create a new commit on the current branch.
 *
 * Hard-coded denials, none of which are exposed via the schema:
 *   - --amend            (rewriting published history is a one-way op)
 *   - --no-verify        (skipping pre-commit hooks is a recurring footgun)
 *   - committing onto a protected branch
 *
 * `signoff: true` is the only optional flag; everything else is the
 * default behaviour.
 *
 * Returns {sha, branch} on success.
 */

import { z } from 'zod';
import { GitError, type GitPolicy, assertCommitAllowed, resolveRepoCwd } from '../policy.js';
import { runGit, runProcess } from './run.js';

export const commitInputSchema = z
  .object({
    cwd: z.string().optional(),
    message: z
      .string()
      .min(1)
      .max(20_000)
      .describe('Commit message. First line ~50 chars; full body allowed.'),
    allowEmpty: z
      .boolean()
      .default(false)
      .describe('Permit a commit with no staged diff. Off by default.'),
    signoff: z.boolean().default(false).describe('Append a Signed-off-by trailer.'),
  })
  .strict();

export type CommitInput = z.infer<typeof commitInputSchema>;

export const commitOutputSchema = z
  .object({
    cwd: z.string(),
    sha: z.string(),
    branch: z.string().nullable(),
  })
  .strict();

export type CommitOutput = z.infer<typeof commitOutputSchema>;

export async function gitCommit(policy: GitPolicy, input: CommitInput): Promise<CommitOutput> {
  const cwd = resolveRepoCwd(policy, input.cwd);

  const branchResult = await runProcess(policy, {
    bin: policy.gitBin,
    args: ['symbolic-ref', '--short', '-q', 'HEAD'],
    cwd,
    timeoutMs: policy.defaultTimeoutMs,
  });
  const branch =
    branchResult.exitCode === 0 && !branchResult.timedOut
      ? branchResult.stdout.trim() || null
      : null;
  if (!branch) {
    throw new GitError('PERMISSION_DENIED', 'git.commit: refusing to commit on detached HEAD');
  }
  assertCommitAllowed(policy, branch);

  const args: string[] = ['commit', '-m', input.message];
  if (input.allowEmpty) args.push('--allow-empty');
  if (input.signoff) args.push('--signoff');

  await runGit(policy, cwd, args);

  const headResult = await runGit(policy, cwd, ['rev-parse', 'HEAD']);
  return { cwd, sha: headResult.stdout.trim(), branch };
}
