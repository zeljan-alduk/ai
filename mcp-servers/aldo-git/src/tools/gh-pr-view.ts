/**
 * gh.pr.view — read a PR's metadata via `gh pr view --json`.
 */

import { z } from 'zod';
import { GitError, type GitPolicy, resolveRepoCwd } from '../policy.js';
import { runProcess } from './run.js';

const PR_VIEW_FIELDS = [
  'number',
  'title',
  'body',
  'state',
  'url',
  'headRefName',
  'baseRefName',
  'author',
  'isDraft',
  'mergeable',
  'reviews',
];

export const ghPrViewInputSchema = z
  .object({
    cwd: z.string().optional(),
    number: z.number().int().positive(),
  })
  .strict();

export type GhPrViewInput = z.infer<typeof ghPrViewInputSchema>;

const reviewSchema = z.object({
  author: z.string().nullable(),
  state: z.string(),
  body: z.string(),
});

export const ghPrViewOutputSchema = z
  .object({
    cwd: z.string(),
    number: z.number().int(),
    title: z.string(),
    body: z.string(),
    state: z.string(),
    url: z.string(),
    headRefName: z.string(),
    baseRefName: z.string(),
    author: z.string().nullable(),
    isDraft: z.boolean(),
    mergeable: z.string().nullable(),
    reviews: z.array(reviewSchema),
  })
  .strict();

export type GhPrViewOutput = z.infer<typeof ghPrViewOutputSchema>;

export async function ghPrView(policy: GitPolicy, input: GhPrViewInput): Promise<GhPrViewOutput> {
  const cwd = resolveRepoCwd(policy, input.cwd);
  const args = ['pr', 'view', String(input.number), '--json', PR_VIEW_FIELDS.join(',')];
  const result = await runProcess(policy, {
    bin: policy.ghBin,
    args,
    cwd,
    timeoutMs: policy.defaultTimeoutMs,
  });
  if (result.exitCode !== 0 || result.timedOut) {
    throw new GitError(
      'INTERNAL',
      `gh pr view exited ${result.exitCode}: ${result.stderr.trim().slice(-512)}`,
    );
  }
  let raw: unknown;
  try {
    raw = JSON.parse(result.stdout);
  } catch (err) {
    throw new GitError('INTERNAL', `gh pr view emitted non-JSON: ${(err as Error).message}`, err);
  }
  if (!raw || typeof raw !== 'object') {
    throw new GitError('INTERNAL', `gh pr view expected JSON object`);
  }
  const e = raw as Record<string, unknown>;
  const author = (e.author as { login?: string } | undefined)?.login ?? null;
  const reviews = Array.isArray(e.reviews)
    ? e.reviews.map((r) => {
        const rr = r as Record<string, unknown>;
        return reviewSchema.parse({
          author: (rr.author as { login?: string } | undefined)?.login ?? null,
          state: rr.state ?? '',
          body: rr.body ?? '',
        });
      })
    : [];
  return ghPrViewOutputSchema.parse({
    cwd,
    number: e.number,
    title: e.title,
    body: e.body ?? '',
    state: e.state,
    url: e.url,
    headRefName: e.headRefName,
    baseRefName: e.baseRefName,
    author,
    isDraft: e.isDraft ?? false,
    mergeable: typeof e.mergeable === 'string' ? e.mergeable : null,
    reviews,
  });
}
