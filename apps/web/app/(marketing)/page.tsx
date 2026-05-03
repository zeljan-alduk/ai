/**
 * Homepage — `/`.
 *
 * Public, server-rendered (a handful of sections are client islands
 * for interactivity: SDK tab-switcher, MCP copy-config grid, demo
 * loop, section nav rail). The page is the marketing showcase for
 * the platform, organised as a single narrative arc:
 *
 *   Hook            → Hero + TrustStrip
 *   Why-unique      → FiveThings + Architecture
 *   How-it-works    → DefineAnAgent + UseCases + ReplayAcrossModels
 *                     + CliQuickstart
 *   Personas        → BuiltForTheWayYouWork
 *   Proof           → HonestComparisonV2 + McpIntegrations + StatsStrip
 *                     + BuiltInTheOpen + CompliancePosture
 *   Pricing         → PricingTeaser
 *   Resources / FAQ → ResourceHub + Faq
 *   Final CTA       → DualCta
 *
 * Wave-iter-2 dedupe:
 *   - Removed the inline `Features` 6-card section (FiveThings already
 *     covers the differentiators with richer visuals).
 *   - Removed the inline `Builders` "we use ALDO to build ALDO" section
 *     (the new BuiltInTheOpen panel makes this explicit with the cadence
 *     timeline + repo facts; we don't say it twice).
 *   - Removed the inline `HowItWorks` 4-step list (the new CliQuickstart
 *     terminal does the same job with motion + a real CLI).
 *
 * Honest copy guard-rails:
 *   - No specific cloud-provider names (LLM-agnostic). Where we name
 *     a provider it is as a runtime identifier (Ollama, vLLM, …) or a
 *     comparison row label (LangSmith, Braintrust, CrewAI), never as
 *     "the model".
 *   - No fake testimonials, no fabricated stats, no implied compliance.
 *   - Every link in the page resolves to a real route — clicking
 *     anything must land on a real surface.
 *   - The replay demo + CLI typewriter are CSS keyframe animations.
 *     No video, no animation lib, no recorded reel.
 *
 * Test-contract pinning:
 *   - The hero h1 string matches `/run real software-engineering/i`
 *     (golden-path.spec.ts + auth.spec.ts).
 *   - The primary CTA href is `/signup` (auth + responsive specs).
 *   - Don't change either without updating those specs together.
 */

import { ArchitectureDiagram } from '@/components/marketing/architecture-diagram';
import { BuiltForTheWayYouWork } from '@/components/marketing/built-for-the-way-you-work';
import { BuiltInTheOpen } from '@/components/marketing/built-in-the-open';
import { CliQuickstart } from '@/components/marketing/cli-quickstart';
import { CompliancePosture } from '@/components/marketing/compliance-posture';
import { DefineAnAgent } from '@/components/marketing/define-an-agent';
import { DualCta } from '@/components/marketing/dual-cta';
import { EcosystemGrid } from '@/components/marketing/ecosystem-grid';
import { Faq } from '@/components/marketing/faq';
import { FiveThings } from '@/components/marketing/five-things';
import { FounderStory } from '@/components/marketing/founder-story';
import { HeroCodeSnippet } from '@/components/marketing/hero-code-snippet';
import { HeroDashboardCycle } from '@/components/marketing/hero-dashboard-cycle';
import { HonestComparisonV2 } from '@/components/marketing/honest-comparison-v2';
import { McpIntegrations } from '@/components/marketing/mcp-integrations';
import { NewsletterSignup } from '@/components/marketing/newsletter-signup';
import { PlatformDemoLoop } from '@/components/marketing/platform-demo-loop';
import { PricingTeaser } from '@/components/marketing/pricing-teaser';
import { ProductSurfacesInMotion } from '@/components/marketing/product-surfaces';
import { ReplayAcrossModels } from '@/components/marketing/replay-across-models';
import { ResourceHub } from '@/components/marketing/resource-hub';
import { SectionNavRail } from '@/components/marketing/section-nav-rail';
import { StatsStrip } from '@/components/marketing/stats-strip';
import { TrustStrip } from '@/components/marketing/trust-strip';
import { UseCases } from '@/components/marketing/use-cases';
import Link from 'next/link';

