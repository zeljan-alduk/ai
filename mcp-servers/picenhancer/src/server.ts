/**
 * picenhancer MCP server wiring.
 *
 * Exposes one tool — `picenhancer.enhance` — that any MCP client can
 * call. Same SSE-backed pipeline the /live/picenhancer page uses;
 * Real-ESRGAN x4 + GFPGAN v1.4 face restore via PyTorch CPU.
 *
 * Successful calls return both `structuredContent` (machine-readable)
 * and `content[]` (a text fallback for clients without structured
 * output support).
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import {
  type EnhanceConfig,
  enhance,
  enhanceInputSchema,
  enhanceOutputSchema,
} from './enhance.js';

export const SERVER_NAME = '@aldo-ai/mcp-picenhancer';
export const SERVER_VERSION = '0.0.0';

export interface CreateServerOpts {
  readonly config: EnhanceConfig;
  readonly name?: string;
  readonly version?: string;
}

export function createPicenhancerServer(opts: CreateServerOpts): McpServer {
  const { config, name = SERVER_NAME, version = SERVER_VERSION } = opts;
  const server = new McpServer({ name, version }, { capabilities: { tools: {} } });

  registerTool(server, {
    name: 'picenhancer.enhance',
    description:
      'Enhance an image: GFPGAN face restoration on detected faces, ' +
      'optionally + Real-ESRGAN x4 background super-resolution, optionally ' +
      '+ further upscaling. Returns the public URL of the enhanced PNG ' +
      'plus dimensions, face count, and timing. Pure CPU — no GPU, no ' +
      'cloud, no third-party API.',
    inputSchema: enhanceInputSchema,
    outputSchema: enhanceOutputSchema,
    handler: (input) => enhance(config, input),
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
  // Pre-compute JSON schemas for tools/list — same pattern as aldo-fs.
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
      const msg = err instanceof Error ? err.message : String(err);
      return errorResult({ code: 'TOOL_ERROR', message: msg });
    }
  };

  (
    server.registerTool as unknown as (
      name: string,
      cfg: { description: string; inputSchema: Schema; outputSchema: z.ZodType<Out> },
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
    content: [{ type: 'text', text: JSON.stringify(payload) }],
  };
}
