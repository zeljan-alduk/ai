/**
 * /roadmap — public, hand-curated forward-looking roadmap.
 *
 * Bar for inclusion: a customer or prospect would care that this is
 * coming, and we have enough conviction in the direction to commit
 * publicly. Internal refactors don't go here.
 *
 * Hand-curated rather than generated from issues / PRs — the same
 * reason /changelog is curated. A roadmap built from issue tags drifts
 * into "every TODO ever" within a quarter.
 *
 * Updates: prepend / move items as they advance through Now / Next /
 * Later. When something Now ships, MOVE it to /changelog (don't leave
 * it on the roadmap). Items in Maybe stay there until they land in
 * Later or get cut.
 */

import Link from 'next/link';
import type React from 'react';

export const metadata = {
  title: 'Roadmap — ALDO AI',
  description:
    'What we are building, what is next, and what we are not. Public and updated as work moves.',
};

interface Item {
  readonly title: string;
  readonly body: string;
  /** Optional tag to colour-code the row. */
  readonly tag?: 'platform' | 'web' | 'sdk' | 'security' | 'docs' | 'ops' | 'mcp' | 'eval';
  /**
   * Soft-confidence on date. Roadmap items don't ship a hard date —
   * they ship when the gates pass — but we surface the rough horizon
   * so a reader can plan around it.
   */
  readonly horizon?: string;
}

const TAG_BADGE: Record<NonNullable<Item['tag']>, string> = {
  platform: 'bg-accent/12 text-accent ring-accent/30',
  web: 'bg-accent/12 text-accent ring-accent/30',
  sdk: 'bg-success/12 text-success ring-success/30',
  security: 'bg-danger/12 text-danger ring-danger/30',
  docs: 'bg-warning/12 text-warning ring-warning/30',
  ops: 'bg-fg-muted/15 text-fg-muted ring-border',
  mcp: 'bg-success/12 text-success ring-success/30',
  eval: 'bg-warning/12 text-warning ring-warning/30',
};

const NOW: ReadonlyArray<Item> = [
  {
    tag: 'platform',
    title: 'API ↔ engine bridge — soak + composite/MCP fully exercised',
    body: 'Bridge shipped 2026-05-03 with default API_INLINE_EXECUTOR=true and live local-discovery. Soaking now against real workloads; authoring tool-using composite demo agents (e.g. code-reviewer-local: aldo-fs read → local Ollama → review) so the composite + MCP paths are proven end-to-end, not just wired.',
    horizon: 'this week',
  },
  {
    tag: 'ops',
    title: 'mcp.aldo.tech hosted MCP endpoint — DNS + edge route',
    body: 'The Streamable-HTTP MCP server (@aldo-ai/mcp-platform) is built, tested, container ready. Pure ops follow-up: DNS A record, slovenia-transit nginx route to the new container, TLS via the existing certbot path, docker-compose entry. Once live, ChatGPT custom GPTs / Cursor / any HTTP-only MCP client can drive ALDO directly.',
    horizon: 'this week',
  },
  {
    tag: 'sdk',
    title: 'Publish Python + TypeScript SDKs and the VS Code extension',
    body: 'All three are dry-run green; the release workflows have confirm-version guards. Awaiting PyPI / npm / VSCE tokens + the VS Code Marketplace publisher account, then the workflows fire and the public install paths light up.',
    horizon: 'this week',
  },
];

