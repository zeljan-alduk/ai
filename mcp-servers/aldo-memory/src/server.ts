/**
 * aldo-memory — MCP server wiring.
 *
 * Mirrors the registerTool helper from aldo-shell/aldo-git/aldo-fs so
 * the structured-content + isError shapes flow through the API tool
 * host unchanged.
 *
 * Tools: memory.read / memory.write / memory.scan / memory.delete.
 *
 * MISSING_PIECES.md §12.2 / #6.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { MemoryError, type MemoryPolicy } from './policy.js';
import { memoryDelete, memoryDeleteInputSchema, memoryDeleteOutputSchema } from './tools/delete.js';
import { memoryRead, memoryReadInputSchema, memoryReadOutputSchema } from './tools/read.js';
import { memoryScan, memoryScanInputSchema, memoryScanOutputSchema } from './tools/scan.js';
import { memoryWrite, memoryWriteInputSchema, memoryWriteOutputSchema } from './tools/write.js';

export const SERVER_NAME = '@aldo-ai/mcp-memory';
export const SERVER_VERSION = '0.0.0';

export interface CreateServerOpts {
  policy: MemoryPolicy;
  name?: string;
  version?: string;
}

export function createAldoMemoryServer(opts: CreateServerOpts): McpServer {
  const { policy, name = SERVER_NAME, version = SERVER_VERSION } = opts;
  const server = new McpServer({ name, version }, { capabilities: { tools: {} } });

  registerTool(server, {
    name: 'memory.read',
    description:
      'Fetch a single memory entry by (tenant, scope, key). `private` requires `agentName`; `session` requires `runId`. Returns null when missing.',
    inputSchema: memoryReadInputSchema,
    outputSchema: memoryReadOutputSchema,
    handler: (input) => memoryRead(policy, input),
  });

  registerTool(server, {
    name: 'memory.write',
    description:
      'Upsert a memory entry. `retention` is an ISO 8601 duration (e.g. "P30D"). TTL is recorded but not actively swept in v0.',
    inputSchema: memoryWriteInputSchema,
    outputSchema: memoryWriteOutputSchema,
    handler: (input) => memoryWrite(policy, input),
  });

  registerTool(server, {
    name: 'memory.scan',
    description:
      'List entries under (tenant, scope) whose key starts with `prefix`. Newest-first; bounded by `limit` (max 500).',
    inputSchema: memoryScanInputSchema,
    outputSchema: memoryScanOutputSchema,
    handler: (input) => memoryScan(policy, input),
  });

  registerTool(server, {
    name: 'memory.delete',
    description:
      'Remove a single entry. Returns deleted=false (and ok=true) when the key was already absent.',
    inputSchema: memoryDeleteInputSchema,
    outputSchema: memoryDeleteOutputSchema,
    handler: (input) => memoryDelete(policy, input),
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
  if (err instanceof MemoryError) return { code: err.code, message: err.message };
  if (err instanceof Error) return { code: 'INTERNAL', message: err.message };
  return { code: 'INTERNAL', message: String(err) };
}
