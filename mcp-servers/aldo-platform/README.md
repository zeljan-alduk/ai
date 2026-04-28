# @aldo-ai/mcp-platform

ALDO AI platform MCP server. Exposes agents, runs, datasets, and the
run debugger as [Model Context Protocol](https://modelcontextprotocol.io)
tools so any MCP-compatible client (Claude Desktop, Claude Code, Cursor,
ChatGPT plugins, the Anthropic / OpenAI agent SDKs) can drive ALDO AI
directly — no per-client integration work.

## Install + run (stdio)

```bash
pnpm install
ALDO_API_KEY=aldo_live_... pnpm --filter @aldo-ai/mcp-platform start
```

Or as a CLI binary once published:

```bash
npx @aldo-ai/mcp-platform --api-key=aldo_live_...
```

## Configure in Claude Desktop

`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS:

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

## Configure in Cursor / Claude Code

Same shape — both support the standard MCP `command` + `args` + `env`
descriptor. See your client's MCP docs for the file location.

## Tools

| Name | Purpose |
|---|---|
| `aldo.list_agents` | Enumerate agents in the tenant. |
| `aldo.get_agent` | Fetch one agent spec by name. |
| `aldo.list_runs` | Paginated run list with status / agent filter. |
| `aldo.get_run` | Run detail + full event timeline. |
| `aldo.run_agent` | Start a new run; returns the new id. |
| `aldo.compare_runs` | Side-by-side event/output/cost diff. |
| `aldo.list_datasets` | Datasets in the caller tenant. |
| `aldo.save_run_as_eval_row` | Capture a finished run into a dataset row. |

Resources, prompts, and the SSE/HTTP transport land in a follow-up.

## Auth

Generate an API key at <https://ai.aldo.tech/settings/api-keys>. The
key is sent as `Authorization: Bearer <key>` on every API call — same
contract as the CLI / SDKs.

## Privacy

The MCP server runs **in your environment** (your laptop, your
container, your CI). It is a thin REST client; no credentials or run
data leave your local process except as direct calls to the platform
API your key is already authorised for.
