#!/usr/bin/env node
/**
 * aldo-mcp-platform — multiplexed entry point.
 *
 * Dispatches to one of two transports:
 *   - stdio (default)  — local MCP clients (Claude Desktop/Code,
 *                         Cursor, Codex, VS Code, Windsurf, Zed, …)
 *   - http             — hosted endpoint (ChatGPT connectors, OpenAI
 *                         Agents SDK in remote mode, anything that
 *                         can't spawn a subprocess)
 *
 * Selection (first match wins):
 *   1. CLI: `--transport=http` or `--transport http`
 *   2. Env: `ALDO_MCP_TRANSPORT=http`
 *   3. Default: `stdio`
 *
 * The `aldo-mcp-platform` bin entry continues to default to stdio
 * (backward-compatible with every installed client). The
 * `aldo-mcp-http` bin entry hard-codes HTTP so deploys don't have to
 * pass a flag through their entrypoint.
 */

function detectTransport(argv: ReadonlyArray<string>, env: NodeJS.ProcessEnv): 'stdio' | 'http' {
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === undefined) continue;
    if (a.startsWith('--transport=')) {
      const val = a.slice('--transport='.length);
      return normaliseTransport(val);
    }
    if (a === '--transport') {
      const next = argv[i + 1];
      if (typeof next === 'string') return normaliseTransport(next);
    }
  }
  if (typeof env.ALDO_MCP_TRANSPORT === 'string' && env.ALDO_MCP_TRANSPORT.length > 0) {
    return normaliseTransport(env.ALDO_MCP_TRANSPORT);
  }
  return 'stdio';
}

function normaliseTransport(raw: string): 'stdio' | 'http' {
  const v = raw.trim().toLowerCase();
  if (v === 'http' || v === 'sse' || v === 'streamable-http') return 'http';
  return 'stdio';
}

async function dispatch(): Promise<void> {
  const transport = detectTransport(process.argv.slice(2), process.env);
  if (transport === 'http') {
    const mod = await import('./server-http.js');
    await mod.main();
  } else {
    const mod = await import('./server-stdio.js');
    await mod.main();
  }
}

const isEntry = import.meta.url === `file://${process.argv[1]}`;
if (isEntry) {
  dispatch().catch((err) => {
    process.stderr.write(`aldo-mcp-platform: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });
}
