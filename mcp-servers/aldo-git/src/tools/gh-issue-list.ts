/**
 * gh.issue.list — list issues filtered by state.
 */

import { z } from 'zod';
import { GitError, type GitPolicy, resolveRepoCwd } from '../policy.js';
import { runProcess } from './run.js';

const FIELDS = ['number', 'title', 'state', 'url', 'author', 'labels', 'createdAt'];

export const ghIssueListInputSchema = z
  .object({
    cwd: z.string().optional(),
    state: z.enum(['open', 'closed', 'all']).default('open'),
    limit: z.number().int().positive().max(200).default(30),
  })
  .strict();

export type GhIssueListInput = z.infer<typeof ghIssueListInputSchema>;

const issueSchema = z.object({
  number: z.number().int(),
  title: z.string(),
  state: z.string(),
  url: z.string(),
  author: z.string().nullable(),
  labels: z.array(z.string()),
  createdAt: z.string(),
});

export const ghIssueListOutputSchema = z
  .object({
    cwd: z.string(),
    issues: z.array(issueSchema),
  })
  .strict();

export type GhIssueListOutput = z.infer<typeof ghIssueListOutputSchema>;

export async function ghIssueList(
  policy: GitPolicy,
  input: GhIssueListInput,
): Promise<GhIssueListOutput> {
  const cwd = resolveRepoCwd(policy, input.cwd);
  const args = [
    'issue',
    'list',
    '--state',
    input.state,
    '--limit',
    String(input.limit),
    '--json',
    FIELDS.join(','),
  ];
  const result = await runProcess(policy, {
    bin: policy.ghBin,
    args,
    cwd,
    timeoutMs: policy.defaultTimeoutMs,
  });
  if (result.exitCode !== 0 || result.timedOut) {
    throw new GitError(
      'INTERNAL',
      `gh issue list exited ${result.exitCode}: ${result.stderr.trim().slice(-512)}`,
    );
  }
  let raw: unknown;
  try {
    raw = JSON.parse(result.stdout);
  } catch (err) {
    throw new GitError(
      'INTERNAL',
      `gh issue list emitted non-JSON: ${(err as Error).message}`,
      err,
    );
  }
  if (!Array.isArray(raw)) {
    throw new GitError('INTERNAL', `gh issue list expected JSON array, got ${typeof raw}`);
  }
  const issues = raw.map((entry) => normaliseIssue(entry));
  return { cwd, issues };
}

function normaliseIssue(entry: unknown): z.infer<typeof issueSchema> {
  if (!entry || typeof entry !== 'object') {
    throw new GitError('INTERNAL', `gh issue list emitted non-object entry`);
  }
  const e = entry as Record<string, unknown>;
  const author = (e.author as { login?: string } | undefined)?.login ?? null;
  const labels = Array.isArray(e.labels)
    ? e.labels.map((l) => (l as { name?: string }).name ?? '').filter((s) => s.length > 0)
    : [];
  return issueSchema.parse({
    number: e.number,
    title: e.title,
    state: e.state,
    url: e.url,
    author,
    labels,
    createdAt: e.createdAt ?? '',
  });
}
