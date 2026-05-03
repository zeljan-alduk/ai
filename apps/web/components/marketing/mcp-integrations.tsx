'use client';

/**
 * "Speak to anything via MCP" — integrations grid.
 *
 * Square cards: Claude Desktop, Claude Code, Cursor, ChatGPT (custom
 * GPT via mcp.aldo.tech), Continue.dev, Zed, Windsurf, VS Code.
 *
 * Each card has a "Copy config" button that copies the canonical
 * stdio config block to the clipboard. The full guide lives at
 * /docs/guides/mcp-server.
 *
 * Keyboard accessible — every card and every copy button is a real
 * <button> with aria-label.
 */

import Link from 'next/link';
import { useState } from 'react';

const STDIO_CONFIG = `{
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
}`;

const HTTP_CONFIG = `{
  "url": "https://mcp.aldo.tech/v1/mcp",
  "transport": "streamable-http",
  "headers": {
    "Authorization": "Bearer aldo_live_..."
  }
}`;

interface Integration {
  readonly id: string;
  readonly name: string;
  readonly sub: string;
  readonly logo: React.ReactNode;
  readonly transport: 'stdio' | 'http';
  readonly docsAnchor: string;
}

const INTEGRATIONS: ReadonlyArray<Integration> = [
  {
    id: 'claude-desktop',
    name: 'Claude Desktop',
    sub: 'macOS · Windows · Linux',
    logo: <LogoBadge text="C" tone="orange" />,
    transport: 'stdio',
    docsAnchor: '#claude-desktop',
  },
  {
    id: 'claude-code',
    name: 'Claude Code',
    sub: 'CLI — claude mcp add',
    logo: <LogoBadge text="$_" tone="orange" />,
    transport: 'stdio',
    docsAnchor: '#claude-code-cli',
  },
  {
    id: 'cursor',
    name: 'Cursor',
    sub: '~/.cursor/mcp.json',
    logo: <LogoBadge text="C" tone="slate" />,
    transport: 'stdio',
    docsAnchor: '#cursor',
  },
  {
    id: 'chatgpt',
    name: 'ChatGPT custom GPTs',
    sub: 'mcp.aldo.tech HTTP endpoint',
    logo: <LogoBadge text="G" tone="emerald" />,
    transport: 'http',
    docsAnchor: '#chatgpt',
  },
  {
    id: 'continue',
    name: 'Continue.dev',
    sub: 'config.json mcpServers',
    logo: <LogoBadge text="→" tone="violet" />,
    transport: 'stdio',
    docsAnchor: '#continue',
  },
  {
    id: 'zed',
    name: 'Zed',
    sub: 'context_servers in settings.json',
    logo: <LogoBadge text="Z" tone="rose" />,
    transport: 'stdio',
    docsAnchor: '#zed',
  },
  {
    id: 'windsurf',
    name: 'Windsurf',
    sub: 'mcp_config.json',
    logo: <LogoBadge text="W" tone="sky" />,
    transport: 'stdio',
    docsAnchor: '#windsurf',
  },
  {
    id: 'vscode',
    name: 'VS Code (Copilot Chat)',
    sub: 'settings.json — chat.mcp',
    logo: <LogoBadge text="VS" tone="blue" />,
    transport: 'stdio',
    docsAnchor: '#vs-code',
  },
];

