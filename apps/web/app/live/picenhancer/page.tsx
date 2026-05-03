/**
 * /live/picenhancer — the running instance of the picenhancer reference
 * build, hosted under the ai.aldo.tech domain so we don't have to mint
 * a separate hostname / TLS cert / DNS record. The Examples card on
 * /examples links here.
 *
 * The page is a thin React port of /tmp/pixmend-stack/public/index.html
 * — same drop/paste/click upload, same ×4/×8/×16 segmented scale
 * picker, same SSE-driven progress bar. Form submissions and result
 * fetches go through this app's own API routes, which proxy to the
 * pixmend Hono backend (PIXMEND_BACKEND_URL env, default
 * http://127.0.0.1:4000). When the backend isn't reachable, the proxy
 * returns 503 with a clear message and the UI surfaces it inline so a
 * visitor knows the runtime is provisioning.
 *
 * Marketing chrome (top-nav + footer) wraps this page automatically
 * because it sits under app/live/* — outside the (marketing) route
 * group but inside the same root layout.
 */

import type { Metadata } from 'next';
import Link from 'next/link';
import { PicenhancerClient } from './client';

export const metadata: Metadata = {
  title: 'picenhancer — live · ALDO AI Examples',
  description:
    'Drop, paste, or click an image. Get back a ×4, ×8, or ×16 enhanced version in seconds. Local AI, no signup, your image never leaves the box.',
};

export default function PicenhancerLivePage() {
  return (
    <article className="mx-auto max-w-3xl px-4 py-12 sm:px-6 sm:py-16">
      <header className="border-b border-border pb-6">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-accent">
          Live · Examples
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-fg sm:text-4xl">
          picenhancer
          <span className="ml-3 align-middle text-[10px] font-semibold uppercase tracking-wider text-accent ring-1 ring-accent/30 rounded-full px-2 py-0.5 bg-accent/12">
            built on ALDO
          </span>
        </h1>
        <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-fg-muted">
          Drop, paste, or click an image. Get a better one back. Local AI, no signup, your image
          never leaves the box. Read{' '}
          <Link href="/examples#picenhancer" className="text-accent underline-offset-2 hover:underline">
            how it was built
          </Link>
          .
        </p>
        <p className="mt-3 text-[13px] text-accent">
          🔒 GFPGAN v1.4 face restoration (default) + optional Real-ESRGAN x4 upscale, run
          entirely on this server via PyTorch CPU. No cloud, no third-party API, no telemetry,
          $0. Enhance ≈ 5–15 s; upscale modes ≈ 15–30 s.
        </p>
      </header>

      <PicenhancerClient />

      <footer className="mt-12 border-t border-border pt-5 text-[12px] text-fg-muted">
        Stack: <code className="font-mono text-fg">Real-ESRGAN x4</code> generative SR +{' '}
        <code className="font-mono text-fg">GFPGAN v1.4</code> face restoration via PyTorch CPU
        (the canonical reference pipeline; no GPU). Lanczos extension for ×8 / ×16. Hono
        backend, proxied through Next.js. Source briefs + agents:{' '}
        <Link href="/examples#picenhancer" className="text-accent underline-offset-2 hover:underline">
          /examples
        </Link>
        .
      </footer>
    </article>
  );
}
