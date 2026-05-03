/**
 * "Speaks every model. Every protocol. Every tool." — ecosystem grid.
 *
 * Four sub-grids:
 *   1. Frontier model providers     (capability-routed, never named in code)
 *   2. Local model engines          (the 5 we actually probe)
 *   3. Tools + protocols            (MCP, OpenAPI, OTel, Postgres, Hono...)
 *   4. Editors / clients            (Claude Desktop, Cursor, ChatGPT...)
 *
 * Typographic-only badges (NO real vendor logos to avoid licensing).
 * Each is a small rounded tile with the name + a tiny capability /
 * protocol indicator below ("REST", "MCP", "stdio", "metric").
 *
 * Footer reaffirms the LLM-agnostic invariant. Server-rendered, no JS.
 */

import type { ReactNode } from 'react';

interface Badge {
  readonly name: string;
  readonly tag: string;
  /** Optional emoji-shaped initial — ASCII only to dodge font fallbacks. */
  readonly mark?: string;
  readonly tone?: 'accent' | 'success' | 'warning' | 'neutral';
}

interface BadgeGroup {
  readonly id: string;
  readonly tag: string;
  readonly title: string;
  readonly subtitle: string;
  readonly badges: ReadonlyArray<Badge>;
}

const GROUPS: ReadonlyArray<BadgeGroup> = [
  {
    id: 'frontier',
    tag: 'Frontier providers',
    title: 'Cloud-grade reasoning behind your own keys',
    subtitle:
      'Bring your own API keys. The gateway routes by capability, never by name — so a new provider lands as a config change, never a code change.',
    badges: [
      { name: 'Anthropic', tag: 'REST · capability:reasoning-strong', mark: 'A' },
      { name: 'OpenAI', tag: 'REST · capability:reasoning-large', mark: 'O' },
      { name: 'Google', tag: 'REST · capability:multimodal', mark: 'G' },
      { name: 'AWS Bedrock', tag: 'AWS-SigV4 · multi-vendor pool', mark: 'B' },
      { name: 'Azure OpenAI', tag: 'REST · region-pinned', mark: 'Az' },
      { name: 'Mistral', tag: 'REST · capability:fast-cloud', mark: 'M' },
      { name: 'Cohere', tag: 'REST · capability:embed', mark: 'C' },
    ],
  },
  {
    id: 'local',
    tag: 'Local engines',
    title: 'Five runtimes probed at boot — no toy nodes',
    subtitle:
      'Local models are first-class. The discovery layer auto-probes each engine on the host network and surfaces per-model context, params, and quantisation.',
    badges: [
      { name: 'Ollama', tag: 'macOS / Linux daemon · OpenAI-compat', mark: 'O', tone: 'success' },
      { name: 'vLLM', tag: 'GPU serving · paged attention', mark: 'v', tone: 'success' },
      { name: 'llama.cpp', tag: 'C++ runtime · ggml / gguf', mark: 'l', tone: 'success' },
      { name: 'MLX', tag: 'Apple Silicon · unified memory', mark: 'M', tone: 'success' },
      { name: 'LM Studio', tag: 'desktop app · OpenAI-compat', mark: 'L', tone: 'success' },
    ],
  },
  {
    id: 'protocols',
    tag: 'Protocols + tools',
    title: 'Open standards, all the way through',
    subtitle:
      'MCP for tools, OpenAPI for the public API, OTel for telemetry, Postgres for storage. No proprietary wire formats, no vendor lock-in at any layer.',
    badges: [
      { name: 'MCP', tag: 'stdio + Streamable HTTP · 8 tools', mark: '⛓', tone: 'accent' },
      { name: 'OpenAPI', tag: '3.1 · Scalar + Redoc viewers', mark: '{}' },
      { name: 'OpenTelemetry', tag: 'export coming · OTLP', mark: 'OT' },
      { name: 'Postgres', tag: 'storage · 26 migrations', mark: 'PG' },
      { name: 'Hono', tag: 'API · 470 tests', mark: 'H' },
      { name: 'Next.js', tag: 'web · app-router', mark: 'N' },
      { name: 'GitHub Actions', tag: 'deploy · self-host parity', mark: 'gh' },
      { name: 'Slack alerts', tag: 'Incoming Webhooks', mark: 'sl' },
      { name: 'Webhooks', tag: 'HMAC-SHA256 · idempotent', mark: 'wh' },
    ],
  },
  {
    id: 'clients',
    tag: 'Editors + clients',
    title: 'One MCP server. Eight clients. Same descriptor.',
    subtitle:
      "@aldo-ai/mcp-platform exposes the platform's eight tools over both stdio and Streamable HTTP. Drop the same descriptor into any modern AI editor.",
    badges: [
      { name: 'Claude Desktop', tag: 'macOS · Windows · Linux · stdio', mark: 'C' },
      { name: 'Claude Code', tag: 'CLI · claude mcp add · stdio', mark: '$_' },
      { name: 'Cursor', tag: '~/.cursor/mcp.json · stdio', mark: 'C' },
      { name: 'ChatGPT GPTs', tag: 'mcp.aldo.tech · http', mark: 'G', tone: 'accent' },
      { name: 'Continue.dev', tag: 'config.json · stdio', mark: '→' },
      { name: 'Zed', tag: 'context_servers · stdio', mark: 'Z' },
      { name: 'Windsurf', tag: 'mcp_config.json · stdio', mark: 'W' },
      { name: 'VS Code', tag: 'chat.mcp · stdio', mark: 'VS' },
    ],
  },
];

