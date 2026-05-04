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

export interface McpServerSpec {
  readonly command: string;
  readonly args: readonly string[];
  readonly env?: Readonly<Record<string, string>>;
}

/**
 * Default registry — known MCP servers shipped in this repo. An
 * operator can extend by passing additional entries to
 * createMcpToolHost({ servers }).
 *
 * Exported for tests so the env-gated branches (aldo-shell, aldo-git)
 * can be asserted without spawning real MCP children.
 */
export function defaultServers(): Record<string, McpServerSpec> {
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
  // for safety; an operator that wants the agent to be able to modify
  // files opts in via `ALDO_FS_RW_ROOT` (absolute path to grant `:rw`
  // on; falls inside or replaces the repo root). The protected-paths
  // denylist on the ACL is the second line of defence — see
  // mcp-servers/aldo-fs/src/acl.ts:DEFAULT_PROTECTED_PATHS.
  // MISSING_PIECES.md #2.
  const rwRoot = process.env.ALDO_FS_RW_ROOT?.trim();
  const rootsSpec =
    rwRoot && rwRoot.length > 0 ? `${repoRoot}:ro,${rwRoot}:rw` : `${repoRoot}:ro`;
  const args = [tsxBin, aldoFsEntry, '--roots', rootsSpec];
  const protectedPaths = process.env.ALDO_FS_PROTECTED_PATHS?.trim();
  if (protectedPaths !== undefined && protectedPaths.length > 0) {
    args.push('--protected-paths', protectedPaths);
  }
  const servers: Record<string, McpServerSpec> = {
    'aldo-fs': {
      command: 'node',
      args,
    },
  };

  // MISSING_PIECES.md #3 — opt-in shell-exec MCP. Default OFF: an agent
  // running on a sensitive tenant should never get shell access without
  // explicit operator action. Required env: ALDO_SHELL_ENABLED=true and
  // ALDO_SHELL_ROOT=<absolute path>. Optional env: ALDO_SHELL_ALLOW,
  // ALDO_SHELL_DENY, ALDO_SHELL_DEFAULT_CWD, ALDO_SHELL_TIMEOUT_MS,
  // ALDO_SHELL_MAX_TIMEOUT_MS — passed through verbatim to aldo-shell.
  const shellEnabled = (process.env.ALDO_SHELL_ENABLED ?? '').toLowerCase();
  if (shellEnabled === 'true' || shellEnabled === '1' || shellEnabled === 'yes') {
    const shellRoot = (process.env.ALDO_SHELL_ROOT ?? '').trim() || repoRoot;
    const aldoShellEntry = fileURLToPath(
      new URL('../../../../mcp-servers/aldo-shell/src/index.ts', import.meta.url),
    );
    const shellArgs = [tsxBin, aldoShellEntry, '--roots', shellRoot];
    const passThroughFlag = (envName: string, flag: string): void => {
      const v = process.env[envName]?.trim();
      if (v !== undefined && v.length > 0) shellArgs.push(flag, v);
    };
    passThroughFlag('ALDO_SHELL_ALLOW', '--allow');
    passThroughFlag('ALDO_SHELL_DENY', '--deny');
    passThroughFlag('ALDO_SHELL_DEFAULT_CWD', '--default-cwd');
    passThroughFlag('ALDO_SHELL_TIMEOUT_MS', '--timeout-ms');
    passThroughFlag('ALDO_SHELL_MAX_TIMEOUT_MS', '--max-timeout-ms');
    servers['aldo-shell'] = {
      command: 'node',
      args: shellArgs,
    };
  }

  // MISSING_PIECES.md §12.2 / #6 — opt-in scope-aware memory store.
  // Default OFF; required env: ALDO_MEMORY_ENABLED=true and
  // ALDO_MEMORY_ROOT=<absolute path>. The agency YAMLs use scopes
  // `private` (per-agent), `project` / `org` (tenant-shared), and
  // `session` (per-run); the MCP server expects `tenant` (and
  // sometimes `agentName` / `runId`) on every call. The dry-run
  // brief sets ALDO_MEMORY_TENANTS=<csv> as the allowlist.
  const memoryEnabled = (process.env.ALDO_MEMORY_ENABLED ?? '').toLowerCase();
  if (memoryEnabled === 'true' || memoryEnabled === '1' || memoryEnabled === 'yes') {
    const memoryRoot = (process.env.ALDO_MEMORY_ROOT ?? '').trim();
    const memoryTenants = (process.env.ALDO_MEMORY_TENANTS ?? '').trim();
    if (memoryRoot.length === 0 || memoryTenants.length === 0) {
      console.error(
        '[mcp] aldo-memory: ALDO_MEMORY_ENABLED=true but ALDO_MEMORY_ROOT or ALDO_MEMORY_TENANTS is empty — server NOT registered',
      );
    } else {
      const aldoMemoryEntry = fileURLToPath(
        new URL('../../../../mcp-servers/aldo-memory/src/index.ts', import.meta.url),
      );
      const memoryArgs = [
        tsxBin,
        aldoMemoryEntry,
        '--root',
        memoryRoot,
        '--tenants',
        memoryTenants,
      ];
      const passThroughMemory = (envName: string, flag: string): void => {
        const v = process.env[envName]?.trim();
        if (v !== undefined && v.length > 0) memoryArgs.push(flag, v);
      };
      passThroughMemory('ALDO_MEMORY_FIXED_AGENT', '--fixed-agent');
      passThroughMemory('ALDO_MEMORY_FIXED_RUN', '--fixed-run');
      passThroughMemory('ALDO_MEMORY_MAX_KEY_BYTES', '--max-key-bytes');
      passThroughMemory('ALDO_MEMORY_MAX_VALUE_BYTES', '--max-value-bytes');
      servers['aldo-memory'] = {
        command: 'node',
        args: memoryArgs,
      };
    }
  }

  // MISSING_PIECES.md §12.3 / §13 — opt-in git + gh MCP. Default OFF for
  // the same reason as aldo-shell: an agent on a sensitive tenant should
  // never get write access to a working tree without explicit operator
  // action. Required env: ALDO_GIT_ENABLED=true and ALDO_GIT_ROOT=<abs>.
  // Optional env passed through verbatim: ALDO_GIT_PROTECTED_BRANCHES,
  // ALDO_GIT_ALLOWED_REMOTES, ALDO_GIT_DEFAULT_CWD, ALDO_GIT_BIN,
  // ALDO_GH_BIN, ALDO_GIT_TIMEOUT_MS, ALDO_GIT_MAX_TIMEOUT_MS.
  const gitEnabled = (process.env.ALDO_GIT_ENABLED ?? '').toLowerCase();
  if (gitEnabled === 'true' || gitEnabled === '1' || gitEnabled === 'yes') {
    const gitRoot = (process.env.ALDO_GIT_ROOT ?? '').trim() || repoRoot;
    const aldoGitEntry = fileURLToPath(
      new URL('../../../../mcp-servers/aldo-git/src/index.ts', import.meta.url),
    );
    const gitArgs = [tsxBin, aldoGitEntry, '--roots', gitRoot];
    const passThroughGit = (envName: string, flag: string): void => {
      const v = process.env[envName]?.trim();
      if (v !== undefined && v.length > 0) gitArgs.push(flag, v);
    };
    passThroughGit('ALDO_GIT_PROTECTED_BRANCHES', '--protected-branches');
    passThroughGit('ALDO_GIT_ALLOWED_REMOTES', '--allowed-remotes');
    passThroughGit('ALDO_GIT_DEFAULT_CWD', '--default-cwd');
    passThroughGit('ALDO_GIT_BIN', '--git-bin');
    passThroughGit('ALDO_GH_BIN', '--gh-bin');
    passThroughGit('ALDO_GIT_TIMEOUT_MS', '--timeout-ms');
    passThroughGit('ALDO_GIT_MAX_TIMEOUT_MS', '--max-timeout-ms');
    passThroughGit('ALDO_GIT_OUTPUT_TAIL', '--output-tail');
    servers['aldo-git'] = {
      command: 'node',
      args: gitArgs,
    };
  }

  return servers;
}

