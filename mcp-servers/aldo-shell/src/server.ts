/**
 * aldo-shell — MCP server wiring.
 *
 * Mirrors the registerTool helper from aldo-fs/src/server.ts so the
 * structured-content + isError shapes the API tool host already
 * understands flow through unchanged. Exposes a single tool today
 * (`shell.exec`); a future `shell.which` is plausible but YAGNI.
 *
 * MISSING_PIECES.md #3.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { type ExecPolicy, ShellError } from './policy.js';
import { createShellSessionState } from './session.js';
import { execInputSchema, execOutputSchema, shellExec } from './tools/exec.js';
import {
  cdInputSchema,
  cdOutputSchema,
  envInputSchema,
  envOutputSchema,
  exportInputSchema,
  exportOutputSchema,
  pwdInputSchema,
  pwdOutputSchema,
  shellCd,
  shellEnv,
  shellExport,
  shellPwd,
  shellUnset,
  unsetInputSchema,
  unsetOutputSchema,
} from './tools/session-tools.js';

export const SERVER_NAME = '@aldo-ai/mcp-shell';
export const SERVER_VERSION = '0.0.0';

export interface CreateServerOpts {
  policy: ExecPolicy;
  name?: string;
  version?: string;
}

export function createAldoShellServer(opts: CreateServerOpts): McpServer {
  const { policy, name = SERVER_NAME, version = SERVER_VERSION } = opts;
  const server = new McpServer({ name, version }, { capabilities: { tools: {} } });

  // Per-process session state. The MCP server's process lifetime is
  // the session, so a single shared map suffices (no keying, no
  // cleanup, no parallel-session race).
  const session = createShellSessionState();

  registerTool(server, {
    name: 'shell.exec',
    description:
      'Run an allowlisted command with a hard timeout. cwd defaults to the session cwd (set via shell.cd) when unset; otherwise must be inside an allowedRoots entry. Session env vars (set via shell.export) merge onto the host env.',
    inputSchema: execInputSchema,
    outputSchema: execOutputSchema,
    handler: (input) => shellExec(policy, input, session),
  });

  registerTool(server, {
    name: 'shell.cd',
    description:
      'Change the session cwd. Subsequent shell.exec calls without an explicit `cwd` arg inherit this directory. Relative paths resolve against the current cwd; absolute paths are used as-is. The exec-time allowedRoots check still fires — `cd` to a path outside roots is allowed but exec there will refuse.',
    inputSchema: cdInputSchema,
    outputSchema: cdOutputSchema,
    handler: (input) => shellCd(session, input),
  });

  registerTool(server, {
    name: 'shell.pwd',
    description:
      'Read the session cwd. Returns null when no `shell.cd` has been called yet (caller is expected to pin `cwd` on each `shell.exec` in that case).',
    inputSchema: pwdInputSchema,
    outputSchema: pwdOutputSchema,
    handler: (input) => shellPwd(session, input),
  });

  registerTool(server, {
    name: 'shell.export',
    description:
      'Merge a map of env vars onto the session env. Subsequent shell.exec calls inherit them (unless the call provides its own `env` override, which wins). Returns the post-merge key list.',
    inputSchema: exportInputSchema,
    outputSchema: exportOutputSchema,
    handler: (input) => shellExport(session, input),
  });

  registerTool(server, {
    name: 'shell.unset',
    description: 'Remove session env vars by name. Returns the remaining key list.',
    inputSchema: unsetInputSchema,
    outputSchema: unsetOutputSchema,
    handler: (input) => shellUnset(session, input),
  });

  registerTool(server, {
    name: 'shell.env',
    description:
      'Return the session env (the vars set via shell.export — NOT the full host process.env).',
    inputSchema: envInputSchema,
    outputSchema: envOutputSchema,
    handler: (input) => shellEnv(session, input),
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
  if (err instanceof ShellError) return { code: err.code, message: err.message };
  if (err instanceof Error) return { code: 'INTERNAL', message: err.message };
  return { code: 'INTERNAL', message: String(err) };
}
