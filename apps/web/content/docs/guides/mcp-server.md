---
title: MCP server
summary: Drive ALDO AI from Claude Desktop, Cursor, Claude Code, or any MCP-compatible client.
---

ALDO AI ships a first-party [Model Context Protocol](https://modelcontextprotocol.io)
server (`@aldo-ai/mcp-platform`) that exposes agents, runs, datasets, and
the run debugger as MCP tools. Drop it into your MCP client's config
and an LLM can list agents, kick off runs, fetch traces, compare two
runs, and capture good runs as eval rows — all without writing any
client-side glue.

## Why this exists

Every modern AI tool now speaks MCP — Claude Desktop, Claude Code,
Cursor, ChatGPT plugins, the Anthropic and OpenAI agent SDKs. Rather
than ship a different integration for each, we run AS an MCP server.
One config block; works everywhere.

## Configure (Claude Desktop)

Edit `~/Library/Application Support/Claude/claude_desktop_config.json`
on macOS, or the equivalent path on your platform:

```jsonc
{
  "mcpServers": {
    "aldo": {
      "command": "npx",
      "args": ["-y", "@aldo-ai/mcp-platform"],
      "env": {
        "ALDO_API_KEY": "aldo_live_...",
        "ALDO_BASE_URL": "https://ai.aldo.tech"
      }
    }
  }
}
```

Restart the host app. The next time you open a chat, ALDO AI's tools
appear under the MCP-tool affordance.

## Configure (Cursor / Claude Code / others)

Same shape — both `command` + `args` + `env`. Consult your client's
MCP docs for the file location.

## Get an API key

[Generate one](/settings/api-keys) in the dashboard. Same kind of key
that the CLI and SDKs use. Pass it as `ALDO_API_KEY=…`.

## Tools exposed in v0

| Tool | Purpose |
|---|---|
| `aldo.list_agents` | Enumerate agents in the tenant. |
| `aldo.get_agent` | Fetch one agent spec by name. |
| `aldo.list_runs` | Paginated run list (filters: agent, status). |
| `aldo.get_run` | Run detail + full event timeline. |
| `aldo.run_agent` | Start a new run; returns the new id. |
| `aldo.compare_runs` | Side-by-side event/output/cost diff between two runs. |
| `aldo.list_datasets` | Datasets in the caller tenant. |
| `aldo.save_run_as_eval_row` | Capture a finished run into a dataset row. |

## Privacy

The MCP server runs **in your environment** (your laptop, your
container, your CI). It is a thin REST client; no credentials or run
data leave your local process except as direct API calls your key is
already authorised for.

## Hosted transport (coming next)

The current server runs over **stdio** — your MCP host launches it as
a subprocess and pipes JSON-RPC over stdin/stdout. That's the standard
pattern and works in every client today.

Phase 2 adds **SSE/HTTP transport** at `mcp.aldo.tech` so a hosted
client can connect over OAuth without spawning a local subprocess.
The tool surface is identical; only the transport changes. Watch the
[changelog](/changelog).
