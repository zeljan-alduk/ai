/**
 * /examples — public reference gallery of real, useful projects
 * built end-to-end on the ALDO AI platform.
 *
 * The bar for inclusion is high: each entry must be a real, running
 * product with a public URL, built (or substantially built) by the
 * platform's own agency — not a contrived demo. The narrative on each
 * card calls out the brief, the agents that handled the work, and the
 * shipped artefact a visitor can click through to.
 *
 * First entry: picenhancer.aldo.tech — a local-only image upscaler
 * built in a single session against the in-house reference agency,
 * end-to-end on Apple Silicon Metal. Same VPS as ai.aldo.tech.
 *
 * Curated by hand for the same reason /changelog and /roadmap are: a
 * generated gallery would drift into "every demo we ever made" within
 * a quarter. Each example here is one we want a prospect to read.
 */

import Link from 'next/link';

export const metadata = {
  title: 'Examples — ALDO AI',
  description:
    'Real, useful products built on ALDO AI in hours, not weeks. Featured: picenhancer — a local-only image upscaler running entirely on Apple Silicon Metal.',
};

interface BuildLine {
  readonly when: string;
  readonly what: string;
}

interface Example {
  readonly slug: string;
  readonly name: string;
  readonly tagline: string;
  readonly liveUrl: string;
  readonly liveLabel: string;
  readonly hostedOn: string;
  readonly elapsed: string;
  readonly cost: string;
  readonly stack: readonly string[];
  readonly summary: readonly string[];
  /** Step-by-step "how the platform built it" timeline. */
  readonly build: readonly BuildLine[];
  /** Which in-house agents touched the work. */
  readonly agents: readonly string[];
}

const EXAMPLES: readonly Example[] = [
  {
    slug: 'picenhancer',
    name: 'picenhancer',
    tagline:
      'A local-only image upscaler. Drop, paste, or click an image — get back a ×4, ×8, or ×16 enhanced version in seconds, no signup, $0 cost, your image never leaves the box.',
    liveUrl: '/live/picenhancer',
    liveLabel: 'ai.aldo.tech/live/picenhancer',
    hostedOn: 'Hosted under ai.aldo.tech — no separate domain, no DNS round-trip',
    elapsed: 'Brief → live, working product in a single afternoon',
    cost: '$0 per enhancement (no cloud egress)',
    stack: [
      'Real-ESRGAN-ncnn-vulkan on Apple Silicon Metal',
      'Hono server (Node 23, tsx)',
      'ALDO AI strategist agent (qwen3:14b on Ollama)',
      'Server-Sent Events for live progress',
    ],
    summary: [
      'One screen. Drop an image, get a better one back. Three scale options (×4, ×8, ×16). Live progress bar tied to real Real-ESRGAN tile-by-tile output.',
      'Privacy as a product feature: the badge above the fold ("processed entirely on your machine") is enforceable, not marketing copy. The platform router is configured local-only — a cloud model is physically unable to receive the image.',
      'Built with the same reference agency every other ALDO customer gets. The strategist that picks the upscaling model is a normal ALDO prompt; the team that scaffolded the page is a normal ALDO composite agent.',
    ],
    build: [
      {
        when: 'Minute 0',
        what: 'Founder typed the brief into the prompts UI: "online site, simple UI, upload image, AI improves quality." Product-strategist agent expanded it into a one-page spec.',
      },
      {
        when: 'Minute 8',
        what: 'tech-lead composite agent ran. It fanned out to architect (chose Real-ESRGAN over diffusion for latency), ml-engineer (picked the x4plus model), ux-researcher (drafted the drop-zone-first layout), and security-auditor (locked the privacy tier).',
      },
      {
        when: 'Minute 22',
        what: 'Hono server scaffolded by the agency, wrapping realesrgan-ncnn-vulkan as a child process. /enhance returns Server-Sent Events so the bar can move on real progress, not a fake spinner.',
      },
      {
        when: 'Minute 38',
        what: 'Single-page front-end shipped: drop / paste / click upload, segmented ×4/×8/×16 picker, live progress bar, side-by-side before/after, download link.',
      },
      {
        when: 'Minute 52',
        what: 'Smoke-tested 220×220 → 880×880 in 1.5s. Then 480×360 → 3840×2880 (×8, two chained passes) in 30s. All on local hardware, $0.',
      },
      {
        when: 'Same day',
        what: 'Mounted under ai.aldo.tech/live/picenhancer — no DNS, no new TLS cert, no separate domain. The Next.js route proxies /enhance to the pixmend backend; the same docker-compose stack co-locates the Hono server with the web app on the VPS.',
      },
    ],
    agents: [
      'product-strategist',
      'tech-lead',
      'architect',
      'ml-engineer',
      'ux-researcher',
      'security-auditor',
    ],
  },
];

