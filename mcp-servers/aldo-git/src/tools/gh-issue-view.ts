/**
 * gh.issue.view — read an issue's metadata + comments.
 */

import { z } from 'zod';
import { GitError, type GitPolicy, resolveRepoCwd } from '../policy.js';
import { runProcess } from './run.js';

const ISSUE_FIELDS = [
  'number',
  'title',
  'body',
  'state',
  'url',
  'author',
  'labels',
  'comments',
  'createdAt',
  'updatedAt',
];

export const ghIssueViewInputSchema = z
  .object({
    cwd: z.string().optional(),
    number: z.number().int().positive(),
  })
  .strict();

export type GhIssueViewInput = z.infer<typeof ghIssueViewInputSchema>;

const labelSchema = z.object({ name: z.string() });
const commentSchema = z.object({
  author: z.string().nullable(),
  body: z.string(),
  createdAt: z.string(),
});

export const ghIssueViewOutputSchema = z
  .object({
    cwd: z.string(),
    number: z.number().int(),
    title: z.string(),
    body: z.string(),
    state: z.string(),
    url: z.string(),
    author: z.string().nullable(),
    labels: z.array(labelSchema),
    comments: z.array(commentSchema),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .strict();

export type GhIssueViewOutput = z.infer<typeof ghIssueViewOutputSchema>;

export async function ghIssueView(
  policy: GitPolicy,
  input: GhIssueViewInput,
): Promise<GhIssueViewOutput> {
  const cwd = resolveRepoCwd(policy, input.cwd);
  const result = await runProcess(policy, {
    bin: policy.ghBin,
    args: ['issue', 'view', String(input.number), '--json', ISSUE_FIELDS.join(',')],
    cwd,
    timeoutMs: policy.defaultTimeoutMs,
  });
  if (result.exitCode !== 0 || result.timedOut) {
    throw new GitError(
      'INTERNAL',
      `gh issue view exited ${result.exitCode}: ${result.stderr.trim().slice(-512)}`,
    );
  }
  let raw: unknown;
  try {
    raw = JSON.parse(result.stdout);
  } catch (err) {
    throw new GitError(
      'INTERNAL',
      `gh issue view emitted non-JSON: ${(err as Error).message}`,
      err,
    );
  }
  if (!raw || typeof raw !== 'object') {
    throw new GitError('INTERNAL', `gh issue view expected JSON object`);
  }
  const e = raw as Record<string, unknown>;
  const author = (e.author as { login?: string } | undefined)?.login ?? null;
  const labels = Array.isArray(e.labels)
    ? e.labels.map((l) => ({ name: (l as { name?: string }).name ?? '' }))
    : [];
  const comments = Array.isArray(e.comments)
    ? e.comments.map((c) => {
        const cc = c as Record<string, unknown>;
        return {
          author: (cc.author as { login?: string } | undefined)?.login ?? null,
          body: typeof cc.body === 'string' ? cc.body : '',
          createdAt: typeof cc.createdAt === 'string' ? cc.createdAt : '',
        };
      })
    : [];
  return ghIssueViewOutputSchema.parse({
    cwd,
    number: e.number,
    title: e.title,
    body: e.body ?? '',
    state: e.state,
    url: e.url,
    author,
    labels,
    comments,
    createdAt: e.createdAt ?? '',
    updatedAt: e.updatedAt ?? '',
  });
}