export const metadata = {
  title: 'ALDO AI — the control plane for agent teams',
  description:
    'Run real software-engineering teams of LLM agents. Privacy enforced by the platform. Local models first-class. Every run replayable. 14-day trial, no card.',
  openGraph: {
    title: 'ALDO AI — the control plane for agent teams',
    description:
      'Privacy enforced by the platform, not the prompt. Local models first-class. Every run replayable.',
    url: 'https://ai.aldo.tech',
    siteName: 'ALDO AI',
    locale: 'en_US',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'ALDO AI — the control plane for agent teams',
    description:
      'Privacy enforced by the platform. Local models first-class. Every run replayable.',
  },
};

export default function HomePage() {
  return (
    <>
      {/* Sticky right-edge nav rail (lg+ only). Hidden on mobile so the
          page reads top-to-bottom without crowding a small viewport. */}
      <SectionNavRail />

      {/* HOOK ─── what we are, and the promise. */}
      <Hero />
      <TrustStrip />

      {/* WHY-UNIQUE ─── the five lines no one else stacks, then the
          one-glance picture of the architecture. */}
      <FiveThings />
      <Architecture />

      {/* SHOW-DON'T-TELL ─── iter-3: the six product surfaces with
          annotated mockups. Closes the "every competitor leads with
          screenshots, we ship zero" gap. Sits between Architecture
          (bg-elevated) and DefineAnAgent (bg-elevated) so its bg-bg
          breaks the otherwise-consecutive elevated stripe. */}
      <ProductSurfacesInMotion />

      {/* HOW-IT-WORKS ─── define the agent, see real scenarios, watch
          a step replay across models, then run it from the CLI. */}
      <DefineAnAgent />
      <UseCases />
      <ReplayAcrossModels />
      <CliQuickstart />

      {/* PERSONAS ─── three rooms in the same house. */}
      <BuiltForTheWayYouWork />

      {/* PROOF ─── honest comparison · ecosystem · MCP · stats ·
          source-available cadence · compliance posture. */}
      <HonestComparisonV2 />
      {/* iter-3: ecosystem grid — proves the LLM-agnostic invariant
          visually, with typographic-only badges (no real vendor logos
          to keep licensing clean). */}
      <EcosystemGrid />
      <McpIntegrations />
      <StatsStrip />
      <BuiltInTheOpen />
      <CompliancePosture />

      {/* PRICING ─── teaser, then deep link to the full table. */}
      <PricingTeaser />

      {/* RESOURCES + FAQ ─── twelve doors deeper, then the six
          questions we get every week. */}
      <ResourceHub />
      <FaqSection />

      {/* iter-3: community capture — weekly digest signup + 3 recent
          changelog snippets. Posts to /v1/newsletter/subscribe. */}
      <NewsletterSignup />

      {/* iter-3: the founder story. Single column, prose-shaped, no
          graphics. The four convictions that drove the platform's
          non-negotiables (CLAUDE.md). */}
      <FounderStory />

      {/* FINAL CTA ─── two ways in: cloud trial or self-host. */}
      <GetStartedSection />
    </>
  );
}

// Wrappers add the section IDs the nav rail targets without forcing
// the underlying components to know about the rail's existence.

function FaqSection() {
  return (
    <div id="faq">
      <Faq />
    </div>
  );
}

function GetStartedSection() {
  return (
    <div id="get-started">
      <DualCta />
    </div>
  );
}

function Architecture() {
  return (
    <section id="architecture" className="border-t border-border bg-bg-elevated">
      <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6 sm:py-20">
        <div className="mb-10 max-w-2xl">
          <p className="text-[11px] uppercase tracking-wider text-accent">Architecture</p>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight text-fg">
            One picture. Privacy enforced by the platform, not the prompt.
          </h2>
          <p className="mt-2 text-sm text-fg-muted">
            Every request passes through the privacy-tier router. Sensitive agents are
            <em> physically</em> incapable of reaching a cloud model — the router fails closed
            before a token leaves your tenant boundary.
          </p>
        </div>
        {/* The container can scroll horizontally on narrow viewports
            because the SVG has a fixed 700-unit viewBox. axe-core's
            `scrollable-region-focusable` rule (WCAG 2.1.1 keyboard)
            requires any scrollable region to be reachable by keyboard
            and to expose its purpose to assistive tech — hence the
            tabIndex, role, aria-label, and visible focus ring. */}
        <section
          className="overflow-x-auto rounded-xl border border-border bg-bg p-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:p-6"
          // biome-ignore lint/a11y/noNoninteractiveTabindex: scrollable region must be keyboard-reachable per WCAG 2.1.1 (axe-core scrollable-region-focusable). The tabIndex IS the fix.
          tabIndex={0}
          aria-label="ALDO AI platform architecture diagram"
        >
          <ArchitectureDiagram />
        </section>
        <p className="mt-3 text-[11px] text-fg-faint">
          Cloud-vs-local is decided by the agent&rsquo;s declared capability class and privacy tier.
          No code path names a provider.
        </p>
      </div>
    </section>
  );
}