const TONE_RING: Record<Exclude<NonNullable<Badge['tone']>, never>, string> = {
  accent: 'border-accent/40 bg-accent/8 text-accent',
  success: 'border-success/40 bg-success/8 text-success',
  warning: 'border-warning/40 bg-warning/8 text-warning',
  neutral: 'border-border bg-bg-subtle text-fg',
};

const TONE_MARK: Record<Exclude<NonNullable<Badge['tone']>, never>, string> = {
  accent: 'border-accent/30 text-accent',
  success: 'border-success/30 text-success',
  warning: 'border-warning/30 text-warning',
  neutral: 'border-border text-fg',
};

export function EcosystemGrid() {
  return (
    <section id="ecosystem" className="border-t border-border bg-bg-elevated">
      {/* Subtle dotted backdrop — pure-CSS radial-gradient, no JS, no
          image. Communicates "constellation of integrations" without
          a single literal logo. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 -mt-16 h-32 opacity-50"
        style={{
          backgroundImage:
            'radial-gradient(circle at center, rgb(var(--accent) / 0.08) 1px, transparent 1px)',
          backgroundSize: '14px 14px',
        }}
      />
      <div className="relative mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-24">
        <div className="mb-12 max-w-3xl">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-accent">
            Ecosystem
          </p>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight text-fg sm:text-[2.1rem]">
            Speaks every model. Every protocol. Every tool.
          </h2>
          <p className="mt-3 text-base leading-relaxed text-fg-muted">
            ALDO is a control plane, not another vertical stack. The list below is the surface area
            we already speak — a long way from "MIT-licensed Python class hierarchy that hard-codes
            one vendor."
          </p>
        </div>

        <div className="space-y-10 sm:space-y-14">
          {GROUPS.map((g) => (
            <BadgeGroupRow key={g.id} group={g} />
          ))}
        </div>

        {/* Footer pinning the invariant */}
        <div className="mt-12 flex flex-wrap items-start gap-3 rounded-xl border border-accent/30 bg-accent/5 p-5">
          <span
            className="inline-flex h-7 w-7 flex-none items-center justify-center rounded-md border border-accent/40 bg-accent/10 font-mono text-[12px] font-bold text-accent"
            aria-hidden
          >
            ▸
          </span>
          <p className="text-[13.5px] leading-relaxed text-fg">
            <span className="font-semibold text-fg">If a new provider ships tomorrow,</span> it
            lands as a config change — never a code change. Capability strings are the only thing
            agent specs ever name. The router decides the rest.
            <span className="ml-2 rounded bg-bg-elevated px-1.5 py-0.5 font-mono text-[10.5px] text-fg-faint">
              CLAUDE.md non-negotiable #1
            </span>
          </p>
        </div>
      </div>
    </section>
  );
}

function BadgeGroupRow({ group }: { group: BadgeGroup }) {
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-12 lg:gap-10">
      <div className="lg:col-span-4">
        <p className="font-mono text-[10.5px] uppercase tracking-[0.18em] text-accent">
          {group.tag}
        </p>
        <h3 className="mt-1.5 text-[1.1rem] font-semibold tracking-tight text-fg">{group.title}</h3>
        <p className="mt-2 text-[13.5px] leading-relaxed text-fg-muted">{group.subtitle}</p>
      </div>
      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:col-span-8 lg:grid-cols-4">
        {group.badges.map((b) => (
          <BadgeTile key={b.name} badge={b} />
        ))}
      </ul>
    </div>
  );
}

function BadgeTile({ badge }: { badge: Badge }) {
  const tone = badge.tone ?? 'neutral';
  return (
    <li
      className={`group flex items-start gap-2 rounded-lg border bg-bg p-2.5 transition-all hover:-translate-y-px hover:shadow-md ${TONE_RING[tone]}`}
    >
      {badge.mark ? (
        <span
          aria-hidden
          className={`flex h-7 w-7 flex-none items-center justify-center rounded-md border bg-bg-elevated font-mono text-[10.5px] font-bold ${TONE_MARK[tone]}`}
        >
          {badge.mark}
        </span>
      ) : null}
      <div className="min-w-0 flex-1">
        <div className="truncate text-[12.5px] font-semibold text-fg">{badge.name}</div>
        <div className="mt-0.5 truncate font-mono text-[9.5px] text-fg-faint">{badge.tag}</div>
      </div>
    </li>
  );
}

// Reserved for future use if a section needs an inline divider; kept
// here so callers don't reach into a generic primitives file.
export function _EcosystemDivider(): ReactNode {
  return <div aria-hidden className="my-6 h-px w-full bg-border" />;
}
