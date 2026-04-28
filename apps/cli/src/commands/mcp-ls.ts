/**
 * `aldo mcp ls` — list known MCP servers shipped by ALDO AI.
 *
 * v0 surface: print the two first-party servers we ship under
 * `mcp-servers/` plus a one-line description of each. Output formats:
 *
 *   - default (TTY): aligned columns
 *   - --json:        a JSON array — `[{ name, package, transport,
 *                     description, configSnippet }]`
 *
 * Future expansion (TODO once MCP registry lands): also enumerate
 * customer-installed servers from the tenant's `tenant_mcp_servers`
 * table. For now this is a static manifest of what the CLI binary
 * itself knows about — useful as the launchpoint for the docs guide
 * + as a sanity check that a user installed the right packages.
 *
 * LLM-agnostic: nothing in this file references a model provider.
 */

import { type CliIO, writeErr, writeJson, writeLine } from '../io.js';

interface KnownMcpServer {
  readonly name: string;
  readonly pkg: string;
  readonly transport: 'stdio' | 'sse';
  readonly description: string;
  readonly docsHref: string;
}

const KNOWN_SERVERS: ReadonlyArray<KnownMcpServer> = [
  {
    name: 'aldo-platform',
    pkg: '@aldo-ai/mcp-platform',
    transport: 'stdio',
    description:
      'Drive ALDO AI from any MCP client (Claude, Codex, Cursor, Windsurf, …). Exposes agents, runs, datasets, and the run debugger as MCP tools.',
    docsHref: 'https://ai.aldo.tech/docs/guides/mcp-server',
  },
  {
    name: 'aldo-fs',
    pkg: '@aldo-ai/mcp-fs',
    transport: 'stdio',
    description:
      'Sandboxed filesystem MCP server with per-agent path ACLs. Used by the orchestrator for tool-bound file IO.',
    docsHref: 'https://ai.aldo.tech/docs',
  },
];

export async function runMcpLs(opts: { readonly json?: boolean }, io: CliIO): Promise<number> {
  if (opts.json === true) {
    writeJson(
      io,
      KNOWN_SERVERS.map((s) => ({
        name: s.name,
        package: s.pkg,
        transport: s.transport,
        description: s.description,
        configSnippet: stdioConfigSnippet(s.pkg),
      })),
    );
    return 0;
  }

  // Plain text: header + aligned columns.
  if (KNOWN_SERVERS.length === 0) {
    writeErr(io, 'mcp ls: no known servers (this should not happen)');
    return 1;
  }

  const widths = {
    name: Math.max(4, ...KNOWN_SERVERS.map((s) => s.name.length)),
    pkg: Math.max(7, ...KNOWN_SERVERS.map((s) => s.pkg.length)),
    transport: Math.max(9, ...KNOWN_SERVERS.map((s) => s.transport.length)),
  };

  writeLine(
    io,
    `${'NAME'.padEnd(widths.name)}  ${'PACKAGE'.padEnd(widths.pkg)}  ${'TRANSPORT'.padEnd(widths.transport)}  DESCRIPTION`,
  );
  for (const s of KNOWN_SERVERS) {
    writeLine(
      io,
      `${s.name.padEnd(widths.name)}  ${s.pkg.padEnd(widths.pkg)}  ${s.transport.padEnd(widths.transport)}  ${s.description}`,
    );
  }
  writeLine(io);
  writeLine(io, 'Configure in your MCP client (Claude Desktop, Cursor, Codex, VS Code, …):');
  writeLine(io, '  https://ai.aldo.tech/docs/guides/mcp-server');
  return 0;
}

/**
 * The exact `command` + `args` block any MCP client wants. Useful
 * for `aldo mcp ls --json` consumers that want to render their own
 * config snippet.
 */
function stdioConfigSnippet(pkg: string): { command: string; args: ReadonlyArray<string> } {
  return { command: 'npx', args: ['-y', pkg] };
}
