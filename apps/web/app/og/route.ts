/**
 * OG image endpoint for the marketing surface (`/`, `/pricing`, etc.).
 *
 * Wave-16E. Pairs with `app/docs/og/route.ts`: same SVG-as-image
 * approach (no Satori / Chromium pipeline), 1200×630 (the canonical
 * OG image size), embeds the hero text + a small dashboard preview
 * gradient. SVG OG images are supported by every major consumer
 * (Slack, Discord, Twitter/X, Mastodon, LinkedIn).
 *
 * Query params (all optional):
 *   ?title=...       — primary headline (default: marketing hero copy)
 *   ?subtitle=...    — sub-headline   (default: tagline)
 *   ?eyebrow=...     — top label      (default: "ALDO AI")
 *
 * Caches forever in the browser; the file is content-addressed by
 * the query string, so a copy change naturally invalidates.
 *
 * LLM-agnostic: nothing in the OG generator names a provider.
 */

import type { NextRequest } from 'next/server';

const W = 1200;
const H = 630;

const DEFAULT_TITLE = 'Run real software-engineering teams of LLM agents.';
const DEFAULT_SUBTITLE = 'Local-first. Privacy-tier-enforced. Replayable end-to-end.';
const DEFAULT_EYEBROW = 'ALDO AI';

export function GET(req: NextRequest): Response {
  const title = req.nextUrl.searchParams.get('title') ?? DEFAULT_TITLE;
  const subtitle = req.nextUrl.searchParams.get('subtitle') ?? DEFAULT_SUBTITLE;
  const eyebrow = req.nextUrl.searchParams.get('eyebrow') ?? DEFAULT_EYEBROW;
  const safeTitle = escapeXml(truncate(title, 90));
  const safeSubtitle = escapeXml(truncate(subtitle, 110));
  const safeEyebrow = escapeXml(truncate(eyebrow, 32));

  // Mini "dashboard preview" in the bottom-right: three faux panels
  // (line, bar, donut) painted in the same accent palette. Strict
  // SVG primitives only — no foreignObject for the chart so OG
  // consumers that don't render foreignObject (Slack does, Twitter
  // sometimes doesn't) still get the visual.
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#0e1a2b" />
      <stop offset="100%" stop-color="#1d3358" />
    </linearGradient>
    <linearGradient id="panelBg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#1e3a5f" />
      <stop offset="100%" stop-color="#152a47" />
    </linearGradient>
    <linearGradient id="line" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#7dd3fc" />
      <stop offset="100%" stop-color="#3b82f6" />
    </linearGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#bg)" />

  <!-- Hero copy -->
  <g transform="translate(80,110)">
    <text font-family="Inter,system-ui,sans-serif" font-size="22" font-weight="600" fill="#7dd3fc" letter-spacing="6">${safeEyebrow.toUpperCase()}</text>
    <foreignObject x="0" y="36" width="640" height="320">
      <div xmlns="http://www.w3.org/1999/xhtml" style="font-family: Inter, system-ui, sans-serif; font-size: 56px; font-weight: 600; line-height: 1.1; color: #ffffff; word-break: break-word;">${safeTitle}</div>
    </foreignObject>
    <foreignObject x="0" y="370" width="640" height="120">
      <div xmlns="http://www.w3.org/1999/xhtml" style="font-family: Inter, system-ui, sans-serif; font-size: 22px; font-weight: 400; line-height: 1.4; color: #cbd5e1;">${safeSubtitle}</div>
    </foreignObject>
  </g>

  <!-- Mini dashboard preview, bottom-right -->
  <g transform="translate(${W - 380},120)">
    <!-- Outer card -->
    <rect x="0" y="0" width="320" height="380" rx="14" fill="url(#panelBg)" stroke="#2a4773" stroke-width="1"/>

    <!-- Top bar -->
    <circle cx="20" cy="22" r="5" fill="#ef4444"/>
    <circle cx="38" cy="22" r="5" fill="#f59e0b"/>
    <circle cx="56" cy="22" r="5" fill="#22c55e"/>
    <text x="80" y="27" font-family="Inter,system-ui,sans-serif" font-size="12" fill="#94a3b8">runs · last 7d</text>

    <!-- Line chart -->
    <polyline fill="none" stroke="url(#line)" stroke-width="3"
      points="20,140 50,120 80,128 110,90 140,110 170,70 200,80 230,55 260,70 290,40"/>
    <line x1="20" y1="160" x2="300" y2="160" stroke="#2a4773" stroke-width="1"/>

    <!-- Bar group -->
    <g transform="translate(20,180)">
      <rect x="0"   y="40" width="20" height="40" fill="#7dd3fc" rx="2"/>
      <rect x="30"  y="20" width="20" height="60" fill="#7dd3fc" rx="2"/>
      <rect x="60"  y="30" width="20" height="50" fill="#7dd3fc" rx="2"/>
      <rect x="90"  y="10" width="20" height="70" fill="#3b82f6" rx="2"/>
      <rect x="120" y="25" width="20" height="55" fill="#7dd3fc" rx="2"/>
      <rect x="150" y="5"  width="20" height="75" fill="#3b82f6" rx="2"/>
      <rect x="180" y="35" width="20" height="45" fill="#7dd3fc" rx="2"/>
      <rect x="210" y="20" width="20" height="60" fill="#7dd3fc" rx="2"/>
      <rect x="240" y="0"  width="20" height="80" fill="#3b82f6" rx="2"/>
    </g>

    <!-- Caption -->
    <text x="20" y="350" font-family="Inter,system-ui,sans-serif" font-size="12" fill="#94a3b8">cost · agent · capability</text>
  </g>

  <!-- Brand chip, bottom-left -->
  <g transform="translate(80,${H - 80})">
    <circle cx="20" cy="-8" r="14" fill="#7dd3fc" />
    <text x="50" y="0" font-family="Inter,system-ui,sans-serif" font-size="28" font-weight="600" fill="#ffffff">ALDO AI</text>
  </g>

  <!-- URL chip, bottom-right -->
  <g transform="translate(${W - 280},${H - 80})">
    <text font-family="Inter,system-ui,sans-serif" font-size="22" fill="#94a3b8">ai.aldo.tech</text>
  </g>
</svg>`;

  return new Response(svg, {
    headers: {
      'Content-Type': 'image/svg+xml; charset=utf-8',
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return `${s.slice(0, n - 1)}…`;
}
