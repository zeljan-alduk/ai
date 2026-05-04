/**
 * gh.pr.list — list pull requests via `gh pr list --json`.
 */

import { z } from 'zod';
import { GitError, type GitPolicy, resolveRepoCwd } from '../policy.js';
import { runProcess } from './run.js';

const PR_FIELDS = [
  'number',
  'title',
  'state',
  'url',
  'headRefName',
  'baseRefName',
  'author',
  'isDraft',
];

export const ghPrListInputSchema = z
  .object({
    cwd: z.string().optional(),
    state: z.enum(['open', 'closed', 'merged', 'all']).default('open'),
    limit: z.number().int().positive().max(200).default(30),
  })
  .strict();

export type GhPrListInput = z.infer<typeof ghPrListInputSchema>;

const prSchema = z.object({
  number: z.number().int(),
  title: z.string(),
  state: z.string(),
  url: z.string(),
  headRefName: z.string(),
  baseRefName: z.string(),
  author: z.string().nullable(),
  isDraft: z.boolean(),
});

export const ghPrListOutputSchema = z
  .object({
    cwd: z.string(),
    prs: z.array(prSchema),
  })
  .strict();

export type GhPrListOutput = z.infer<typeof ghPrListOutputSchema>;

export async function ghPrList(policy: GitPolicy, input: GhPrListInput): Promise<GhPrListOutput> {
  const cwd = resolveRepoCwd(policy, input.cwd);
  const args = [
    'pr',
    'list',
    '--state',
    input.state,
    '--limit',
    String(input.limit),
    '--json',
    PR_FIELDS.join(','),
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
      `gh pr list exited ${result.exitCode}: ${result.stderr.trim().slice(-512)}`,
    );
  }
  let raw: unknown;
  try {
    raw = JSON.parse(result.stdout);
  } catch (err) {
    throw new GitError('INTERNAL', `gh pr list emitted non-JSON: ${(err as Error).message}`, err);
  }
  if (!Array.isArray(raw)) {
    throw new GitError('INTERNAL', `gh pr list expected JSON array, got ${typeof raw}`);
  }
  const prs = raw.map((entry) => normalisePr(entry));
  return { cwd, prs };
}

function normalisePr(entry: unknown): z.infer<typeof prSchema> {
  if (!entry || typeof entry !== 'object') {
    throw new GitError('INTERNAL', `gh pr list emitted non-object entry`);
  }
  const e = entry as Record<string, unknown>;
  const author = (e.author as { login?: string } | undefined)?.login ?? null;
  return prSchema.parse({
    number: e.number,
    title: e.title,
    state: e.state,
    url: e.url,
    headRefName: e.headRefName,
    baseRefName: e.baseRefName,
    author,
    isDraft: e.isDraft ?? false,
  });
}
