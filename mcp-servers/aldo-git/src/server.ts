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
import {
  branchListInputSchema,
  branchListOutputSchema,
  gitBranchList,
} from './tools/branch-list.js';
import { diffInputSchema, diffOutputSchema, gitDiff } from './tools/diff.js';
import { gitLog, logInputSchema, logOutputSchema } from './tools/log.js';
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