function Hero() {
  return (
    <section className="relative overflow-hidden">
      {/* Wave-14C — animated gradient blob behind the headline.
          Pure CSS keyframes; no JS. `prefers-reduced-motion` aware. */}
      <div aria-hidden className="aldo-hero-blob" />
      <div className="relative mx-auto max-w-6xl px-4 pt-16 pb-12 sm:px-6 sm:pt-24 sm:pb-16">
        <div className="grid grid-cols-1 items-start gap-10 lg:grid-cols-12 lg:gap-12">
          {/* Left — pitch + CTAs. */}
          <div className="lg:col-span-6">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-accent">
              The control plane for agent teams
            </p>
            <h1 className="mt-3 text-4xl font-semibold tracking-tight text-fg sm:text-[2.85rem] lg:text-[3.1rem] lg:leading-[1.05]">
              Run real software-engineering teams of LLM agents.
            </h1>
            <p className="mt-5 max-w-xl text-lg leading-relaxed text-fg-muted">
              Privacy enforced by the platform, not the prompt. Local models first-class. Every run
              replayable. The control plane the agent stack has been missing.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link
                href="/signup"
                className="rounded bg-accent px-4 py-2.5 text-sm font-medium text-accent-fg transition-colors hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                Start free trial
              </Link>
              <Link
                href="/pricing"
                className="rounded border border-border bg-bg-elevated px-4 py-2.5 text-sm font-medium text-fg transition-colors hover:bg-bg-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                See pricing
              </Link>
            </div>
            <p className="mt-4 text-xs text-fg-muted">
              14-day trial, no card required. Honest pricing,{' '}
              <Link className="underline hover:text-fg" href="/pricing">
                plans from $29/mo
              </Link>
              .
            </p>
            <div className="mt-10 rounded-xl border border-border bg-bg-subtle p-5">
              <p className="text-sm font-semibold text-fg">Self-hosted or on-prem?</p>
              <p className="mt-1 text-sm text-fg-muted">
                Packaged build, dedicated support, custom MSA — all on the Enterprise tier.
              </p>
              <a
                href="mailto:info@aldo.tech?subject=ALDO%20AI%20%E2%80%94%20self-host%20inquiry"
                className="mt-3 inline-flex rounded bg-accent px-3 py-1.5 text-sm font-medium text-accent-fg transition-colors hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                Talk to us → info@aldo.tech
              </a>
            </div>
          </div>

          {/* Right — code snippet + cycling dashboard + 60s demo.
              The HeroCodeSnippet ships static (LCP element on every
              viewport) and stays the test-contract-pinned visual.
              HeroDashboardCycle is a lg+-only secondary visual that
              auto-rotates through three product frames; mobile users
              keep the lightweight original. */}
          <div className="lg:col-span-6">
            <HeroCodeSnippet />
            <p className="mt-3 text-center text-[11px] text-fg-muted">
              An agent is a YAML file — versioned, eval-gated, privacy-tagged. No Python class
              hierarchies. No vendor names.
            </p>
            {/* iter-3: auto-cycling dashboard mockup (lg+ only).
                Three frames, 6s each, opacity-only transitions —
                respects prefers-reduced-motion. */}
            <div className="mt-6">
              <HeroDashboardCycle />
            </div>
            {/* Auto-looping animated walkthrough below the snippet —
                showing actual platform mechanics, not a marketing reel. */}
            <div className="mt-8">
              <PlatformDemoLoop />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
