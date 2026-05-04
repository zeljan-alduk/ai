/**
 * git.checkout — switch HEAD to an existing branch or create a new one.
 *
 * Refuses to switch when the working tree is dirty unless `allowDirty:
 * true` is explicit. Does not pass `--force` and does not accept any
 * options that would discard local changes silently.
 */

import { z } from 'zod';
import { GitError, type GitPolicy, resolveRepoCwd } from '../policy.js';
import { runGit } from './run.js';
import { gitStatus } from './status.js';

const BRANCH_RE = /^[A-Za-z0-9._/\-]{1,200}$/;

export const checkoutInputSchema = z
  .object({
    cwd: z.string().optional(),
    branch: z
      .string()
      .regex(BRANCH_RE, 'branch must match [A-Za-z0-9._/-]')
      .min(1)
      .describe('Branch name to switch to.'),
    create: z.boolean().default(false).describe('When true, create the branch from current HEAD.'),
    startPoint: z
      .string()
      .regex(BRANCH_RE)
      .optional()
      .describe('Optional start ref for branch creation.'),
    allowDirty: z
      .boolean()
      .default(false)
      .describe('When false, refuses to switch with a dirty working tree.'),
  })
  .strict();

export type CheckoutInput = z.infer<typeof checkoutInputSchema>;

export const checkoutOutputSchema = z
  .object({
    cwd: z.string(),
    branch: z.string(),
    created: z.boolean(),
  })
  .strict();

export type CheckoutOutput = z.infer<typeof checkoutOutputSchema>;

export async function gitCheckout(
  policy: GitPolicy,
  input: CheckoutInput,
): Promise<CheckoutOutput> {
  const cwd = resolveRepoCwd(policy, input.cwd);

  if (!input.allowDirty) {
    const status = await gitStatus(policy, { cwd });
    if (!status.clean) {
      throw new GitError(
        'PERMISSION_DENIED',
        'git.checkout: working tree is dirty; commit/stash first or pass allowDirty: true',
      );
    }
  }

  if (input.create) {
    const args = ['checkout', '-b', input.branch];
    if (input.startPoint) args.push(input.startPoint);
    await runGit(policy, cwd, args);
  } else {
    await runGit(policy, cwd, ['checkout', input.branch]);
  }

  return { cwd, branch: input.branch, created: input.create };
}
