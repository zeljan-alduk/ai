/**
 * OG image endpoint for docs pages.
 *
 * Returns a generated SVG sized 1200x630 (the canonical OG image
 * size). The SVG embeds the doc title in white-on-accent type with
 * a wordmark in the bottom-right. SVG-as-image is supported by
 * every major OG consumer (Slack, Discord, Twitter/X, Mastodon,
 * LinkedIn) and avoids the need for a Satori / Chromium pipeline.
 *
 * Query: `?title=...` — title to render, URL-encoded.
 *
 * Caches forever in the browser; the file is content-addressed by
 * the title string, so a title change naturally invalidates.
 *
 * LLM-agnostic: nothing in the OG generator names a provider.
 */

import type { NextRequest } from 'next/server';

const W = 1200;
const H = 630;

export function GET(req: NextRequest): Response {
  const title = req.nextUrl.searchParams.get('title') ?? 'ALDO AI Documentation';
  const safeTitle = escapeXml(truncate(title, 80));
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#0e1a2b" />
      <stop offset="100%" stop-color="#1d3358" />
    </linearGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#bg)" />
  <g transform="translate(80,120)">
    <text font-family="Inter,system-ui,sans-serif" font-size="32" font-weight="600" fill="#7dd3fc" letter-spacing="6">DOCUMENTATION</text>
    <foreignObject x="0" y="40" width="${W - 160}" height="380">
      <div xmlns="http://www.w3.org/1999/xhtml" style="font-family: Inter, system-ui, sans-serif; font-size: 72px; font-weight: 600; line-height: 1.1; color: #ffffff; word-break: break-word;">${safeTitle}</div>
    </foreignObject>
  </g>
  <g transform="translate(80,${H - 80})">
    <circle cx="20" cy="-8" r="14" fill="#7dd3fc" />
    <text x="50" y="0" font-family="Inter,system-ui,sans-serif" font-size="28" font-weight="600" fill="#ffffff">ALDO AI</text>
  </g>
  <g transform="translate(${W - 280},${H - 80})">
    <text font-family="Inter,system-ui,sans-serif" font-size="22" fill="#94a3b8">ai.aldo.tech/docs</text>
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
