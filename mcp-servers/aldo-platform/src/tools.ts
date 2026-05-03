/**
 * aldo-platform — tool registration.
 *
 * The 8-tool surface lives here so both transports (stdio + HTTP) wire
 * up an identical server. The stdio entry point and the HTTP entry
 * point each construct their own `McpServer` and call
 * `registerAldoPlatformTools(server, { client })`.
 *
 * Why a separate module
 * ---------------------
 * - Single source of truth for the tool surface — adding/changing a
 *   tool means editing one file, not two.
 * - The HTTP transport instantiates a fresh server *per request* so it
 *   can bind a request-scoped REST client (Bearer token from the
 *   caller's `Authorization` header). That'd be impossible if the
 *   tool registration was tangled with transport setup.
 * - Tests can register tools against an `InMemoryTransport`-backed
 *   server without touching either transport file.
 *
 * Errors thrown by handlers are caught here and returned as structured
 * MCP tool errors (`isError: true`, with a `{code,message}` body).
 *
 * LLM-agnostic — no provider names anywhere in this surface.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { type RestClient, RestError } from './client.js';

export const SERVER_NAME = '@aldo-ai/mcp-platform';
export const SERVER_VERSION = '0.0.0';

export interface RegisterToolsOpts {
  readonly client: RestClient;
}

/**
 * Register the 8-tool ALDO platform surface on a server. Identical for
 * stdio and HTTP transports.
 */
export function registerAldoPlatformTools(server: McpServer, opts: RegisterToolsOpts): void {
  const { client } = opts;

  // ──────────────────────────────────────── Agents

  registerTool(server, {
    name: 'aldo.list_agents',
    description: 'List agents available in the caller tenant. Returns name + version + tags.',
    input: z.object({}).strict(),
    handler: async () => {
      const res = await client.request<{ agents: ReadonlyArray<unknown> }>('/v1/agents');
      return { agents: res.agents };
    },
  });

  registerTool(server, {
    name: 'aldo.get_agent',
    description: 'Fetch a single agent spec by name (full YAML-equivalent JSON).',
    input: z
      .object({
        name: z.string().min(1).describe('Agent name (e.g. "code-reviewer").'),
      })
      .strict(),
    handler: async ({ name }) => await client.request(`/v1/agents/${encodeURIComponent(name)}`),
  });

  // ──────────────────────────────────────── Runs

  registerTool(server, {
    name: 'aldo.list_runs',
    description:
      'List runs with optional filters. Newest first. Use `cursor` to paginate; pass it back from the previous response.',
    input: z
      .object({
        agentName: z.string().optional().describe('Filter to one agent.'),
        status: z
          .enum(['running', 'completed', 'cancelled', 'errored'])
          .optional()
          .describe('Filter by terminal/in-flight status.'),
        cursor: z.string().optional(),
        limit: z.number().int().min(1).max(100).optional(),
      })
      .strict(),
    handler: async (args) =>
      await client.request('/v1/runs', { query: args as Record<string, string | number> }),
  });

  registerTool(server, {
    name: 'aldo.get_run',
    description:
      'Fetch a run by id, including full event timeline + per-call usage rows. Long traces can be paginated by re-calling with `?cursor=` if the response indicates truncation.',
    input: z.object({ id: z.string().min(1) }).strict(),
    handler: async ({ id }) => await client.request(`/v1/runs/${encodeURIComponent(id)}`),
  });

  registerTool(server, {
    name: 'aldo.run_agent',
    description:
      'Start a new run for an agent. Returns the new run id immediately; the run continues asynchronously. Use `aldo.get_run` to poll for status.',
    input: z
      .object({
        agentName: z.string().min(1),
        agentVersion: z
          .string()
          .optional()
          .describe('Pin a version; defaults to the promoted one.'),
        inputs: z.unknown().optional().describe('Free-form input payload passed to the agent.'),
      })
      .strict(),
    handler: async (args) => {
      const body: Record<string, unknown> = { agentName: args.agentName };
      if (args.agentVersion !== undefined) body.agentVersion = args.agentVersion;
      if (args.inputs !== undefined) body.inputs = args.inputs;
      return await client.request('/v1/runs', { method: 'POST', body });
    },
  });

  registerTool(server, {
    name: 'aldo.compare_runs',
    description:
      'Compute a side-by-side diff between two runs: event-by-event, final output, cost breakdown. Use this to evaluate replay-against-another-model after a swap-model fork.',
    input: z
      .object({
        a: z.string().min(1).describe('First run id.'),
        b: z.string().min(1).describe('Second run id.'),
      })
      .strict(),
    handler: async ({ a, b }) => await client.request('/v1/runs/compare', { query: { a, b } }),
  });

  // ──────────────────────────────────────── Datasets

  registerTool(server, {
    name: 'aldo.list_datasets',
    description: 'List datasets in the caller tenant.',
    input: z
      .object({
        q: z.string().optional().describe('Free-text search on name/description.'),
        tag: z.string().optional(),
      })
      .strict(),
    handler: async (args) =>
      await client.request('/v1/datasets', { query: args as Record<string, string> }),
  });

  registerTool(server, {
    name: 'aldo.save_run_as_eval_row',
    description:
      'Capture a finished run as a labelled example in a dataset. Mirrors the "Save as eval row" UI button: takes a free-form input + expected output, stamps provenance metadata (runId, agent, model), writes to /v1/datasets/:id/examples.',
    input: z
      .object({
        datasetId: z.string().min(1),
        runId: z.string().min(1).describe('Source run — used for provenance metadata.'),
        input: z.unknown().describe('What you want to ask the agent (free-form).'),
        expected: z.unknown().optional().describe('Reference output; optional.'),
        label: z.string().optional().describe('Optional tag — e.g. good, bad, edge-case.'),
        split: z.enum(['eval', 'train', 'holdout']).optional(),
      })
      .strict(),
    handler: async ({ datasetId, runId, input, expected, label, split }) => {
      const body: Record<string, unknown> = {
        input,
        metadata: { runId, capturedVia: '@aldo-ai/mcp-platform' },
      };
      if (expected !== undefined) body.expected = expected;
      if (label !== undefined) body.label = label;
      if (split !== undefined) body.split = split;
      return await client.request(`/v1/datasets/${encodeURIComponent(datasetId)}/examples`, {
        method: 'POST',
        body,
      });
    },
  });
}

