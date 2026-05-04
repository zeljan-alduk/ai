/**
 * gh.pr.comment — append a comment to an existing PR.
 *
 * Body via `--body-file` tmpfile, same pattern as gh.pr.create, so
 * multi-KB review comments are safe.
 */

import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { GitError, type GitPolicy, resolveRepoCwd } from '../policy.js';
import { runProcess } from './run.js';

export const ghPrCommentInputSchema = z
  .object({
    cwd: z.string().optional(),
    number: z.number().int().positive(),
    body: z.string().min(1).max(60_000),
  })
  .strict();

export type GhPrCommentInput = z.infer<typeof ghPrCommentInputSchema>;

export const ghPrCommentOutputSchema = z
  .object({
    cwd: z.string(),
    number: z.number().int(),
    url: z.string().nullable(),
  })
  .strict();

export type GhPrCommentOutput = z.infer<typeof ghPrCommentOutputSchema>;

export async function ghPrComment(
  policy: GitPolicy,
  input: GhPrCommentInput,
): Promise<GhPrCommentOutput> {
  const cwd = resolveRepoCwd(policy, input.cwd);
  const bodyPath = join(tmpdir(), `aldo-gh-comment-${Date.now()}-${process.pid}.md`);
  await writeFile(bodyPath, input.body, 'utf8');
  const result = await runProcess(policy, {
    bin: policy.ghBin,
    args: ['pr', 'comment', String(input.number), '--body-file', bodyPath],
    cwd,
    timeoutMs: policy.defaultTimeoutMs,
  });
  if (result.exitCode !== 0 || result.timedOut) {
    throw new GitError(
      'INTERNAL',
      `gh pr comment exited ${result.exitCode}: ${result.stderr.trim().slice(-512)}`,
    );
  }
  const url = (result.stdout.match(/https?:\/\/[^\s]+/) ?? [null])[0];
  return { cwd, number: input.number, url: url ?? null };
}
