---
title: MCP server
summary: Drive ALDO AI from any MCP-compatible client — Claude Desktop, Cursor, Codex, VS Code, Windsurf, Zed, and more.
---

ALDO AI ships a first-party [Model Context Protocol](https://modelcontextprotocol.io)
server (`@aldo-ai/mcp-platform`) that exposes agents, runs, datasets, and
the run debugger as MCP tools. Drop it into your client's MCP config
and an LLM can list agents, kick off runs, fetch traces, compare two
runs, and capture good runs as eval rows — all without writing any
client-side glue.

## Why this exists

Every modern AI tool now speaks MCP — Anthropic Claude Desktop &
Code, OpenAI Codex & ChatGPT connectors, Cursor, Windsurf, GitHub
Copilot Chat in VS Code, Zed, Continue.dev, and the major agent
SDKs. Rather than ship a different integration for each, we run AS
an MCP server. One config block; works everywhere.

## The configuration shape

Every MCP client uses the same descriptor: a `command`, `args`, and
optional `env`. The differences are just *which file* holds it. The
ALDO AI server's descriptor is always:

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

Generate the API key at [/settings/api-keys](/settings/api-keys).
Same kind of key the CLI and SDKs use.

## Claude Desktop

`~/Library/Application Support/Claude/claude_desktop_config.json` on
macOS, `%APPDATA%\Claude\claude_desktop_config.json` on Windows:

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

Restart the app. The next time you open a chat, ALDO AI's tools
appear under the MCP-tool affordance.

## Claude Code (CLI)

Either edit `~/.claude.json` or use the built-in command:

```bash
claude mcp add aldo \
  --command npx \
  --args -y @aldo-ai/mcp-platform \
  --env ALDO_API_KEY=aldo_live_... \
  --env ALDO_BASE_URL=https://ai.aldo.tech
```

For a project-scoped server (lives in the repo for your team), drop
the same descriptor into `.mcp.json` at the repo root and Claude
Code will pick it up automatically.

## Cursor

Cursor reads MCP servers from `~/.cursor/mcp.json` (global) or
`.cursor/mcp.json` (per-project):

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

Or via Settings → MCP → Add new server with the same fields.

## OpenAI Codex (CLI)

Codex reads MCP servers from `~/.codex/config.toml`:

```toml
[mcp_servers.aldo]
command = "npx"
args = ["-y", "@aldo-ai/mcp-platform"]

[mcp_servers.aldo.env]
ALDO_API_KEY = "aldo_live_..."
ALDO_BASE_URL = "https://ai.aldo.tech"
```

Or via `codex mcp add aldo --command npx --args "-y @aldo-ai/mcp-platform"` if your version ships the helper.

## ChatGPT (custom GPT connector) — HTTP transport

ChatGPT consumes MCP servers via the **Connectors** surface in a
custom GPT or workspace. Stdio doesn't reach ChatGPT's hosted runtime
— you need the **HTTP/SSE (streamable HTTP) transport**.

> **Status:** the server-side code ships in this release (run it via
> `aldo-mcp-http` or `--transport http`, see [Hosted endpoint]
> (#hosted-endpoint) below). The hosted endpoint at `mcp.aldo.tech`
> is being staged behind our edge. Until that lands you can self-host
> the same image; the connector config is identical, only the URL
> changes.

In your custom GPT's connector configuration:

```yaml
schema_version: v1
type: mcp
url: https://mcp.aldo.tech/mcp
authentication:
  type: bearer
  token: aldo_live_...   # generate at /settings/api-keys
```

The same eight tools the desktop clients see (`aldo.list_agents`,
`aldo.run_agent`, `aldo.compare_runs`, …) appear inside ChatGPT.

## VS Code (GitHub Copilot Chat)

Copilot Chat reads `.vscode/mcp.json` per workspace, or your
user-level `mcp.json`:

```jsonc
{
  "servers": {
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

The Copilot Chat panel surfaces MCP tools under the "tools" picker
in agent mode.

## Windsurf (Cascade)

Edit `~/.codeium/windsurf/mcp_config.json`:

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

## Zed

In `~/.config/zed/settings.json`:

```jsonc
{
  "context_servers": {
    "aldo": {
      "command": {
        "path": "npx",
        "args": ["-y", "@aldo-ai/mcp-platform"],
        "env": {
          "ALDO_API_KEY": "aldo_live_...",
          "ALDO_BASE_URL": "https://ai.aldo.tech"
        }
      }
    }
  }
}
```

## Continue.dev

In `~/.continue/config.json` (or `config.yaml`), under
`experimental.modelContextProtocolServers`:

```jsonc
{
  "experimental": {
    "modelContextProtocolServers": [
      {
        "transport": {
          "type": "stdio",
          "command": "npx",
          "args": ["-y", "@aldo-ai/mcp-platform"],
          "env": {
            "ALDO_API_KEY": "aldo_live_...",
            "ALDO_BASE_URL": "https://ai.aldo.tech"
          }
        }
      }
    ]
  }
}
```

## Any other MCP client

If your client supports the standard MCP stdio transport, the
descriptor at the [top of this page](#the-configuration-shape) is
what you need. The exact filename / UI differs; the contents do not.

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

## Hosted endpoint

The same `@aldo-ai/mcp-platform` package ships **two transports**
from one binary:

| Transport | Use case | Selection |
|---|---|---|
| `stdio` | local desktop / CLI clients (everything above) | default |
| `http` (streamable HTTP per the MCP spec — both SSE streams and direct JSON responses on the same endpoint) | ChatGPT connectors, Cursor remote, OpenAI Agents SDK in remote mode, anything that can't spawn a subprocess | `--transport http` flag, `ALDO_MCP_TRANSPORT=http` env, or the dedicated `aldo-mcp-http` bin |

The hosted endpoint will live at `https://mcp.aldo.tech/mcp` once
deployed. In the meantime you can self-host the HTTP transport in
30 seconds with Docker:

```bash
git clone https://github.com/aldo-tech-labs/aldo-ai
cd aldo-ai
docker build -f mcp-servers/aldo-platform/Dockerfile -t aldo-mcp-http:dev .
docker run --rm -p 3030:3030 -e ALDO_BASE_URL=https://ai.aldo.tech aldo-mcp-http:dev
```

…then point any HTTP-aware MCP client at `http://localhost:3030/mcp`.

### Cursor (remote MCP)

Recent Cursor builds accept a remote `url`+`headers` shape in
`~/.cursor/mcp.json`:

```jsonc
{
  "mcpServers": {
    "aldo": {
      "url": "https://mcp.aldo.tech/mcp",
      "headers": {
        "Authorization": "Bearer aldo_live_..."
      }
    }
  }
}
```

### Auth (HTTP)

Unlike stdio (env or `--api-key` flag), the HTTP transport reads the
token **per request** from the standard `Authorization: Bearer …`
header. The container itself has no key — every connected client
uses their own ALDO API key. Missing or malformed headers get a
`401` JSON-RPC error response.

### Health check

`GET /healthz` on the HTTP endpoint returns
`{ ok: true, transport: 'http', version }` with no auth — useful
for load-balancer probes and uptime monitors.
