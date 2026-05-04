#!/usr/bin/env node
/**
 * aldo-mcp-memory — entry point.
 *
 * Resolves the policy from CLI flags / env (`config.ts`) and bolts the
 * server onto a stdio transport.
 *
 * MISSING_PIECES.md §12.2 / #6.
 */

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { resolvePolicyOptions } from './config.js';
import { MemoryError, createPolicy } from './policy.js';
import { createAldoMemoryServer } from './server.js';

export async function main(argv = process.argv.slice(2)): Promise<void> {
  let policyOpts: ReturnType<typeof resolvePolicyOptions>;
  try {
    policyOpts = resolvePolicyOptions({ argv });
  } catch (err) {
    fatal(err);
  }
  const policy = createPolicy(policyOpts);
  const server = createAldoMemoryServer({ policy });
  const transport = new StdioServerTransport();
  await server.connect(transport);
  await new Promise<void>((resolve) => {
    transport.onclose = () => resolve();
  });
}

function fatal(err: unknown): never {
  if (err instanceof MemoryError) {
    process.stderr.write(`aldo-mcp-memory: ${err.code} ${err.message}\n`);
  } else if (err instanceof Error) {
    process.stderr.write(`aldo-mcp-memory: ${err.message}\n`);
  } else {
    process.stderr.write(`aldo-mcp-memory: ${String(err)}\n`);
  }
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
