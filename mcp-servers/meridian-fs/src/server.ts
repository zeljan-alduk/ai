/**
 * meridian-fs — MCP server wiring.
 *
 * Registers the five v0 tools (read / write / list / stat / search) on
 * an McpServer instance. The server is transport-agnostic here; index.ts
 * bolts a stdio transport on. Tests use an in-memory transport instead.
 *
 * Errors thrown by tool handlers are caught here and returned as
 * structured MCP tool errors (`isError: true`, with a `{code,message}`
 * JSON body in the text content). Successful calls return both
 * `structuredContent` (machine-readable) and `content[]` (a text
 * fallback for clients that haven't adopted structured output).
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import type { Acl } from './acl.js';
import { FsError } from './acl.js';
import { fsList, listInputSchema, listOutputSchema } from './tools/list.js';
import { fsRead, readInputSchema, readOutputSchema } from './tools/read.js';
import { fsSearch, searchInputSchema, searchOutputSchema } from './tools/search.js';
import { fsStatTool, statInputSchema, statOutputSchema } from './tools/stat.js';
import { fsWrite, writeInputSchema, writeOutputSchema } from './tools/write.js';

export const SERVER_NAME = '@meridian/mcp-fs';
export const SERVER_VERSION = '0.0.0';

export interface CreateServerOpts {
  acl: Acl;
  /** Override server name (used in some test fixtures). */
  name?: string;
  version?: string;
}

/**
 * Build (but do not start) an MCP server bound to the given ACL.
 * The caller attaches a transport via `server.connect(transport)`.
 *
 * TODO(v1): fs.delete, fs.move — both intentionally absent in v0.
 */
export function createMeridianFsServer(opts: CreateServerOpts): McpServer {
  const { acl, name = SERVER_NAME, version = SERVER_VERSION } = opts;
  const server = new McpServer({ name, version }, { capabilities: { tools: {} } });

  registerTool(server, {
    name: 'fs.read',
    description: 'Read the contents of a single file under an allowed root.',
    inputSchema: readInputSchema,
    outputSchema: readOutputSchema,
    handler: (input) => fsRead(acl, input),
  });

  registerTool(server, {
    name: 'fs.write',
    description: 'Create or overwrite a file under an allowed read-write root.',
    inputSchema: writeInputSchema,
    outputSchema: writeOutputSchema,
    handler: (input) => fsWrite(acl, input),
  });

  registerTool(server, {
    name: 'fs.list',
    description: 'List entries directly under a directory in an allowed root.',
    inputSchema: listInputSchema,
    outputSchema: listOutputSchema,
    handler: (input) => fsList(acl, input),
  });

  registerTool(server, {
    name: 'fs.stat',
    description: 'Return metadata for a path under an allowed root.',
    inputSchema: statInputSchema,
    outputSchema: statOutputSchema,
    handler: (input) => fsStatTool(acl, input),
  });

  registerTool(server, {
    name: 'fs.search',
    description: 'Case-insensitive substring search across files within an allowed root.',
    inputSchema: searchInputSchema,
    outputSchema: searchOutputSchema,
    handler: (input) => fsSearch(acl, input),
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
  // We pass the Zod schema to the SDK so it can advertise the right JSON
  // schema in tools/list, but we also defensively re-validate inside the
  // handler — the SDK's parsing is keyed off zod versions and we don't
  // want behaviour to drift.
  const inputJson = zodToJsonSchema(reg.inputSchema, {
    target: 'jsonSchema7',
    $refStrategy: 'none',
  }) as Record<string, unknown>;
  const outputJson = zodToJsonSchema(reg.outputSchema, {
    target: 'jsonSchema7',
    $refStrategy: 'none',
  }) as Record<string, unknown>;

  // Stash schemas on the McpServer for tests / debugging.
  Object.defineProperty(server, `__schemas_${reg.name}`, {
    value: { input: inputJson, output: outputJson },
    enumerable: false,
  });

  // The SDK's typed `registerTool` overloads couple the callback args to
  // the schema in a way that fights `exactOptionalPropertyTypes` (defaults
  // produce optional inputs but required outputs). We funnel through an
  // unknown-typed handler and parse ourselves.
  const handler = async (rawInput: unknown): Promise<unknown> => {
    try {
      const parsed = reg.inputSchema.safeParse(rawInput);
      if (!parsed.success) {
        return errorResult({
          code: 'INTERNAL',
          message: `invalid input for ${reg.name}: ${parsed.error.message}`,
        });
      }
      const out = await reg.handler(parsed.data as z.output<Schema>);
      return {
        structuredContent: out as Record<string, unknown>,
        content: [{ type: 'text' as const, text: JSON.stringify(out) }],
      };
    } catch (err) {
      return errorResult(toFsErrorPayload(err));
    }
  };

  // Cast through `unknown` to silence the SDK's tight generic coupling.
  // The runtime contract is preserved by our own safeParse above.
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
  // We do NOT attach `structuredContent` here: MCP clients validate the
  // structured output against the tool's outputSchema, and an error
  // payload (`{ error: { code, message } }`) intentionally doesn't match
  // the success schema. The text content carries the JSON for clients
  // that want to parse it.
  return {
    isError: true,
    content: [{ type: 'text', text: JSON.stringify({ error: payload }) }],
  };
}

function toFsErrorPayload(err: unknown): { code: string; message: string } {
  if (err instanceof FsError) return { code: err.code, message: err.message };
  if (err instanceof Error) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return { code: 'NOT_FOUND', message: err.message };
    if (code === 'EACCES' || code === 'EPERM')
      return { code: 'PERMISSION_DENIED', message: err.message };
    return { code: 'INTERNAL', message: err.message };
  }
  return { code: 'INTERNAL', message: String(err) };
}
