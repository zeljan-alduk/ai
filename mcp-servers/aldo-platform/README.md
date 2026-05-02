# @aldo-ai/mcp-platform

ALDO AI platform MCP server. Exposes agents, runs, datasets, and the
run debugger as [Model Context Protocol](https://modelcontextprotocol.io)
tools so any MCP-compatible client — Claude Desktop, Claude Code,
Cursor, OpenAI Codex, ChatGPT connectors, GitHub Copilot Chat in VS
Code, Windsurf, Zed, Continue.dev, the Anthropic / OpenAI agent SDKs —
can drive ALDO AI directly. No per-client integration work.

Two transports ship from one package:

- **stdio** — the standard local-client shape. Your MCP host launches
  the server as a subprocess; JSON-RPC flows over stdin/stdout. Works
  for every desktop client.
- **HTTP / SSE (streamable)** — for ChatGPT connectors, OpenAI Agents
  SDK in remote mode, Cloudflare Workers AI, and any other client that
  can't spawn a local process. Implements the MCP Streamable HTTP
  transport (per `@modelcontextprotocol/sdk` 1.29+); both SSE and
  direct JSON responses are supported.

## Run it (stdio — local clients)

```bash
ALDO_API_KEY=aldo_live_... npx -y @aldo-ai/mcp-platform
```

Or pin via flags:

```bash
npx -y @aldo-ai/mcp-platform --api-key=aldo_live_... --base-url=https://ai.aldo.tech
```

The configuration shape every local client uses:

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

## Run it (HTTP / SSE — hosted endpoint or remote clients)

The HTTP transport is opt-in:

```bash
# via the multiplexing entry point
ALDO_BASE_URL=https://ai.aldo.tech \
  npx -y @aldo-ai/mcp-platform --transport http

# or via the dedicated HTTP bin
ALDO_BASE_URL=https://ai.aldo.tech \
  npx -y -p @aldo-ai/mcp-platform aldo-mcp-http
```

It binds `PORT` (default `3030`) and serves three things:

- `POST /mcp` — JSON-RPC requests (stateless mode; no session
  pinning). Clients must include `Accept: application/json,
  text/event-stream` and `Authorization: Bearer <ALDO_API_KEY>`.
- `GET /mcp` — server-initiated SSE stream (per the streamable HTTP
  spec; no notifications today, but the channel is open).
- `GET /healthz` — `{ ok: true, transport: 'http', version }`. No
  auth required.

**Auth model:** unlike the stdio entry point, the HTTP server does
**not** read `ALDO_API_KEY` from the environment. Each connected
client passes their own ALDO API key in the `Authorization: Bearer
…` header on every request, and the server uses *that* key to call
the upstream REST API. One container can serve many tenants safely.

### Self-host with Docker

A multi-stage Dockerfile is shipped for the HTTP transport:

```bash
# from the repo root
docker build -f mcp-servers/aldo-platform/Dockerfile -t aldo-mcp-http:dev .
docker run --rm -p 3030:3030 \
  -e ALDO_BASE_URL=https://ai.aldo.tech \
  aldo-mcp-http:dev
```

Then point a client at `http://localhost:3030/mcp`.

### Hosted endpoint at mcp.aldo.tech

> **Status:** the code in this PR makes hosted-mode possible. The
> actual deploy of `mcp.aldo.tech` (DNS, edge nginx route, TLS) is a
> follow-up. Until that lands, self-host the HTTP transport with
> Docker (above) or `pnpm tsx`.

Once deployed, point an HTTP-aware MCP client at:

```
https://mcp.aldo.tech/mcp
```

with `Authorization: Bearer aldo_live_…` on every request.

#### ChatGPT connector

In a custom GPT or workspace connector configuration:

```yaml
schema_version: v1
type: mcp
url: https://mcp.aldo.tech/mcp
authentication:
  type: bearer
  token: aldo_live_...   # from /settings/api-keys
```

#### Cursor (remote MCP)

In `~/.cursor/mcp.json`:

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

#### Anthropic / OpenAI Agents SDK in remote mode

Any SDK that consumes the streamable HTTP transport:

```ts
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const transport = new StreamableHTTPClientTransport(
  new URL('https://mcp.aldo.tech/mcp'),
  {
    requestInit: {
      headers: { Authorization: `Bearer ${process.env.ALDO_API_KEY}` },
    },
  },
);
const client = new Client({ name: 'my-agent', version: '0.1.0' }, { capabilities: {} });
await client.connect(transport);
```

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

The 8-tool surface is **identical across both transports** — same
input schemas, same return shapes. Switching from stdio to HTTP is
purely a deploy/distribution choice.

## Auth

Generate an API key at <https://ai.aldo.tech/settings/api-keys>.

- **stdio:** pass as `ALDO_API_KEY=…` env or `--api-key=…` flag.
- **HTTP:** pass as `Authorization: Bearer <key>` header on every
  request to `/mcp`. Missing or malformed → `401` with a JSON-RPC
  error body.

Same kind of key the CLI / SDKs use. Sent as `Authorization: Bearer
<key>` on every upstream API call.

## CORS (HTTP transport)

The hosted endpoint accepts cross-origin requests from a curated
allowlist:

- `https://chatgpt.com`, `https://chat.openai.com`
- `https://*.aldo.tech`
- `http://localhost:{3000,3001,3030}` for self-host development

Server-to-server callers don't send `Origin` headers and are
unaffected by the CORS policy. To extend the allowlist for a custom
deploy, edit `src/server-http.ts` (`CORS_ALLOWLIST_EXACT` /
`CORS_ALLOWLIST_SUFFIX`).

## Privacy

- **stdio:** the server runs **in your environment** (your laptop,
  your container, your CI). It is a thin REST client; no credentials
  or run data leave your local process except as direct API calls
  your key is already authorised for.
- **HTTP:** the server runs on whatever infrastructure you (or ALDO)
  deploy it to. The REST client uses the per-request Bearer token —
  **the server never sees, stores, or logs the token beyond the
  lifetime of a single request**. The container has no shared key.
