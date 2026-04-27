/**
 * Deterministic SVG avatar generator for an agent name.
 *
 * Hash function — the contract callers depend on:
 *
 *   1. Compute a 32-bit FNV-1a hash of the UTF-8 bytes of the agent
 *      name (`fnv1a32`). FNV-1a is a stable, dependency-free,
 *      well-distributed hash that produces identical output across
 *      runtimes (Node, browsers, edge workers). We deliberately do
 *      NOT use crypto.subtle (async, not available everywhere) or a
 *      JS String.hashCode polyfill (poor distribution).
 *
 *   2. Pick a palette index = hash % palettes.length.
 *
 *   3. Pick a glyph (the single uppercased initial of the agent
 *      name's first non-space rune).
 *
 *   4. Emit a 40x40 rounded-square SVG with:
 *        - background: gradient from palette.from -> palette.to
 *        - foreground: the glyph centred, in palette.fg
 *        - a thin inset stroke for definition on dark surfaces
 *
 * The same name -> same avatar across page loads, across users, and
 * across SSR + client renders. Server components render this directly
 * to HTML.
 *
 * LLM-agnostic by construction — the hash never sees a model id.
 */

import { cn } from '@/lib/cn';

export interface AgentAvatarPalette {
  readonly from: string;
  readonly to: string;
  readonly fg: string;
}

/** Curated 12-palette deck. Picked to be color-blind-distinguishable. */
export const AGENT_AVATAR_PALETTES: ReadonlyArray<AgentAvatarPalette> = [
  { from: '#0ea5e9', to: '#1e3a8a', fg: '#f8fafc' }, // sky -> navy
  { from: '#10b981', to: '#065f46', fg: '#ecfdf5' }, // emerald
  { from: '#f59e0b', to: '#7c2d12', fg: '#fffbeb' }, // amber -> rust
  { from: '#ef4444', to: '#7f1d1d', fg: '#fef2f2' }, // red
  { from: '#8b5cf6', to: '#4c1d95', fg: '#f5f3ff' }, // violet
  { from: '#ec4899', to: '#831843', fg: '#fdf2f8' }, // pink
  { from: '#14b8a6', to: '#134e4a', fg: '#f0fdfa' }, // teal
  { from: '#6366f1', to: '#312e81', fg: '#eef2ff' }, // indigo
  { from: '#84cc16', to: '#365314', fg: '#f7fee7' }, // lime
  { from: '#f97316', to: '#7c2d12', fg: '#fff7ed' }, // orange
  { from: '#06b6d4', to: '#155e75', fg: '#ecfeff' }, // cyan
  { from: '#a855f7', to: '#581c87', fg: '#faf5ff' }, // purple
];

/**
 * 32-bit FNV-1a hash of a UTF-8 string.
 * Deterministic, dependency-free, well-distributed for short strings.
 */
export function fnv1a32(input: string): number {
  // FNV offset basis (32-bit) = 2166136261
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i) & 0xff;
    // 32-bit FNV prime = 16777619
    h = Math.imul(h, 0x01000193);
  }
  // Coerce to unsigned 32-bit.
  return h >>> 0;
}

/** Pick a palette deterministically from the agent name. */
export function paletteFor(name: string): AgentAvatarPalette {
  const idx = fnv1a32(name) % AGENT_AVATAR_PALETTES.length;
  // Index is bounded by length so the lookup is always defined; guard
  // anyway to keep biome's noNonNullAssertion happy.
  return AGENT_AVATAR_PALETTES[idx] ?? AGENT_AVATAR_PALETTES[0] ?? FALLBACK_PALETTE;
}

/** Extract the single-character glyph (first non-space character, uppercased). */
export function glyphFor(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length === 0) return '?';
  const first = trimmed.charAt(0);
  return first.toUpperCase();
}

const FALLBACK_PALETTE: AgentAvatarPalette = {
  from: '#475569',
  to: '#0f172a',
  fg: '#f8fafc',
};

export interface AgentAvatarProps {
  name: string;
  size?: number;
  className?: string;
}

export function AgentAvatar({ name, size = 40, className }: AgentAvatarProps) {
  const palette = paletteFor(name);
  const glyph = glyphFor(name);
  // Stable id derived from the hash so two avatars on the same page
  // don't collide on the gradient defs.
  const gradId = `aldo-avatar-${fnv1a32(name).toString(36)}`;
  const fontSize = Math.round(size * 0.5);
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label={`Avatar for ${name}`}
      className={cn('shrink-0 rounded-md', className)}
    >
      <defs>
        <linearGradient id={gradId} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor={palette.from} />
          <stop offset="100%" stopColor={palette.to} />
        </linearGradient>
      </defs>
      <rect
        x={0}
        y={0}
        width={size}
        height={size}
        rx={Math.round(size * 0.2)}
        ry={Math.round(size * 0.2)}
        fill={`url(#${gradId})`}
      />
      <rect
        x={0.5}
        y={0.5}
        width={size - 1}
        height={size - 1}
        rx={Math.round(size * 0.2)}
        ry={Math.round(size * 0.2)}
        fill="none"
        stroke="rgba(15,23,42,0.15)"
        strokeWidth={1}
      />
      <text
        x="50%"
        y="50%"
        dy="0.07em"
        textAnchor="middle"
        dominantBaseline="middle"
        fontFamily="ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif"
        fontWeight={700}
        fontSize={fontSize}
        fill={palette.fg}
      >
        {glyph}
      </text>
    </svg>
  );
}
