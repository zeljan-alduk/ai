/**
 * aldo-git — MCP server wiring.
 *
 * Mirrors the registerTool helper from aldo-shell/aldo-fs so the
 * structured-content + isError shapes the API tool host already
 * understands flow through unchanged.
 *
 * Phase A surface: read-only (status, diff, log, branch.list,
 * remote.list). Phases B–D extend this with write/remote/gh tools.
 *
 * MISSING_PIECES.md §12.3.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { GitError, type GitPolicy } from './policy.js';
import { addInputSchema, addOutputSchema, gitAdd } from './tools/add.js';
import {
  branchListInputSchema,
  branchListOutputSchema,
  gitBranchList,
} from './tools/branch-list.js';
import { checkoutInputSchema, checkoutOutputSchema, gitCheckout } from './tools/checkout.js';
import { commitInputSchema, commitOutputSchema, gitCommit } from './tools/commit.js';
import { diffInputSchema, diffOutputSchema, gitDiff } from './tools/diff.js';
import { fetchInputSchema, fetchOutputSchema, gitFetch } from './tools/fetch.js';
import { ghPrCreate, ghPrCreateInputSchema, ghPrCreateOutputSchema } from './tools/gh-pr-create.js';
import { ghPrList, ghPrListInputSchema, ghPrListOutputSchema } from './tools/gh-pr-list.js';
import { ghPrView, ghPrViewInputSchema, ghPrViewOutputSchema } from './tools/gh-pr-view.js';
import { gitLog, logInputSchema, logOutputSchema } from './tools/log.js';
import { gitPull, pullInputSchema, pullOutputSchema } from './tools/pull.js';
import { gitPush, pushInputSchema, pushOutputSchema } from './tools/push.js';
import {
  gitRemoteList,
  remoteListInputSchema,
  remoteListOutputSchema,
} from './tools/remote-list.js';
import { gitStatus, statusInputSchema, statusOutputSchema } from './tools/status.js';

export const SERVER_NAME = '@aldo-ai/mcp-git';
export const SERVER_VERSION = '0.0.0';

export interface CreateServerOpts {
  policy: GitPolicy;
  name?: string;
  version?: string;
}

export function createAldoGitServer(opts: CreateServerOpts): McpServer {
  const { policy, name = SERVER_NAME, version = SERVER_VERSION } = opts;
  const server = new McpServer({ name, version }, { capabilities: { tools: {} } });

  registerTool(server, {
    name: 'git.status',
    description:
      'Read working-tree status: current branch, ahead/behind upstream, per-file staged/unstaged state.',
    inputSchema: statusInputSchema,
    outputSchema: statusOutputSchema,
    handler: (input) => gitStatus(policy, input),
  });

  registerTool(server, {
    name: 'git.diff',
    description:
      'Diff the working tree (default), the staged index, or a revision range. Patch is tail-capped; per-file additions/deletions are always exact.',
    inputSchema: diffInputSchema,
    outputSchema: diffOutputSchema,
    handler: (input) => gitDiff(policy, input),
  });

  registerTool(server, {
    name: 'git.log',
    description: 'List recent commits with sha, parents, author, date, and subject.',
    inputSchema: logInputSchema,
    outputSchema: logOutputSchema,
    handler: (input) => gitLog(policy, input),
  });

  registerTool(server, {
    name: 'git.branch.list',
    description: 'List local branches, the current HEAD, each branch upstream, and ahead/behind counts.',
    inputSchema: branchListInputSchema,
    outputSchema: branchListOutputSchema,
    handler: (input) => gitBranchList(policy, input),
  });

  registerTool(server, {
    name: 'git.remote.list',
    description: 'List configured remotes with fetch and push URLs.',
    inputSchema: remoteListInputSchema,
    outputSchema: remoteListOutputSchema,
    handler: (input) => gitRemoteList(policy, input),
  });

  registerTool(server, {
    name: 'git.add',
    description:
      'Stage one or more working-tree paths. Refuses bare wildcards and "."; each path must exist inside the repo root.',
    inputSchema: addInputSchema,
    outputSchema: addOutputSchema,
    handler: (input) => gitAdd(policy, input),
  });

  registerTool(server, {
    name: 'git.checkout',
    description:
      'Switch HEAD to an existing branch, or create a new one with create=true. Refuses to switch onto a dirty working tree unless allowDirty=true.',
    inputSchema: checkoutInputSchema,
    outputSchema: checkoutOutputSchema,
    handler: (input) => gitCheckout(policy, input),
  });

  registerTool(server, {
    name: 'git.commit',
    description:
      'Create a commit on the current branch. Refuses commits onto protected branches and detached HEAD; --amend / --no-verify are not exposed.',
    inputSchema: commitInputSchema,
    outputSchema: commitOutputSchema,
    handler: (input) => gitCommit(policy, input),
  });

  registerTool(server, {
    name: 'git.fetch',
    description: 'Fetch refs from a configured remote. Remote must be in policy.allowedRemotes.',
    inputSchema: fetchInputSchema,
    outputSchema: fetchOutputSchema,
    handler: (input) => gitFetch(policy, input),
  });

  registerTool(server, {
    name: 'git.pull',
    description:
      'Pull from a configured remote with --ff-only. Diverged history fails explicitly rather than producing a merge commit.',
    inputSchema: pullInputSchema,
    outputSchema: pullOutputSchema,
    handler: (input) => gitPull(policy, input),
  });

  registerTool(server, {
    name: 'git.push',
    description:
      'Push the current branch (or a named one) to a configured remote. force=with-lease requires the #9 approval primitive; plain --force is not exposed.',
    inputSchema: pushInputSchema,
    outputSchema: pushOutputSchema,
    handler: (input) => gitPush(policy, input),
  });

  registerTool(server, {
    name: 'gh.pr.create',
    description:
      'Open a pull request via the GitHub CLI. Body is passed via --body-file so multi-KB descriptions are safe.',
    inputSchema: ghPrCreateInputSchema,
    outputSchema: ghPrCreateOutputSchema,
    handler: (input) => ghPrCreate(policy, input),
  });

  registerTool(server, {
    name: 'gh.pr.list',
    description: 'List pull requests filtered by state.',
    inputSchema: ghPrListInputSchema,
    outputSchema: ghPrListOutputSchema,
    handler: (input) => ghPrList(policy, input),
  });

  registerTool(server, {
    name: 'gh.pr.view',
    description: 'Read a PR\'s metadata, body, mergeable status, and reviews.',
    inputSchema: ghPrViewInputSchema,
    outputSchema: ghPrViewOutputSchema,
    handler: (input) => ghPrView(policy, input),
  });

  return server;
}

interface ToolRegistration<Schema extends z.ZodTypeAny, Out> {
  name: string;
  description: string;
  inputSchema: Schema;
  outputSchema: z.ZodType<Out>;
  handler: (input: z.output<Schema>) => Promise<Out>;
}

function registerTool<Schema extends z.ZodTypeAny, Out>(
  server: McpServer,
  reg: ToolRegistration<Schema, Out>,
): void {
  const inputJson = zodToJsonSchema(reg.inputSchema, {
    target: 'jsonSchema7',
    $refStrategy: 'none',
  }) as Record<string, unknown>;
  const outputJson = zodToJsonSchema(reg.outputSchema, {
    target: 'jsonSchema7',
    $refStrategy: 'none',
  }) as Record<string, unknown>;
  Object.defineProperty(server, `__schemas_${reg.name}`, {
    value: { input: inputJson, output: outputJson },
    enumerable: false,
  });

  const handler = async (rawInput: unknown): Promise<unknown> => {
    try {
      const parsed = reg.inputSchema.safeParse(rawInput);
      if (!parsed.success) {
        return errorResult({
          code: 'INVALID_INPUT',
          message: `invalid input for ${reg.name}: ${parsed.error.message}`,
        });
      }
      const out = await reg.handler(parsed.data as z.output<Schema>);
      return {
        structuredContent: out as Record<string, unknown>,
        content: [{ type: 'text' as const, text: JSON.stringify(out) }],
      };
    } catch (err) {
      return errorResult(toErrorPayload(err));
    }
  };

  (
    server.registerTool as unknown as (
      name: string,
      config: {
        description: string;
        inputSchema: Schema;
        outputSchema: z.ZodType<Out>;
      },
      cb: (input: unknown) => Promise<unknown>,
    ) => void
  )(
    reg.name,
    {
      description: reg.description,
      inputSchema: reg.inputSchema,
      outputSchema: reg.outputSchema,
    },
    handler,
  );
}

function errorResult(payload: { code: string; message: string }): {
  isError: true;
  content: Array<{ type: 'text'; text: string }>;
} {
  return {
    isError: true,
    content: [{ type: 'text', text: JSON.stringify({ error: payload }) }],
  };
}

function toErrorPayload(err: unknown): { code: string; message: string } {
  if (err instanceof GitError) return { code: err.code, message: err.message };
  if (err instanceof Error) return { code: 'INTERNAL', message: err.message };
  return { code: 'INTERNAL', message: String(err) };
}