const NEXT: ReadonlyArray<Item> = [
  {
    tag: 'platform',
    title: 'Stripe live billing — flip pricing CTAs to real checkout',
    body: 'Backend is 100% wired (webhook switchboard, subscription store, trial-gate, customer portal). Five env vars away from live: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SIGNING_SECRET, STRIPE_PRICE_SOLO, STRIPE_PRICE_TEAM, STRIPE_BILLING_PORTAL_RETURN_URL. Push secrets + redeploy and the pricing page is chargeable.',
    horizon: '1–2 weeks',
  },
  {
    tag: 'platform',
    title: 'Engine resolve-from-store of agent.promptRef',
    body: 'Wave-4 shipped prompts as first-class data with version history. The wire shape + UI are done; the engine still inlines prompt text. One-file follow-up in @aldo-ai/registry to read promptRef → fetch from prompts-store → cache per-run.',
    horizon: '1–2 weeks',
  },
  {
    tag: 'platform',
    title: 'Production PromptRunner via gateway',
    body: 'Today /v1/prompts/:id/test returns a deterministic stub. Wiring the real gateway through (capability routing, privacy enforcement, telemetry into usage_records) lights up the prompt playground end-to-end.',
    horizon: '1–2 weeks',
  },
  {
    tag: 'mcp',
    title: 'Git OAuth-app installation (GitHub + GitLab)',
    body: 'The wave-3 git integration ships with PAT auth — paste a PAT into the connect form. OAuth apps remove that step entirely: customers click "Install ALDO" on GitHub, repos are connected via the app installation token, no PAT minting required.',
    horizon: '1–2 weeks',
  },
  {
    tag: 'ops',
    title: 'OCI Helm chart publish workflow',
    body: 'charts/aldo-ai is in-repo, helm-lint clean, kubeconform 37/37 against k8s 1.31. Operators self-hosting today clone the repo. The publish workflow pushes the chart to ghcr.io so `helm install oci://ghcr.io/aldo-tech-labs/charts/aldo-ai` works, and the chart README on ArtifactHub becomes the docs entry point.',
    horizon: '1–2 weeks',
  },
  {
    tag: 'platform',
    title: 'Background scanner picks up inputs (today: re-spawns empty)',
    body: 'The scanner that recovers orphaned queued runs spawns the engine with empty inputs because runs.inputs_jsonb does not yet exist. New migration adds the column; POST /v1/runs persists the inputs alongside the queued row; scanner reads them back. Closes the only correctness gap in the recovery path.',
    horizon: '2 weeks',
  },
];

const LATER: ReadonlyArray<Item> = [
  {
    tag: 'security',
    title: 'SOC 2 Type 1 — auditor + evidence collection scaffolding',
    body: 'Multi-month elapsed — months of evidence + an auditor. Engineering posture is already tight (privacy-tier router, audit log, encrypted secrets, runbook, retention enforcement). The auditor relationship + Vanta-shape evidence platform is the next slice.',
    horizon: '1–2 quarters',
  },
  {
    tag: 'security',
    title: 'SSO / SAML on /login — mid-market unblock',
    body: 'Email + password is fine for solo + tiny team. The first 5+ seat customer needs OIDC + SAML. Identity-store schema, SCIM provisioning, and the /login UX flip are the three pieces.',
    horizon: '1 quarter',
  },
  {
    tag: 'platform',
    title: 'Per-row USD cost in eval-playground',
    body: 'The playground table reserves the cost column today but reports honest 0 because the gateway does not yet surface per-call USD on the response. Gateway change, not playground change.',
    horizon: '1 quarter',
  },
  {
    tag: 'platform',
    title: 'Spend dashboard SQL pivot',
    body: 'JS-side bucket fold beats 3 round-trips on pglite up to ~1M usage rows in a 90-day window. Once a tenant exceeds that, pivot to date_trunc + GROUP BY in Postgres. Documented at the bottom of routes/spend.ts.',
    horizon: 'when first tenant hits the threshold',
  },
  {
    tag: 'platform',
    title: 'Real-cluster Helm e2e (kind in CI + per-cloud nightly)',
    body: 'The chart lints + templates + kubeconforms green offline. To prevent a regression that lints but breaks on `helm install` against a real apiserver, add a kind-in-CI job and per-cloud (EKS / GKE / AKS) nightlies.',
    horizon: '1 quarter',
  },
  {
    tag: 'mcp',
    title: 'Bidirectional git sync — write agent edits back via PR',
    body: 'Today the wave-3 git integration is read-only: changes flow repo → ALDO. Bidirectional means an edit to an agent in /agents/[name] opens a PR in the connected repo. Net-new wedge — combined with the read-only sync, the repo becomes the source of truth and ALDO is the IDE.',
    horizon: '1 quarter',
  },
];