// ──────────────────────────────────────── tool registration helper

interface ToolDef<I extends z.AnyZodObject> {
  readonly name: string;
  readonly description: string;
  readonly input: I;
  readonly handler: (args: z.infer<I>) => Promise<unknown>;
}

/**
 * Register one tool. Wraps the handler so:
 *   - input is parsed through the Zod schema (bad input → MCP tool error)
 *   - REST errors come back as structured `{ code, message, status }`
 *   - any other thrown error becomes a generic `internal_error` rather
 *     than crashing the MCP transport.
 *
 * The SDK's `registerTool` (1.29+) wants the raw shape (`Record<string,
 * ZodTypeAny>`) on `inputSchema`, not a pre-converted JSON Schema dict
 * — it derives the JSON Schema itself when surfacing the tool to the
 * client. We hand it `def.input.shape` and keep the full ZodObject
 * around for our own runtime validation.
 */
function registerTool<I extends z.AnyZodObject>(server: McpServer, def: ToolDef<I>): void {
  server.registerTool(
    def.name,
    {
      description: def.description,
      inputSchema: def.input.shape as z.ZodRawShape,
    },
    async (rawArgs: unknown) => {
      const parsed = def.input.safeParse(rawArgs);
      if (!parsed.success) {
        return toolError('invalid_arguments', parsed.error.message);
      }
      try {
        const result = await def.handler(parsed.data as z.infer<I>);
        return toolOk(result);
      } catch (err) {
        if (err instanceof RestError) {
          return toolError(err.code, err.message, { status: err.status });
        }
        return toolError('internal_error', err instanceof Error ? err.message : String(err));
      }
    },
  );
}

interface McpToolResult {
  // SDK 1.29's CallToolResult shape requires an index signature so
  // callers can attach forward-compatible extension fields.
  [x: string]: unknown;
  content: Array<{ type: 'text'; text: string }>;
  // The SDK requires `structuredContent` to be a JSON object (or
  // omitted). Tool handlers occasionally produce non-object payloads
  // (e.g. an upstream returns a top-level array); we wrap those in
  // `{ value: <payload> }` to keep the type contract.
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

function toolOk(structured: unknown): McpToolResult {
  const wrapped = isPlainObject(structured)
    ? (structured as Record<string, unknown>)
    : { value: structured };
  return {
    content: [{ type: 'text', text: JSON.stringify(structured, null, 2) }],
    structuredContent: wrapped,
  };
}

function toolError(
  code: string,
  message: string,
  extra: Record<string, unknown> = {},
): McpToolResult {
  const body = { code, message, ...extra };
  return {
    content: [{ type: 'text', text: JSON.stringify(body, null, 2) }],
    structuredContent: body,
    isError: true,
  };
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
