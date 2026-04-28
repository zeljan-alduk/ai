# @aldo-ai/mcp-platform

ALDO AI platform MCP server. Exposes agents, runs, datasets, and the
run debugger as [Model Context Protocol](https://modelcontextprotocol.io)
tools so any MCP-compatible client — Claude Desktop, Claude Code,
Cursor, OpenAI Codex, ChatGPT connectors, GitHub Copilot Chat in VS
Code, Windsurf, Zed, Continue.dev, the Anthropic / OpenAI agent SDKs —
can drive ALDO AI directly. No per-client integration work.

## Run it (stdio)

```bash
ALDO_API_KEY=aldo_live_... npx -y @aldo-ai/mcp-platform
```

Or pin via flags:

```bash
npx -y @aldo-ai/mcp-platform --api-key=aldo_live_... --base-url=https://ai.aldo.tech
```

## The configuration shape

Every MCP client uses the same descriptor:

```jsonc
{
  "command": "npx",
  "args": ["-y", "@aldo-ai/mcp-platform"],
  "env": {
    "ALDO_API_KEY": "aldo_live_...",
    "ALDO_BASE_URL": "https://ai.aldo.tech"
  }
}
```

The differences between clients are *which file* holds it. See the
[full guide](https://ai.aldo.tech/docs/guides/mcp-server) for paths
and per-client variations:

- **Claude Desktop** — `claude_desktop_config.json` → `mcpServers.aldo`
- **Claude Code** — `~/.claude.json` or `claude mcp add ...`
- **Cursor** — `~/.cursor/mcp.json` → `mcpServers.aldo`
- **OpenAI Codex** — `~/.codex/config.toml` → `[mcp_servers.aldo]`
- **VS Code (Copilot Chat)** — `.vscode/mcp.json` → `servers.aldo`
- **Windsurf** — `~/.codeium/windsurf/mcp_config.json`
- **Zed** — `settings.json` → `context_servers.aldo`
- **Continue.dev** — `~/.continue/config.json` → `experimental.modelContextProtocolServers[]`
- **ChatGPT** — needs the HTTP/SSE transport (Phase 2)

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

Generate an API key at <https://ai.aldo.tech/settings/api-keys>. Pass
it as `ALDO_API_KEY=…` (or `--api-key=…`). Sent as
`Authorization: Bearer <key>` on every API call — same contract as
the CLI / SDKs.

## Privacy

The server runs **in your environment** (your laptop, your container,
your CI). It is a thin REST client; no credentials or run data leave
your local process except as direct API calls your key is already
authorised for.
