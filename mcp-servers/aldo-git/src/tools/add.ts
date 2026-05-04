/**
 * git.add — stage one or more working-tree paths.
 *
 * Refuses `.`, bare wildcards, and any path that escapes the repo root.
 * Forces explicit per-file selection so the agent never accidentally
 * stages large swathes of an unrelated working tree.
 */

import { existsSync, lstatSync } from 'node:fs';
import { join, relative } from 'node:path';
import { z } from 'zod';
import { GitError, type GitPolicy, assertPathInsideRepo, resolveRepoCwd } from '../policy.js';
import { runGit } from './run.js';

const FORBIDDEN_PATH_TOKENS = new Set(['.', '..', '*', '**']);

export const addInputSchema = z
  .object({
    cwd: z.string().optional(),
    paths: z
      .array(z.string().min(1))
      .min(1)
      .describe('Working-tree paths to stage. Each must exist and lie inside the repo.'),
  })
  .strict();

export type AddInput = z.infer<typeof addInputSchema>;

export const addOutputSchema = z
  .object({
    cwd: z.string(),
    staged: z.array(z.string()),
  })
  .strict();

export type AddOutput = z.infer<typeof addOutputSchema>;

export async function gitAdd(policy: GitPolicy, input: AddInput): Promise<AddOutput> {
  const cwd = resolveRepoCwd(policy, input.cwd);
  const staged: string[] = [];
  for (const p of input.paths) {
    if (FORBIDDEN_PATH_TOKENS.has(p) || p.includes('*')) {
      throw new GitError(
        'INVALID_INPUT',
        `git.add: refusing wildcard / sentinel path "${p}" — pass concrete paths only`,
      );
    }
    if (p.startsWith('-')) {
      throw new GitError('INVALID_INPUT', `git.add: paths must not start with "-": "${p}"`);
    }
    const abs = assertPathInsideRepo(cwd, p);
    if (!existsSync(abs)) {
      throw new GitError('INVALID_INPUT', `git.add: path does not exist: "${p}"`);
    }
    // lstat (not stat) so a dangling symlink still trips the existence check.
    const _ = lstatSync(abs);
    void _;
    staged.push(relative(cwd, abs));
  }
  await runGit(policy, cwd, ['add', '--', ...staged]);
  return { cwd, staged };
}

// Re-export join for parity with consumers expecting node-path on this module.
export { join };
