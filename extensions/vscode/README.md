# ALDO AI for VS Code

Run ALDO agents, browse runs, and view traces — all without leaving
your editor. The extension is a thin client over the ALDO platform
API; it never calls a model provider directly, so privacy tiers are
enforced by the platform, not by your extension settings.

## 30-second start

1. **Install** the `.vsix`:
   ```sh
   code --install-extension aldo-ai-vscode-0.1.0.vsix
   ```
2. **Login**: open the command palette (Cmd-Shift-P) → "ALDO AI: Login".
   Paste your API base URL (e.g. `https://ai.aldo.tech`) and a
   token from `/settings/api-keys`.
3. **Run an agent**: highlight a code snippet, then "ALDO AI: Run agent
   on selection". Pick an agent from the picker. The output panel
   streams events as they arrive.

## Features

- **Sidebar view "ALDO AI"** with three trees: Agents, Recent Runs,
  Models. Refresh button at the top of each.
- **Status bar item** showing the connected tenant; click to login /
  logout.
- **Commands** (Cmd-Shift-P):
  - `ALDO AI: Login`
  - `ALDO AI: Logout`
  - `ALDO AI: Run agent on selection`
  - `ALDO AI: Run agent on file`
  - `ALDO AI: Open run in browser`
  - `ALDO AI: Open trace inline` — opens a webview with a flame graph
    + replay scrubber, fed directly from `/v1/runs/:id/tree` (no
    dependency on the web app being reachable).
  - `ALDO AI: Quick prompt`
- **Code actions**: lightbulb on `TODO`/`FIXME` comments and
  function-like declarations offers "Send to ALDO agent" with the top
  4 agents in your tenant.

## Privacy

The extension is LLM-agnostic. It only ever talks to the ALDO API.
If an agent is marked `privacy_tier: sensitive`, the platform router
will refuse to dispatch it to a cloud model — there is no path in this
extension that could route around that.

## Screenshots

<!-- TODO(launch): real screenshots before Marketplace publish. -->
- ![Sidebar](./media/screenshot-sidebar.png) — TODO(launch)
- ![Trace](./media/screenshot-trace.png) — TODO(launch)
- ![Quick prompt](./media/screenshot-quick-prompt.png) — TODO(launch)

## Known limitations

- No inline diagnostics from agent runs yet — return paths from agents
  annotating files are a separate UX problem.
- Cursor-specific integration is not implemented; the extension uses
  stock VS Code APIs and Cursor inherits them transparently.
- The Marketplace icon at `media/icon.png` is a placeholder until the
  wave-12 logomark is exported as a 128x128 PNG. <!-- TODO(launch) -->
- Streaming run events relies on the API surfacing an SSE endpoint;
  until that lands the output panel just shows the initial create-run
  reply.

## Development

```sh
pnpm --filter aldo-ai-vscode build      # esbuild → dist/extension.js
pnpm --filter aldo-ai-vscode test       # vitest unit tests
pnpm --filter aldo-ai-vscode typecheck
pnpm --filter aldo-ai-vscode package    # produces .vsix
```

Test the .vsix manually:

```sh
code --install-extension dist/aldo-ai-vscode-0.1.0.vsix
```

Then open the Activity Bar — the ALDO AI sidebar should appear.
