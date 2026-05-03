/**
 * apps/api/src/mcp/tool-host.ts
 *
 * MCP-backed ToolHost that the runtime hands to LeafAgentRun.
 *
 * For each declared MCP server (today: aldo-fs is the only one wired),
 * spawn the server's stdio binary on first use, connect a Client, and
 * cache the connection for subsequent listTools / invoke calls. Same
 * MCP transport / protocol any other client uses, so a future
 * remote-MCP server is a drop-in (swap StdioClientTransport for the
 * SSE/HTTP one — wave-3 already shipped that on the SERVER side).
 *
 * Lifecycle:
 *   - Connections are lazy. The first invoke for a given server
 *     triggers spawn + handshake. Subsequent invokes reuse it.
 *   - We never disconnect mid-process. Node ends the child when the
 *     API exits (parent stdin closes -> child sees EOF -> exits).
 *
 * Permissions:
 *   - The agent spec's `tools.permissions` + the `allow:` list per
 *     server are enforced in LeafAgentRun BEFORE invoke is called.
 *     The toolHost itself doesn't re-check; trusting the engine is
 *     the same contract every other ToolHost in the codebase has.
 *
 * What's not in v0:
 *   - Multi-tenant isolation. One spawned aldo-fs per API process,
 *     not per-tenant. ACL roots default to the repo root for now.
 *   - Hosted (HTTP/SSE) MCP servers. Stdio only.
 *   - Reconnect on transport death. If the child dies, all subsequent
 *     calls error until the API restarts.
 *   - Rate limiting / per-tool budgets. Trust the engine + agent spec.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type {
  CallContext,
  ToolDescriptor,
  ToolHost,
  ToolRef,
  ToolResult,
} from '@aldo-ai/types';

interface McpServerSpec {
  readonly command: string;
  readonly args: readonly string[];
  readonly env?: Readonly<Record<string, string>>;
}

/**
 * Default registry — known MCP servers shipped in this repo. An
 * operator can extend by passing additional entries to
 * createMcpToolHost({ servers }).
 */
function defaultServers(): Record<string, McpServerSpec> {
  // Resolve the in-repo aldo-fs entry. This file is at
  // apps/api/src/mcp/tool-host.ts; the entry is at
  // mcp-servers/aldo-fs/src/index.ts (5 levels up).
  const aldoFsEntry = fileURLToPath(
    new URL('../../../../mcp-servers/aldo-fs/src/index.ts', import.meta.url),
  );
  // Reuse the tsx loader the API itself runs under so we don't need a
  // pre-built dist/. Production deployments swap this for a node + dist
  // path via the env override below.
  const tsxBin = fileURLToPath(
    new URL('../../../../node_modules/.pnpm/tsx@4.21.0/node_modules/tsx/dist/cli.mjs', import.meta.url),
  );
  // Resolve repo root from this file (not process.cwd, which is the
  // API's working dir = apps/api when run via `pnpm --filter dev`).
  const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));
  // aldo-fs expects each root as `<path>:<ro|rw>`. Default to read-only
  // for safety; agents that need to write would override this entry.
  return {
    'aldo-fs': {
      command: 'node',
      args: [tsxBin, aldoFsEntry, '--roots', `${repoRoot}:ro`],
    },
  };
}

interface ConnectedServer {
  readonly client: McpClientLike;
  readonly proc: ChildProcess;
}

interface McpClientLike {
  listTools(): Promise<{
    tools: Array<{
      name: string;
      description?: string;
      inputSchema?: unknown;
    }>;
  }>;
  callTool(params: { name: string; arguments?: Record<string, unknown> }): Promise<{
    content?: Array<{ type: string; text?: string; data?: unknown }>;
    isError?: boolean;
    structuredContent?: unknown;
  }>;
  close?(): Promise<void>;
}

export interface CreateMcpToolHostOptions {
  /** Override / extend the default server registry. */
  readonly servers?: Record<string, McpServerSpec>;
}

export function createMcpToolHost(opts: CreateMcpToolHostOptions = {}): ToolHost {
  const servers: Record<string, McpServerSpec> = {
    ...defaultServers(),
    ...(opts.servers ?? {}),
  };
  const connections = new Map<string, Promise<ConnectedServer>>();

  async function connect(serverName: string): Promise<ConnectedServer> {
    const cached = connections.get(serverName);
    if (cached) return cached;
    const spec = servers[serverName];
    if (!spec) throw new Error(`unknown MCP server '${serverName}' — not in registry`);
    const promise = (async () => {
      // Lazy SDK import keeps the rest of the API independent of MCP.
      const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
      const { StdioClientTransport } = await import(
        '@modelcontextprotocol/sdk/client/stdio.js'
      );
      const proc = spawn(spec.command, [...spec.args], {
        env: { ...process.env, ...(spec.env ?? {}) },
        stdio: ['pipe', 'pipe', 'inherit'],
      });
      // Forward fatal errors so a wedged child surfaces in the API log.
      proc.on('exit', (code, sig) => {
        if (code !== 0 && code !== null) {
          console.error(`[mcp] server '${serverName}' exited code=${code} sig=${sig}`);
        }
      });
      const transport = new StdioClientTransport({
        command: spec.command,
        args: [...spec.args],
        env: { ...process.env, ...(spec.env ?? {}) } as Record<string, string>,
      });
      const client = new Client({ name: 'aldo-api-bridge', version: '0.0.0' });
      await client.connect(transport);
      return { client: client as unknown as McpClientLike, proc };
    })();
    connections.set(serverName, promise);
    return promise;
  }

  return {
    async listTools(mcpServer?: string): Promise<readonly ToolDescriptor[]> {
      const targets = mcpServer
        ? servers[mcpServer]
          ? [mcpServer]
          : []
        : Object.keys(servers);
      const out: ToolDescriptor[] = [];
      for (const name of targets) {
        try {
          const { client } = await connect(name);
          const res = await client.listTools();
          for (const t of res.tools ?? []) {
            out.push({
              name: t.name,
              description: t.description ?? '',
              inputSchema: t.inputSchema ?? { type: 'object' },
              source: 'mcp',
              mcpServer: name,
            });
          }
        } catch (err) {
          console.error(`[mcp] listTools(${name}) failed`, err);
        }
      }
      return out;
    },

    async invoke(tool: ToolRef, args: unknown, _ctx: CallContext): Promise<ToolResult> {
      if (tool.source !== 'mcp' || !tool.mcpServer) {
        return {
          ok: false,
          value: null,
          error: { code: 'unsupported_tool_source', message: `not an MCP tool: ${tool.name}` },
        };
      }
      try {
        const { client } = await connect(tool.mcpServer);
        const res = await client.callTool({
          name: tool.name,
          arguments: (args as Record<string, unknown>) ?? {},
        });
        if (res.isError) {
          const text = (res.content ?? [])
            .map((p) => (p.type === 'text' && typeof p.text === 'string' ? p.text : ''))
            .filter((s) => s.length > 0)
            .join('\n');
          return {
            ok: false,
            value: null,
            error: { code: 'tool_error', message: text || 'tool returned isError=true' },
          };
        }
        // Prefer structuredContent when present; fall back to text concat.
        const value =
          res.structuredContent ??
          (res.content ?? [])
            .map((p) => (p.type === 'text' ? p.text : p.data))
            .filter((v) => v !== undefined);
        return { ok: true, value };
      } catch (err) {
        return {
          ok: false,
          value: null,
          error: {
            code: 'mcp_invoke_failed',
            message: err instanceof Error ? err.message : String(err),
          },
        };
      }
    },
  };
}
