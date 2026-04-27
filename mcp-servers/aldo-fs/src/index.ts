#!/usr/bin/env node
/**
 * aldo-mcp-fs — entry point.
 *
 * Wires the aldo-fs MCP server up to a stdio transport, after
 * resolving the ACL roots from --roots / ALDO_FS_ROOTS / --config.
 *
 * No memory of prior sessions: this process loads the ACL once at
 * startup and never persists state across invocations.
 */

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { FsError, createAcl } from './acl.js';
import { resolveRoots } from './config.js';
import { createMeridianFsServer } from './server.js';

export async function main(argv = process.argv.slice(2)): Promise<void> {
  let roots: Awaited<ReturnType<typeof resolveRoots>>;
  try {
    roots = await resolveRoots({ argv });
  } catch (err) {
    fatal(err);
  }
  const acl = createAcl(roots);
  const server = createMeridianFsServer({ acl });
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Stay alive until the parent closes stdin.
  await new Promise<void>((resolve) => {
    transport.onclose = () => resolve();
  });
}

function fatal(err: unknown): never {
  if (err instanceof FsError) {
    process.stderr.write(`aldo-mcp-fs: ${err.code} ${err.message}\n`);
  } else if (err instanceof Error) {
    process.stderr.write(`aldo-mcp-fs: ${err.message}\n`);
  } else {
    process.stderr.write(`aldo-mcp-fs: ${String(err)}\n`);
  }
  process.exit(2);
}

// `node dist/index.js` invocation: run main(). When imported from tests,
// the module-level check is skipped because import.meta.url won't match
// process.argv[1].
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
