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
import { execInputSchema, execOutputSchema, shellExec } from './tools/exec.js';

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

  registerTool(server, {
    name: 'shell.exec',
    description:
      'Run an allowlisted command with a hard timeout. cwd must be inside an allowedRoots entry. Returns exit code, stdout/stderr tails, and full byte counts.',
    inputSchema: execInputSchema,
    outputSchema: execOutputSchema,
    handler: (input) => shellExec(policy, input),
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