export function McpIntegrations() {
  const [copied, setCopied] = useState<string | null>(null);

  function copy(id: string, text: string) {
    if (typeof navigator === 'undefined' || !navigator.clipboard) return;
    navigator.clipboard.writeText(text).then(() => {
      setCopied(id);
      setTimeout(() => setCopied(null), 1800);
    });
  }

  return (
    <section id="mcp" className="border-t border-border bg-bg">
      <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-24">
        <div className="mb-10 flex flex-wrap items-end justify-between gap-4">
          <div className="max-w-2xl">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-accent">
              Speak to anything via MCP
            </p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight text-fg sm:text-[2.1rem]">
              One server. Eight clients. Zero glue code.
            </h2>
            <p className="mt-3 text-base leading-relaxed text-fg-muted">
              ALDO ships a first-party Model Context Protocol server (
              <code className="rounded bg-bg-subtle px-1 py-0.5 font-mono text-[12.5px]">
                @aldo-ai/mcp-platform
              </code>
              ) — eight tools, both stdio and Streamable HTTP transports. The same descriptor works
              in every modern AI tool.
            </p>
          </div>
          <Link
            href="/docs/guides/mcp-server"
            className="rounded border border-border bg-bg px-3 py-1.5 text-sm font-medium text-fg transition-colors hover:bg-bg-subtle"
          >
            Full setup guide →
          </Link>
        </div>

        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {INTEGRATIONS.map((it) => {
            const config = it.transport === 'http' ? HTTP_CONFIG : STDIO_CONFIG;
            const isCopied = copied === it.id;
            return (
              <li
                key={it.id}
                className="group relative flex aspect-square flex-col rounded-xl border border-border bg-bg p-4 transition-all hover:border-border-strong hover:shadow-md focus-within:border-accent"
              >
                <div className="flex items-start justify-between">
                  {it.logo}
                  <span
                    className={`rounded border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider ${
                      it.transport === 'http'
                        ? 'border-accent/30 bg-accent/10 text-accent'
                        : 'border-border bg-bg-subtle text-fg-muted'
                    }`}
                  >
                    {it.transport}
                  </span>
                </div>
                <div className="mt-auto">
                  <h3 className="text-[14px] font-semibold leading-tight text-fg">{it.name}</h3>
                  <p className="mt-0.5 truncate font-mono text-[11px] text-fg-faint">{it.sub}</p>
                  <button
                    type="button"
                    onClick={() => copy(it.id, config)}
                    aria-label={`Copy ${it.name} MCP config to clipboard`}
                    className={`mt-3 inline-flex w-full items-center justify-center gap-1 rounded border border-border bg-bg-elevated px-2 py-1 text-[11px] font-medium transition-colors hover:border-accent hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                      isCopied ? 'border-success text-success' : 'text-fg'
                    }`}
                  >
                    {isCopied ? (
                      <>
                        <CheckIcon /> copied
                      </>
                    ) : (
                      <>
                        <CopyIcon /> copy config
                      </>
                    )}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>

        <div className="mt-6 flex flex-wrap items-center gap-2 text-[11.5px] text-fg-muted">
          <span className="rounded-full border border-border bg-bg-subtle px-2 py-0.5 font-mono text-[10px] text-fg">
            stdio
          </span>
          <span>
            spawns a local subprocess via npx — works offline against
            <code className="ml-1 rounded bg-bg-subtle px-1 py-0.5 font-mono text-[10.5px]">
              ALDO_BASE_URL
            </code>
            .
          </span>
          <span className="rounded-full border border-accent/30 bg-accent/10 px-2 py-0.5 font-mono text-[10px] text-accent">
            http
          </span>
          <span>
            Streamable HTTP/SSE endpoint at{' '}
            <code className="rounded bg-bg-subtle px-1 py-0.5 font-mono text-[10.5px]">
              mcp.aldo.tech/v1/mcp
            </code>{' '}
            — the only transport ChatGPT custom GPTs accept.
          </span>
        </div>
      </div>
    </section>
  );
}

function LogoBadge({
  text,
  tone,
}: { text: string; tone: 'orange' | 'slate' | 'emerald' | 'violet' | 'rose' | 'sky' | 'blue' }) {
  // Tones are intentionally hardcoded brand-ish colors for the integration
  // logos — semantic tokens don't apply to a literal vendor mark. Each tone
  // works on both light and dark backgrounds.
  const map: Record<typeof tone, string> = {
    orange: 'bg-amber-500/15 text-amber-600 dark:text-amber-400 ring-amber-500/30',
    slate: 'bg-slate-500/15 text-slate-700 dark:text-slate-300 ring-slate-500/30',
    emerald: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 ring-emerald-500/30',
    violet: 'bg-violet-500/15 text-violet-600 dark:text-violet-400 ring-violet-500/30',
    rose: 'bg-rose-500/15 text-rose-600 dark:text-rose-400 ring-rose-500/30',
    sky: 'bg-sky-500/15 text-sky-600 dark:text-sky-400 ring-sky-500/30',
    blue: 'bg-blue-500/15 text-blue-600 dark:text-blue-400 ring-blue-500/30',
  };
  return (
    <div
      className={`flex h-9 w-9 items-center justify-center rounded-lg font-mono text-[14px] font-bold ring-1 ${map[tone]}`}
      aria-hidden
    >
      {text}
    </div>
  );
}

function CopyIcon() {
  return (
    <svg
      width="11"
      height="11"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect x="9" y="9" width="13" height="13" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      width="11"
      height="11"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}