export default function ExamplesPage() {
  return (
    <article className="mx-auto max-w-3xl px-4 py-16 sm:px-6 sm:py-20">
      <header className="border-b border-border pb-8">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-accent">
          Examples
        </p>
        <h1 className="mt-3 text-4xl font-semibold tracking-tight text-fg sm:text-5xl">
          Real products built on ALDO AI.
        </h1>
        <p className="mt-3 max-w-2xl text-base leading-relaxed text-fg-muted">
          Not demos. Not screenshots of a future state. Each entry below is a live, useful product
          built by ALDO&rsquo;s own in-house agency — usually in hours, not weeks — and is running
          on the public internet right now. Click through and use them.
        </p>
        <p className="mt-3 text-sm text-fg-muted">
          Want to ship something like this?{' '}
          <Link href="/signup" className="text-accent underline-offset-2 hover:underline">
            Sign up
          </Link>{' '}
          and brief the agency. Or read{' '}
          <Link href="/docs" className="text-accent underline-offset-2 hover:underline">
            the docs
          </Link>{' '}
          first.
        </p>
      </header>

      <div className="mt-12 space-y-12">
        {EXAMPLES.map((ex) => (
          <ExampleCard key={ex.slug} ex={ex} />
        ))}
      </div>

      <section className="mt-16 rounded-2xl border border-border bg-bg-elevated p-8">
        <h2 className="text-[20px] font-semibold tracking-tight text-fg">
          What goes on this page.
        </h2>
        <p className="mt-3 max-w-2xl text-[14px] leading-relaxed text-fg-muted">
          A project lands here when (1) a visitor can click the live link and use the thing,
          (2) most of the build was driven by ALDO agents (briefs, design, code, review), and
          (3) we can show the timeline honestly — including which agents ran, what they decided,
          and how long it actually took. If your team builds something that fits, email{' '}
          <a className="text-accent underline-offset-2 hover:underline" href="mailto:info@aldo.tech">
            info@aldo.tech
          </a>{' '}
          and we&rsquo;ll feature it.
        </p>
      </section>
    </article>
  );
}

function ExampleCard({ ex }: { ex: Example }) {
  return (
    <section
      id={ex.slug}
      className="rounded-2xl border border-border bg-bg-elevated p-8 sm:p-10"
    >
      <div className="flex flex-wrap items-baseline gap-3">
        <h2 className="text-[26px] font-semibold tracking-tight text-fg">{ex.name}</h2>
        <span className="rounded-full bg-success/12 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-success ring-1 ring-success/30">
          live
        </span>
        <span className="rounded-full bg-accent/12 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-accent ring-1 ring-accent/30">
          built with ALDO
        </span>
      </div>
      <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-fg-muted">{ex.tagline}</p>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        {ex.liveUrl.startsWith('/') ? (
          <Link
            href={ex.liveUrl}
            className="inline-flex items-center gap-1.5 rounded-md bg-accent px-4 py-2 text-sm font-semibold text-bg transition-opacity hover:opacity-90"
          >
            Open {ex.liveLabel}
            <span aria-hidden>→</span>
          </Link>
        ) : (
          <a
            href={ex.liveUrl}
            target="_blank"
            rel="noopener"
            className="inline-flex items-center gap-1.5 rounded-md bg-accent px-4 py-2 text-sm font-semibold text-bg transition-opacity hover:opacity-90"
          >
            Open {ex.liveLabel}
            <span aria-hidden>↗</span>
          </a>
        )}
        <span className="text-[12px] text-fg-faint">{ex.hostedOn}</span>
      </div>

      <dl className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Fact label="Time to ship" value={ex.elapsed} />
        <Fact label="Cost per use" value={ex.cost} />
      </dl>

      <h3 className="mt-8 text-[11px] font-semibold uppercase tracking-[0.14em] text-fg-muted">
        What it is
      </h3>
      <ul className="mt-3 space-y-3 text-[14px] leading-relaxed text-fg-muted">
        {ex.summary.map((line, i) => (
          <li key={i} className="flex gap-3">
            <span aria-hidden className="mt-2 h-1 w-1 shrink-0 rounded-full bg-accent" />
            <span>{line}</span>
          </li>
        ))}
      </ul>

      <h3 className="mt-8 text-[11px] font-semibold uppercase tracking-[0.14em] text-fg-muted">
        How ALDO built it
      </h3>
      <ol className="mt-3 space-y-4">
        {ex.build.map((b, i) => (
          <li key={i} className="grid grid-cols-1 gap-2 sm:grid-cols-[7rem,1fr] sm:gap-5">
            <div className="font-mono text-[12px] uppercase tracking-wider text-fg-faint sm:pt-0.5">
              {b.when}
            </div>
            <div className="text-[14px] leading-relaxed text-fg">{b.what}</div>
          </li>
        ))}
      </ol>

      <h3 className="mt-8 text-[11px] font-semibold uppercase tracking-[0.14em] text-fg-muted">
        Agents involved
      </h3>
      <div className="mt-3 flex flex-wrap gap-2">
        {ex.agents.map((a) => (
          <span
            key={a}
            className="rounded-md border border-border bg-bg px-2.5 py-1 font-mono text-[12px] text-fg"
          >
            {a}
          </span>
        ))}
      </div>

      <p className="mt-8 border-t border-border pt-5 text-[13px] text-fg-muted">
        The same pattern is yours: brief the agency, watch the composite run, ship the artefact.
        Read the{' '}
        <Link href="/docs" className="text-accent underline-offset-2 hover:underline">
          docs
        </Link>{' '}
        or{' '}
        <Link href="/signup" className="text-accent underline-offset-2 hover:underline">
          sign up
        </Link>
        .
      </p>
    </section>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-bg p-3">
      <dt className="text-[10px] font-semibold uppercase tracking-[0.12em] text-fg-faint">
        {label}
      </dt>
      <dd className="mt-1 text-[14px] text-fg">{value}</dd>
    </div>
  );
}
