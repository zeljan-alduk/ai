#!/usr/bin/env node
/**
 * aldo-mcp-platform — stdio entry point.
 *
 * Bolts a stdio transport onto the platform MCP server. This is the
 * canonical local-client integration path — Claude Desktop, Claude
 * Code, Cursor, OpenAI Codex, VS Code, Windsurf, Zed, Continue.dev
 * all spawn an MCP server as a child process and pipe JSON-RPC over
 * stdin/stdout.
 *
 * For ChatGPT connectors and any other HTTP-only MCP client, use
 * `./server-http.ts` instead.
 *
 * No cross-invocation state. The server resolves the API key + base
 * URL once, builds the REST client, registers tools, and waits for
 * stdin to close.
 */

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { RestClient } from './client.js';
import { ConfigError, resolveConfig } from './config.js';
import { createAldoPlatformServer } from './server.js';

export async function main(argv = process.argv.slice(2)): Promise<void> {
  let config: ReturnType<typeof resolveConfig>;
  try {
    config = resolveConfig({ argv });
  } catch (err) {
    fatal(err);
  }
  const client = new RestClient({ baseUrl: config.baseUrl, apiKey: config.apiKey });
  const server = createAldoPlatformServer({ client });
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Stay alive until the parent (the MCP host) closes stdin.
  await new Promise<void>((resolve) => {
    transport.onclose = () => resolve();
  });
}

function fatal(err: unknown): never {
  if (err instanceof ConfigError) {
    process.stderr.write(`aldo-mcp-platform: ${err.code} ${err.message}\n`);
  } else if (err instanceof Error) {
    process.stderr.write(`aldo-mcp-platform: ${err.message}\n`);
  } else {
    process.stderr.write(`aldo-mcp-platform: ${String(err)}\n`);
  }
  process.exit(1);
}

const isEntry = import.meta.url === `file://${process.argv[1]}`;
if (isEntry) {
  main().catch((err) => fatal(err));
}
