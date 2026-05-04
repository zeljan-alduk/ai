/**
 * git.push — push the current branch (or a named one) to a remote.
 *
 * `force: 'no'` (default) is a plain push.
 *
 * `force: 'with-lease'` requires the #9 approval-gate primitive. Until
 * that primitive is wired into the tool-host event loop, this tool
 * surfaces NEEDS_APPROVAL as a typed error so callers don't silently
 * force-push the day #9 lands. Plain `--force` is never reachable
 * from the schema.
 *
 * Refuses delete-remote-branch (`refspec: ":branchname"`) by accepting
 * only branch + remote (no raw refspecs).
 */

import { z } from 'zod';
import { GitError, type GitPolicy, assertRemoteAllowed, resolveRepoCwd } from '../policy.js';
import { runGit, runProcess } from './run.js';

const REF_RE = /^[A-Za-z0-9._/\-]{1,200}$/;

export const pushInputSchema = z
  .object({
    cwd: z.string().optional(),
    remote: z.string().regex(REF_RE).default('origin'),
    branch: z
      .string()
      .regex(REF_RE)
      .optional()
      .describe('Branch to push. Defaults to the current HEAD.'),
    setUpstream: z
      .boolean()
      .default(false)
      .describe('Pass --set-upstream so subsequent push/pull track this remote/branch.'),
    force: z
      .enum(['no', 'with-lease'])
      .default('no')
      .describe(
        '`no` (default): plain push. `with-lease`: force-push gated by the #9 approval primitive — currently always returns NEEDS_APPROVAL.',
      ),
  })
  .strict();

export type PushInput = z.infer<typeof pushInputSchema>;

export const pushOutputSchema = z
  .object({
    cwd: z.string(),
    remote: z.string(),
    branch: z.string(),
    setUpstream: z.boolean(),
    stderrTail: z.string(),
  })
  .strict();

export type PushOutput = z.infer<typeof pushOutputSchema>;

export async function gitPush(policy: GitPolicy, input: PushInput): Promise<PushOutput> {
  const cwd = resolveRepoCwd(policy, input.cwd);
  assertRemoteAllowed(policy, input.remote);

  if (input.force === 'with-lease') {
    throw new GitError(
      'NEEDS_APPROVAL',
      'git.push: force-with-lease requires the #9 approval primitive (not yet wired in tool-host)',
    );
  }

  let branch = input.branch;
  if (!branch) {
    const head = await runProcess(policy, {
      bin: policy.gitBin,
      args: ['symbolic-ref', '--short', '-q', 'HEAD'],
      cwd,
      timeoutMs: policy.defaultTimeoutMs,
    });
    if (head.exitCode !== 0 || head.timedOut) {
      throw new GitError('PERMISSION_DENIED', 'git.push: cannot push from detached HEAD');
    }
    branch = head.stdout.trim();
    if (!branch) {
      throw new GitError('PERMISSION_DENIED', 'git.push: empty branch name');
    }
  }

  const args: string[] = ['push'];
  if (input.setUpstream) args.push('--set-upstream');
  args.push(input.remote, branch);

  const result = await runGit(policy, cwd, args);
  return {
    cwd,
    remote: input.remote,
    branch,
    setUpstream: input.setUpstream,
    stderrTail: result.stderr,
  };
}