const MAYBE: ReadonlyArray<Item> = [
  {
    tag: 'platform',
    title: 'EU data residency — second region + tenant routing',
    body: 'Quarter-scale build. Only worth it for a confirmed EU customer who would not sign without it. Today\'s posture (single-region) is a procurement question we answer honestly; the build is a question we answer with cash on the table.',
  },
  {
    tag: 'platform',
    title: 'Long-tail observability exporters (Datadog, Grafana, OTLP, Slack)',
    body: 'Build 2–3 only when a named customer asks. The catalog approach is a procurement-checklist trap; we would rather ship the two integrations a real customer needs deeply than thirty integrations no one uses.',
  },
  {
    tag: 'web',
    title: 'Drag-drop visual workflow builder',
    body: 'Explicit non-goal per the platform invariants — the wedge is "agents are data" (YAML + git). Could become a yes if a customer with non-engineer authors ever needs it; would ship as one-way export to YAML so the source of truth stays declarative.',
  },
];

interface VisionItem {
  readonly theme: string;
  readonly title: string;
  readonly body: string;
}

const VISION_2027: ReadonlyArray<VisionItem> = [
  {
    theme: 'Hire-grade',
    title: 'Hiring an agent feels like hiring a contractor',
    body:
      'A non-engineer drops a brief into ALDO; the platform resolves the right team, hands them the right tools, runs the work with the privacy posture the org needs, and reports back with citations + cost. The agent registry, the eval harness, the privacy router, the spend dashboard — all of it disappears into one workflow: scope → run → review → ship. The reference agency we dogfood internally is the worked example everyone forks.',
  },
  {
    theme: 'Local 1st-class',
    title: 'Local frontier-class is the default for sensitive work',
    body:
      'By end-2027 a 70B-class open model on a developer laptop or a small on-prem box matches frontier on most non-research tasks. ALDO routes to it by default for privacy_tier=sensitive, and the eval harness proves on every promotion that the local route did not regress. Cloud is the surge buffer, not the substrate.',
  },
  {
    theme: 'Repo as truth',
    title: 'Bidirectional git sync — the repo is the agent IDE',
    body:
      'Agents live in a customer’s monorepo as YAML + system prompts; ALDO is the runtime + the review surface. PR opens with eval scores attached; merge promotes; rollback is `git revert`. No "ALDO console drift vs production" — the console IS the production view of the repo. Composes with every CI/CD pipeline that exists.',
  },
  {
    theme: 'Trust',
    title: 'SOC 2 Type 2, HIPAA, EU residency, FedRAMP Moderate in flight',
    body:
      'The compliance posture caught up to the engineering posture (which has always been ahead). Procurement reviews close in days, not quarters. The privacy-tier router is auditable end-to-end and survives every red-team / pen-test cycle.',
  },
  {
    theme: 'Distribution',
    title: 'mcp.aldo.tech is the way most clients reach ALDO',
    body:
      'Hosted MCP endpoint with per-tenant auth, observability, and rate limits. Claude Desktop / Claude Code / Cursor / ChatGPT GPTs / Continue / Zed / Windsurf / VS Code all drop one config block and have the entire ALDO surface (agents, runs, datasets, evals) at their fingertips. The platform spreads through the protocol it was built around, not through SDKs we have to ship one-by-one.',
  },
  {
    theme: 'Self-host',
    title: 'Helm chart on ArtifactHub; Terraform modules per cloud',
    body:
      'A regulated customer goes from "we want this" to a running internal ALDO in under 4 hours with our docs + their existing k8s. The chart is real-cluster validated nightly across EKS / GKE / AKS / kind; Terraform modules cover IRSA / Workload Identity bindings. The "Enterprise — packaged build" line on the pricing page is a download URL, not marketing copy.',
  },
  {
    theme: 'Observability',
    title: 'Trace search rivals Datadog APM for agent runs',
    body:
      'Span-level filters, latency + cost heatmaps, OTLP export to whatever the customer already has. The flame graph drills into the model call, the tool call, the sub-agent, the diff against the previous run. A platform engineer who has never seen ALDO can debug a customer’s agent regression in 5 minutes.',
  },
  {
    theme: 'Eval gate',
    title: 'Eval-gated promotion the industry copies',
    body:
      'The same rubric that scored an agent in the playground gates its promotion to production. Customers ship agents like services: every change has a test, every regression blocks the deploy, every rollback restores the prior known-good. Adoption of the eval-gated promotion pattern is itself one of our best growth channels.',
  },
  {
    theme: 'Customers',
    title: '20–50 paying teams; 3–5 lighthouse design partners',
    body:
      'Mix of small teams using ALDO Cloud and regulated orgs running self-host. Two named lighthouse partners are public references; three more are private. ARR > $2M with healthy gross margins. We grew without raising; if we raise, it’s for distribution, not survival.',
  },
];

