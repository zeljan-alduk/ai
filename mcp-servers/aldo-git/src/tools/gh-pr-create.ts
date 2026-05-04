/**
 * gh.pr.create — open a pull request via the GitHub CLI.
 *
 * Body is passed via `--body-file` writing to a tmpfile so multi-KB
 * descriptions and templates don't hit argv length limits or shell
 * escaping (which we don't have anyway — `shell: false`).
 *
 * Returns `{url, number}` parsed from gh's stdout.
 */

import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { GitError, type GitPolicy, resolveRepoCwd } from '../policy.js';
import { runProcess } from './run.js';

const REF_RE = /^[A-Za-z0-9._/\-]{1,200}$/;

export const ghPrCreateInputSchema = z
  .object({
    cwd: z.string().optional(),
    title: z.string().min(1).max(400),
    body: z.string().default(''),
    base: z.string().regex(REF_RE).optional(),
    head: z.string().regex(REF_RE).optional(),
    draft: z.boolean().default(false),
  })
  .strict();

export type GhPrCreateInput = z.infer<typeof ghPrCreateInputSchema>;

export const ghPrCreateOutputSchema = z
  .object({
    url: z.string(),
    number: z.number().int().nullable(),
    cwd: z.string(),
  })
  .strict();

export type GhPrCreateOutput = z.infer<typeof ghPrCreateOutputSchema>;

export async function ghPrCreate(
  policy: GitPolicy,
  input: GhPrCreateInput,
): Promise<GhPrCreateOutput> {
  const cwd = resolveRepoCwd(policy, input.cwd);
  const bodyPath = join(tmpdir(), `aldo-gh-pr-${Date.now()}-${process.pid}.md`);
  await writeFile(bodyPath, input.body, 'utf8');

  const args: string[] = ['pr', 'create', '--title', input.title, '--body-file', bodyPath];
  if (input.base) args.push('--base', input.base);
  if (input.head) args.push('--head', input.head);
  if (input.draft) args.push('--draft');

  const result = await runProcess(policy, {
    bin: policy.ghBin,
    args,
    cwd,
    timeoutMs: policy.defaultTimeoutMs,
  });
  if (result.timedOut) {
    throw new GitError('TIMEOUT', `gh pr create timed out after ${result.durationMs}ms`);
  }
  if (result.exitCode !== 0) {
    throw new GitError(
      'INTERNAL',
      `gh pr create exited ${result.exitCode}: ${result.stderr.trim().slice(-512) || result.stdout.trim().slice(-512)}`,
    );
  }

  const url = extractUrl(result.stdout);
  if (!url) {
    throw new GitError(
      'INTERNAL',
      `gh pr create did not emit a PR URL — stdout: ${result.stdout.trim().slice(0, 256)}`,
    );
  }
  return { url, number: extractNumber(url), cwd };
}

export function extractUrl(stdout: string): string | null {
  const m = stdout.match(/https?:\/\/[^\s]+/);
  return m ? m[0]! : null;
}

export function extractNumber(url: string): number | null {
  const m = url.match(/\/pull\/(\d+)/);
  return m?.[1] ? Number.parseInt(m[1], 10) : null;
}
