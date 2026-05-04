/**
 * git.fetch — update remote-tracking refs from a configured remote.
 *
 * Remote must be in `policy.allowedRemotes` (default `origin`).
 * No-op locally — modifies refs/remotes/<remote>/* only.
 */

import { z } from 'zod';
import { type GitPolicy, assertRemoteAllowed, resolveRepoCwd } from '../policy.js';
import { runGit } from './run.js';

const REMOTE_RE = /^[A-Za-z0-9._\-]{1,80}$/;

export const fetchInputSchema = z
  .object({
    cwd: z.string().optional(),
    remote: z.string().regex(REMOTE_RE).default('origin'),
    prune: z.boolean().default(false),
  })
  .strict();

export type FetchInput = z.infer<typeof fetchInputSchema>;

export const fetchOutputSchema = z
  .object({
    cwd: z.string(),
    remote: z.string(),
    stderrTail: z.string(),
  })
  .strict();

export type FetchOutput = z.infer<typeof fetchOutputSchema>;

export async function gitFetch(policy: GitPolicy, input: FetchInput): Promise<FetchOutput> {
  const cwd = resolveRepoCwd(policy, input.cwd);
  assertRemoteAllowed(policy, input.remote);
  const args: string[] = ['fetch'];
  if (input.prune) args.push('--prune');
  args.push(input.remote);
  const result = await runGit(policy, cwd, args);
  return { cwd, remote: input.remote, stderrTail: result.stderr };
}