const NOT: ReadonlyArray<{ readonly title: string; readonly body: string }> = [
  {
    title: 'Hyperscaler-shape managed cloud (Bedrock / Vertex / Foundry)',
    body: 'Wrong moat. Bedrock and friends own enterprise procurement + IAM + 15+ compliance certs each — we cannot beat them at their own game and we should not try.',
  },
  {
    title: 'LangChain-style framework',
    body: 'We are framework-agnostic by design. The platform invariant: every code path goes through the gateway by capability + privacy + cost. Adding a framework above that would re-introduce the lock-in we exist to prevent.',
  },
  {
    title: 'Vibe-coding studio',
    body: 'Other vendors say "not production-ready" out loud. We say the opposite: every primitive (specs, runs, evals, replays) is engineered to ship in production on day one.',
  },
];

export default function RoadmapPage() {
  return (
    <article className="mx-auto max-w-3xl px-4 py-16 sm:px-6 sm:py-20">
      <header className="border-b border-border pb-8">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-accent">
          Roadmap
        </p>
        <h1 className="mt-3 text-4xl font-semibold tracking-tight text-fg sm:text-5xl">
          What we&rsquo;re building.
        </h1>
        <p className="mt-3 max-w-2xl text-base leading-relaxed text-fg-muted">
          Hand-curated. Updated as work moves. Items here are commitments — when one ships it
          moves to{' '}
          <Link href="/changelog" className="text-accent underline-offset-2 hover:underline">
            the changelog
          </Link>
          , not down the page.
        </p>
        <p className="mt-3 text-sm text-fg-muted">
          Want to influence what&rsquo;s next? Email{' '}
          <a className="text-accent underline-offset-2 hover:underline" href="mailto:info@aldo.tech">
            info@aldo.tech
          </a>
          . Customer pulls move things.
        </p>
      </header>

      <Section
        kind="now"
        title="Now"
        subtitle="In flight this week. Either nearly done or actively coded against."
        items={NOW}
      />
      <Section
        kind="next"
        title="Next"
        subtitle="Confirmed direction. Picked up the moment Now clears."
        items={NEXT}
      />
      <Section
        kind="later"
        title="Later"
        subtitle="Committed. Sequenced behind Next based on customer pulls + dependencies."
        items={LATER}
      />
      <Section
        kind="maybe"
        title="Maybe"
        subtitle="Conditional. Lands only when a specific signal arrives."
        items={MAYBE}
      />

      <section className="mt-16 rounded-2xl border border-border bg-bg-elevated p-8">
        <div className="flex items-baseline gap-3">
          <h2 className="text-[20px] font-semibold tracking-tight text-fg">End of 2027 — 1.0</h2>
          <span className="rounded-full bg-accent/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-accent ring-1 ring-accent/30">
            vision
          </span>
        </div>
        <p className="mt-3 max-w-2xl text-[14px] leading-relaxed text-fg-muted">
          What ALDO AI looks like at the end of 2027. Not a list of features — the shape of the
          product when the next 18 months land. Subject to change as customers pull us in
          directions we haven&rsquo;t imagined yet, but this is the bet.
        </p>
        <ul className="mt-7 space-y-6">
          {VISION_2027.map((v) => (
            <li key={v.title} className="grid grid-cols-1 gap-3 sm:grid-cols-[8rem,1fr] sm:gap-6">
              <div className="font-mono text-[12px] uppercase tracking-wider text-fg-faint sm:pt-1">
                {v.theme}
              </div>
              <div>
                <h3 className="text-[15px] font-semibold tracking-tight text-fg">{v.title}</h3>
                <p className="mt-2 text-[14px] leading-relaxed text-fg-muted">{v.body}</p>
              </div>
            </li>
          ))}
        </ul>
        <p className="mt-8 text-[12px] italic text-fg-faint">
          If we land 70% of this, we&rsquo;ve built the first agent platform a real engineering
          org would standardise on instead of patching together LangSmith + Braintrust + a
          framework + a vendor SLA every quarter.
        </p>
      </section>

      <section className="mt-14">
        <h2 className="text-[18px] font-semibold tracking-tight text-fg">
          Explicitly{' '}
          <span className="text-fg-faint line-through decoration-fg-faint/50">not</span> doing
        </h2>
        <p className="mt-2 text-sm text-fg-muted">
          Listing these here so a prospect can disqualify us fast — your time matters more than
          our pipeline.
        </p>
        <ul className="mt-6 space-y-5">
          {NOT.map((n) => (
            <li key={n.title} className="rounded-lg border border-border bg-bg-elevated p-4">
              <div className="text-[14px] font-semibold tracking-tight text-fg">{n.title}</div>
              <p className="mt-1 text-[13px] leading-relaxed text-fg-muted">{n.body}</p>
            </li>
          ))}
        </ul>
      </section>

      <footer className="mt-16 rounded-xl border border-border bg-bg-elevated p-6">
        <h3 className="text-[15px] font-semibold tracking-tight text-fg">
          See what already shipped
        </h3>
        <p className="mt-2 text-[14px] leading-relaxed text-fg-muted">
          Hand-curated changelog updated on every meaningful release. Newest at the top.
        </p>
        <Link
          href="/changelog"
          className="mt-4 inline-flex rounded bg-accent px-4 py-2 text-sm font-medium text-bg transition-opacity hover:opacity-90"
        >
          View changelog →
        </Link>
      </footer>
    </article>
  );
}

