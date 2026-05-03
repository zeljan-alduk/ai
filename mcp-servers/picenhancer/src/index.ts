#!/usr/bin/env node
/**
 * aldo-mcp-picenhancer — entry point.
 *
 * Wires the picenhancer MCP server up to a stdio transport. Reads the
 * picenhancer backend URL from --base-url / PICENHANCER_BASE_URL,
 * defaulting to the public proxy at https://ai.aldo.tech/live/picenhancer/api.
 *
 * Stays alive until the parent process closes stdin.
 */

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createPicenhancerServer } from './server.js';

const DEFAULT_BASE_URL = 'https://ai.aldo.tech/live/picenhancer/api';

function parseArgs(argv: readonly string[]): { baseUrl: string } {
  let baseUrl = process.env.PICENHANCER_BASE_URL ?? DEFAULT_BASE_URL;
  for (let i = 0; i < argv.length; i++) {
    const next = argv[i + 1];
    if (argv[i] === '--base-url' && typeof next === 'string') {
      baseUrl = next;
    }
  }
  if (!/^https?:\/\//.test(baseUrl)) {
    throw new Error(`--base-url must be http(s)://; got "${baseUrl}"`);
  }
  return { baseUrl };
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  let cfg: { baseUrl: string };
  try {
    cfg = parseArgs(argv);
  } catch (err) {
    fatal(err);
  }
  const server = createPicenhancerServer({ config: { baseUrl: cfg.baseUrl } });
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write(
    `aldo-mcp-picenhancer: ready (backend=${cfg.baseUrl})\n`,
  );
  await new Promise<void>((resolve) => {
    transport.onclose = () => resolve();
  });
}

function fatal(err: unknown): never {
  const msg = err instanceof Error ? err.message : String(err);
  process.stderr.write(`aldo-mcp-picenhancer: ${msg}\n`);
  process.exit(2);
}

const invokedDirectly = (() => {
  try {
    const arg1 = process.argv[1];
    if (!arg1) return false;
    const url = new URL(`file://${arg1}`).href;
    return import.meta.url === url;
  } catch {
    return false;
  }
})();
if (invokedDirectly) {
  main().catch(fatal);
}
