/**
 * Small formatting helpers shared across the control plane UI.
 * Pure functions — no React, no DOM.
 */

const usdFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 4,
});

/** Format a USD value. Always returns at least `$0.00`. */
export function formatUsd(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return '$0.00';
  return usdFormatter.format(value);
}

/** Format a duration in milliseconds as a short human string. */
export function formatDuration(ms: number | null | undefined): string {
  if (ms == null || Number.isNaN(ms)) return '—';
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(s < 10 ? 2 : 1)}s`;
  const m = Math.floor(s / 60);
  const rem = Math.round(s - m * 60);
  if (m < 60) return `${m}m ${rem}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m - h * 60}m`;
}

/** Format an ISO timestamp as "12s ago" / "3m ago" / "2026-04-25 14:31". */
export function formatRelativeTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  const diff = Date.now() - t;
  if (diff < 0) return new Date(t).toISOString().replace('T', ' ').slice(0, 16);
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(t).toISOString().replace('T', ' ').slice(0, 16);
}

/** Format an ISO timestamp as a stable absolute string. */
export function formatAbsolute(iso: string | null | undefined): string {
  if (!iso) return '—';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  return `${new Date(t).toISOString().replace('T', ' ').slice(0, 19)}Z`;
}
