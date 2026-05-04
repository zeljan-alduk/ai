/**
 * git.log — recent commit metadata.
 *
 * Uses `--pretty=format:` with `\x1f` field / `\x1e` record separators
 * so commit messages containing newlines or pipes don't confuse the
 * parser.
 */

import { z } from 'zod';
import { type GitPolicy, GitError, resolveRepoCwd } from '../policy.js';
import { runGit } from './run.js';

const REV_RE = /^[A-Za-z0-9._/^~@\-+:]{1,200}$/;

export const logInputSchema = z
  .object({
    cwd: z.string().optional(),
    range: z
      .string()
      .regex(REV_RE)
      .optional()
      .describe('Optional revision range or single ref.'),
    maxCount: z.number().int().positive().max(500).default(20),
    paths: z.array(z.string()).default([]),
  })
  .strict();

export type LogInput = z.infer<typeof logInputSchema>;

const commitSchema = z.object({
  sha: z.string(),
  shortSha: z.string(),
  parents: z.array(z.string()),
  authorName: z.string(),
  authorEmail: z.string(),
  authorDate: z.string(),
  subject: z.string(),
});

export const logOutputSchema = z
  .object({
    cwd: z.string(),
    commits: z.array(commitSchema),
  })
  .strict();

export type LogOutput = z.infer<typeof logOutputSchema>;

const FIELD = '\x1f';
const RECORD = '\x1e';
const FORMAT = ['%H', '%h', '%P', '%an', '%ae', '%aI', '%s'].join(FIELD) + RECORD;

export async function gitLog(policy: GitPolicy, input: LogInput): Promise<LogOutput> {
  const cwd = resolveRepoCwd(policy, input.cwd);
  for (const p of input.paths) {
    if (p.startsWith('-')) {
      throw new GitError('INVALID_INPUT', `log paths[*] must not start with "-": "${p}"`);
    }
  }
  const args: string[] = [
    'log',
    `--pretty=format:${FORMAT}`,
    `--max-count=${input.maxCount}`,
  ];
  if (input.range) args.push(input.range);
  if (input.paths.length > 0) args.push('--', ...input.paths);

  const result = await runGit(policy, cwd, args);
  return { cwd, commits: parseLog(result.stdout) };
}

export function parseLog(raw: string): z.infer<typeof commitSchema>[] {
  const commits: z.infer<typeof commitSchema>[] = [];
  for (const rec of raw.split(RECORD)) {
    const trimmed = rec.replace(/^\n/, '');
    if (trimmed.length === 0) continue;
    const parts = trimmed.split(FIELD);
    if (parts.length < 7) continue;
    const [sha, shortSha, parents, authorName, authorEmail, authorDate, subject] = parts as [
      string,
      string,
      string,
      string,
      string,
      string,
      string,
    ];
    commits.push({
      sha,
      shortSha,
      parents: parents.split(' ').filter((x) => x.length > 0),
      authorName,
      authorEmail,
      authorDate,
      subject,
    });
  }
  return commits;
}