/**
 * Virtual-server aliases — names the agency YAMLs use that resolve to
 * existing real servers without spawning a second child.
 *
 * `repo-fs` is referenced by 17 agency specs as the working-tree-scoped
 * read-write fs surface. Today it routes to the same `aldo-fs` server,
 * which already takes `:rw` scoping via `ALDO_FS_RW_ROOT`. A future
 * separate `mcp-servers/repo-fs/` package can replace the alias when
 * the working-tree slice needs different protected-paths than the full
 * repo (MISSING_PIECES.md §13 Phase G — agency-tooling alignment trio).
 *
 * `github` aliases `aldo-git` (only when the latter is enabled) so the
 * agency YAMLs' `server: github, allow: [pr.read, pr.comment, ...]`
 * resolves to the gh-CLI-backed surface in aldo-git. Tool-name
 * reconciliation between the YAMLs' `pr.read`/`issue.write` shape and
 * aldo-git's `gh.pr.view`/`gh.issue.comment` shape is intentionally
 * deferred to the driver-harness work — the §13 Phase F post-mortem
 * names that decision explicitly.
 *
 * Exported for tests so registry assembly can be asserted without
 * spawning real children.
 */
export function defaultAliases(): Record<string, string> {
  const aliases: Record<string, string> = { 'repo-fs': 'aldo-fs' };
  const gitEnabled = (process.env.ALDO_GIT_ENABLED ?? '').toLowerCase();
  if (gitEnabled === 'true' || gitEnabled === '1' || gitEnabled === 'yes') {
    aliases['github'] = 'aldo-git';
  }
  return aliases;
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
  /** Override / extend the default virtual-server aliases. */
  readonly aliases?: Record<string, string>;
}

export function createMcpToolHost(opts: CreateMcpToolHostOptions = {}): ToolHost {
  const servers: Record<string, McpServerSpec> = {
    ...defaultServers(),
    ...(opts.servers ?? {}),
  };
  const aliases: Record<string, string> = {
    ...defaultAliases(),
    ...(opts.aliases ?? {}),
  };
  // Connections are cached by canonical (real) server name so an
  // alias never spawns a second child. Aliases just route to the
  // already-spawned canonical server.
  const connections = new Map<string, Promise<ConnectedServer>>();

  function resolveCanonical(serverName: string): string {
    return aliases[serverName] ?? serverName;
  }

  async function connect(serverName: string): Promise<ConnectedServer> {
    const canonical = resolveCanonical(serverName);
    const cached = connections.get(canonical);
    if (cached) return cached;
    const spec = servers[canonical];
    if (!spec) {
      // Surface the original name (which is what the caller used) plus
      // the canonical to make alias misconfiguration obvious in logs.
      const hint = canonical === serverName ? '' : ` (alias for '${canonical}')`;
      throw new Error(`unknown MCP server '${serverName}'${hint} — not in registry`);
    }
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
    connections.set(canonical, promise);
    return promise;
  }

  return {
    async listTools(mcpServer?: string): Promise<readonly ToolDescriptor[]> {
      const known = (name: string): boolean =>
        servers[name] !== undefined || aliases[name] !== undefined;
      const targets = mcpServer
        ? known(mcpServer)
          ? [mcpServer]
          : []
        : [...Object.keys(servers), ...Object.keys(aliases)];
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