function Section(props: {
  readonly kind: 'now' | 'next' | 'later' | 'maybe';
  readonly title: string;
  readonly subtitle: string;
  readonly items: ReadonlyArray<Item>;
}): React.JSX.Element {
  const KIND_ACCENT: Record<typeof props.kind, string> = {
    now: 'bg-success/15 text-success ring-success/30',
    next: 'bg-accent/15 text-accent ring-accent/30',
    later: 'bg-warning/15 text-warning ring-warning/30',
    maybe: 'bg-fg-muted/15 text-fg-muted ring-border',
  };
  return (
    <section className="mt-14">
      <div className="flex items-baseline gap-3">
        <h2 className="text-[18px] font-semibold tracking-tight text-fg">{props.title}</h2>
        <span
          className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ring-1 ${KIND_ACCENT[props.kind]}`}
        >
          {props.items.length} item{props.items.length === 1 ? '' : 's'}
        </span>
      </div>
      <p className="mt-2 text-sm text-fg-muted">{props.subtitle}</p>

      <ol className="mt-6 space-y-5">
        {props.items.map((it) => (
          <li
            key={it.title}
            className="grid grid-cols-1 gap-3 sm:grid-cols-[8rem,1fr] sm:gap-6"
          >
            <div className="font-mono text-[12px] text-fg-faint sm:pt-1">
              {it.horizon ?? '—'}
            </div>
            <div>
              <div className="flex items-baseline justify-between gap-3">
                <h3 className="text-[15px] font-semibold tracking-tight text-fg">{it.title}</h3>
                {it.tag !== undefined && (
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ring-1 ${TAG_BADGE[it.tag]}`}
                  >
                    {it.tag}
                  </span>
                )}
              </div>
              <p className="mt-2 text-[14px] leading-relaxed text-fg-muted">{it.body}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
