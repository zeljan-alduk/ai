/**
 * gh.issue.comment — post a comment on an existing issue.
 *
 * Body via --body-file tmpfile (same pattern as gh.pr.comment).
 */

import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { GitError, type GitPolicy, resolveRepoCwd } from '../policy.js';
import { runProcess } from './run.js';

export const ghIssueCommentInputSchema = z
  .object({
    cwd: z.string().optional(),
    number: z.number().int().positive(),
    body: z.string().min(1).max(60_000),
  })
  .strict();

export type GhIssueCommentInput = z.infer<typeof ghIssueCommentInputSchema>;

export const ghIssueCommentOutputSchema = z
  .object({
    cwd: z.string(),
    number: z.number().int(),
    url: z.string().nullable(),
  })
  .strict();

export type GhIssueCommentOutput = z.infer<typeof ghIssueCommentOutputSchema>;

export async function ghIssueComment(
  policy: GitPolicy,
  input: GhIssueCommentInput,
): Promise<GhIssueCommentOutput> {
  const cwd = resolveRepoCwd(policy, input.cwd);
  const bodyPath = join(tmpdir(), `aldo-gh-issue-comment-${Date.now()}-${process.pid}.md`);
  await writeFile(bodyPath, input.body, 'utf8');
  const result = await runProcess(policy, {
    bin: policy.ghBin,
    args: ['issue', 'comment', String(input.number), '--body-file', bodyPath],
    cwd,
    timeoutMs: policy.defaultTimeoutMs,
  });
  if (result.exitCode !== 0 || result.timedOut) {
    throw new GitError(
      'INTERNAL',
      `gh issue comment exited ${result.exitCode}: ${result.stderr.trim().slice(-512)}`,
    );
  }
  const url = (result.stdout.match(/https?:\/\/[^\s]+/) ?? [null])[0];
  return { cwd, number: input.number, url: url ?? null };
}
