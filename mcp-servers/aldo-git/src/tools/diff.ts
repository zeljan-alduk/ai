/**
 * git.diff — patch + per-file additions/deletions counts.
 *
 * Modes:
 *   - working tree vs index (default)
 *   - staged (--cached)
 *   - revision range (e.g. "HEAD~2..HEAD")
 *
 * Patch is returned tail-capped via the policy's `outputTailBytes`.
 * Counts come from `--numstat` so the model sees magnitudes even when
 * the patch itself is truncated.
 */

import { z } from 'zod';
import { type GitPolicy, GitError, resolveRepoCwd } from '../policy.js';
import { runGit } from './run.js';

const REV_RE = /^[A-Za-z0-9._/^~@\-+:]{1,200}$/;

export const diffInputSchema = z
  .object({
    cwd: z.string().optional(),
    staged: z.boolean().default(false).describe('Diff staged-vs-HEAD when true.'),
    range: z
      .string()
      .regex(REV_RE)
      .optional()
      .describe('Revision range, e.g. "main..HEAD" or "HEAD~3..HEAD".'),
    paths: z
      .array(z.string())
      .default([])
      .describe('Optional path filter. Each entry must not start with "-".'),
  })
  .strict()
  .superRefine((val, ctx) => {
    if (val.staged && val.range !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: '`staged` and `range` are mutually exclusive',
      });
    }
  });

export type DiffInput = z.infer<typeof diffInputSchema>;

const fileStat = z.object({
  path: z.string(),
  additions: z.number().int().nonnegative(),
  deletions: z.number().int().nonnegative(),
  binary: z.boolean(),
});

export const diffOutputSchema = z
  .object({
    cwd: z.string(),
    mode: z.enum(['worktree', 'staged', 'range']),
    range: z.string().nullable(),
    patch: z.string(),
    patchTruncated: z.boolean(),
    files: z.array(fileStat),
  })
  .strict();

export type DiffOutput = z.infer<typeof diffOutputSchema>;

export async function gitDiff(policy: GitPolicy, input: DiffInput): Promise<DiffOutput> {
  const cwd = resolveRepoCwd(policy, input.cwd);
  for (const p of input.paths) {
    if (p.startsWith('-')) {
      throw new GitError('INVALID_INPUT', `diff paths[*] must not start with "-": "${p}"`);
    }
  }
  const mode = input.staged ? 'staged' : input.range ? 'range' : 'worktree';

  const baseArgs: string[] = ['diff', '--no-color'];
  if (input.staged) baseArgs.push('--cached');
  if (input.range) baseArgs.push(input.range);
  const trailing = input.paths.length > 0 ? ['--', ...input.paths] : [];

  const patchResult = await runGit(policy, cwd, [...baseArgs, ...trailing]);
  const numstatResult = await runGit(policy, cwd, [...baseArgs, '--numstat', ...trailing]);

  const patchTruncated = patchResult.stdoutTruncated;
  return {
    cwd,
    mode,
    range: input.range ?? null,
    patch: patchResult.stdout,
    patchTruncated,
    files: parseNumstat(numstatResult.stdout),
  };
}

export function parseNumstat(raw: string): z.infer<typeof fileStat>[] {
  const out: z.infer<typeof fileStat>[] = [];
  for (const line of raw.split('\n')) {
    if (line.length === 0) continue;
    // "<adds>\t<dels>\t<path>"   binary files use "-\t-\t<path>"
    const parts = line.split('\t');
    if (parts.length < 3) continue;
    const a = parts[0]!;
    const d = parts[1]!;
    const path = parts.slice(2).join('\t');
    const binary = a === '-' && d === '-';
    out.push({
      path,
      additions: binary ? 0 : Number.parseInt(a, 10) || 0,
      deletions: binary ? 0 : Number.parseInt(d, 10) || 0,
      binary,
    });
  }
  return out;
}
