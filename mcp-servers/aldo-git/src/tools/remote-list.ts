/**
 * git.remote.list — configured remotes with fetch + push URLs.
 */

import { z } from 'zod';
import { type GitPolicy, resolveRepoCwd } from '../policy.js';
import { runGit } from './run.js';

export const remoteListInputSchema = z.object({ cwd: z.string().optional() }).strict();
export type RemoteListInput = z.infer<typeof remoteListInputSchema>;

const remoteSchema = z.object({
  name: z.string(),
  fetchUrl: z.string(),
  pushUrl: z.string(),
});

export const remoteListOutputSchema = z
  .object({
    cwd: z.string(),
    remotes: z.array(remoteSchema),
  })
  .strict();

export type RemoteListOutput = z.infer<typeof remoteListOutputSchema>;

export async function gitRemoteList(
  policy: GitPolicy,
  input: RemoteListInput,
): Promise<RemoteListOutput> {
  const cwd = resolveRepoCwd(policy, input.cwd);
  const result = await runGit(policy, cwd, ['remote', '-v']);
  const map = new Map<string, { fetchUrl?: string; pushUrl?: string }>();
  for (const line of result.stdout.split('\n')) {
    if (line.length === 0) continue;
    // "<name>\t<url> (fetch|push)"
    const m = line.match(/^(\S+)\s+(\S+)\s+\((fetch|push)\)$/);
    if (!m) continue;
    const name = m[1]!;
    const url = m[2]!;
    const kind = m[3]!;
    const cur = map.get(name) ?? {};
    if (kind === 'fetch') cur.fetchUrl = url;
    else cur.pushUrl = url;
    map.set(name, cur);
  }
  const remotes: z.infer<typeof remoteSchema>[] = [];
  for (const [name, urls] of map) {
    remotes.push({
      name,
      fetchUrl: urls.fetchUrl ?? urls.pushUrl ?? '',
      pushUrl: urls.pushUrl ?? urls.fetchUrl ?? '',
    });
  }
  remotes.sort((a, b) => a.name.localeCompare(b.name));
  return { cwd, remotes };
}
