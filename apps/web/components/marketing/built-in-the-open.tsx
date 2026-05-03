/**
 * "Built in the open" — source-available + shipping cadence.
 *
 * Two-pane section:
 *   - Left:  the licence story (FSL-1.1-ALv2 → Apache 2.0 in 2 yrs)
 *            with a "Star us on GitHub" CTA + a tiny grid of repo
 *            facts (migrations, tests, packages, surfaces, invariants).
 *   - Right: a vertical timeline of the most-recent 7 commits,
 *            HARDCODED at build time so production is deterministic
 *            (no runtime git access). Refresh via the snippet at the
 *            bottom of this file when the founder asks.
 *
 * The repo URL was confirmed in the brief: github.com/zeljan-alduk/ai.
 *
 * Server component. Pure semantic tokens. No JS.
 */

import Link from 'next/link';

const REPO_URL = 'https://github.com/zeljan-alduk/ai';

interface Commit {
  readonly hash: string;
  readonly subject: string;
  readonly tag: 'fix' | 'docs' | 'wave' | 'ci';
}

// Snapshot from `git log --oneline -7` on 2026-05-03. Refresh when
// the cadence narrative needs updating — see the snippet at file end.
const RECENT_COMMITS: ReadonlyArray<Commit> = [
  {
    hash: '928d1ac',
    subject: 'fix(migrations): self-heal Default project before 020/021 backfill',
    tag: 'fix',
  },
  {
    hash: '1861d67',
    subject: 'ci: drop kubectl apply --dry-run from helm-chart.yml (kubeconform covers it)',
    tag: 'ci',
  },
  {
    hash: 'c7e0efb',
    subject:
      'docs: add PROGRESS.md + PLANS.md (three-wave retrospective + leverage-ordered next actions)',
    tag: 'docs',
  },
  {
    hash: 'fc152d8',
    subject:
      'wave-4: frontend competitive-surface — prompts, threads, share, ⌘K, N-way compare, tags, spend',
    tag: 'wave',
  },
  {
    hash: '3ff4cc9',
    subject:
      'wave-3: competitive-gap closing — git sync, eval playground, gallery fork, MCP HTTP, Helm, retention, completeness',
    tag: 'wave',
  },
  {
    hash: '6e03160',
    subject:
      'wave-mvp: ship-readiness push — license, stripe, status, projects, termination, mcp, sdks, ops',
    tag: 'wave',
  },
  { hash: 'f3627f2', subject: 'docs: add STATUS.md + ROADMAP.md', tag: 'docs' },
];

const TAG_PILL: Record<Commit['tag'], string> = {
  fix: 'border-warning/30 bg-warning/10 text-warning',
  docs: 'border-border bg-bg-subtle text-fg-muted',
  wave: 'border-accent/30 bg-accent/10 text-accent',
  ci: 'border-success/30 bg-success/10 text-success',
};

interface RepoFact {
  readonly value: string;
  readonly label: string;
}

const REPO_FACTS: ReadonlyArray<RepoFact> = [
  { value: '26', label: 'sequential migrations' },
  { value: '1,184', label: 'tests across 9 packages' },
  { value: '50+', label: 'product surfaces' },
  { value: '4', label: 'platform invariants' },
];

const SNAPSHOT_DATE = '2026-05-03';

export function BuiltInTheOpen() {
  return (
    <section id="built-in-the-open" className="border-t border-border bg-bg-elevated">
      <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-24">
        <div className="mb-12 max-w-3xl">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-accent">
            Built in the open
          </p>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight text-fg sm:text-[2.1rem]">
            Read the source. Watch the shipping cadence.
          </h2>
          <p className="mt-3 text-base leading-relaxed text-fg-muted">
            ALDO is source-available from day one. The licence is honest, the cadence is public, and
            the receipts are the commits below. We dogfood the platform on its own repo — the agency
            directory ships an ALDO TECH LABS organization that runs against this codebase.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12 lg:gap-10">
          {/* Left — license + facts + CTA. */}
          <div className="lg:col-span-5">
            <div className="rounded-xl border border-border bg-bg p-6 shadow-sm">
              <div className="flex items-center gap-2">
                <span className="rounded-full border border-success/30 bg-success/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-success">
                  source-available
                </span>
                <span className="rounded-full border border-border bg-bg-subtle px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-fg-muted">
                  FSL-1.1-ALv2
                </span>
              </div>
              <h3 className="mt-4 text-[18px] font-semibold leading-snug text-fg">
                Functional Source Licence today, Apache 2.0 in two years.
              </h3>
              <p className="mt-2 text-[14px] leading-relaxed text-fg-muted">
                Read every line. Run it on your own infra. Modify it for your team. The two-year
                conversion to a permissive Apache 2.0 licence is built into the licence text — not a
                vendor promise. We don&rsquo;t ship a black box.
              </p>

              <dl className="mt-5 grid grid-cols-2 gap-3 border-t border-border pt-4">
                {REPO_FACTS.map((f) => (
                  <div key={f.label} className="rounded-lg border border-border bg-bg-elevated p-3">
                    <dt className="text-[10.5px] font-semibold uppercase tracking-wider text-fg-muted">
                      {f.label}
                    </dt>
                    <dd className="mt-1 font-mono text-[20px] font-semibold tabular-nums text-fg">
                      {f.value}
                    </dd>
                  </div>
                ))}
              </dl>

              <a
                href={REPO_URL}
                target="_blank"
                rel="noreferrer"
                className="mt-5 inline-flex items-center gap-2 rounded bg-accent px-3 py-2 text-sm font-medium text-accent-fg transition-colors hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                <GithubIcon />
                Star us on GitHub
                <span className="font-mono text-[11px] opacity-80">↗</span>
              </a>
              <p className="mt-3 text-[11.5px] leading-relaxed text-fg-faint">
                We use ALDO TECH LABS&rsquo; own agency to ship ALDO. The reference organisation in{' '}
                <code className="rounded bg-bg-subtle px-1 py-0.5 font-mono text-[11px]">
                  agency/
                </code>{' '}
                is the same one that lands in your tenant on signup.
              </p>
            </div>
          </div>

          {/* Right — shipping cadence timeline. */}
          <div className="lg:col-span-7">
            <div className="rounded-xl border border-border bg-bg p-6 shadow-sm">
              <div className="flex items-center justify-between">
                <h3 className="text-[15px] font-semibold text-fg">Shipping cadence</h3>
                <span className="font-mono text-[10.5px] text-fg-faint">
                  snapshot {SNAPSHOT_DATE} · last 7 commits
                </span>
              </div>

              <ol className="mt-5 space-y-3">
                {RECENT_COMMITS.map((c, idx) => (
                  <li key={c.hash} className="relative flex gap-4">
                    {/* Vertical rail */}
                    <div className="relative flex flex-none flex-col items-center">
                      <span className="z-10 flex h-6 w-6 items-center justify-center rounded-full border border-border bg-bg-elevated">
                        <span className="h-2 w-2 rounded-full bg-accent" aria-hidden />
                      </span>
                      {idx < RECENT_COMMITS.length - 1 ? (
                        <span
                          aria-hidden
                          className="absolute top-6 h-full w-px bg-border"
                          style={{ minHeight: '36px' }}
                        />
                      ) : null}
                    </div>

                    <div className="min-w-0 flex-1 pb-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <code className="rounded bg-bg-subtle px-1.5 py-0.5 font-mono text-[11px] font-semibold text-fg">
                          {c.hash}
                        </code>
                        <span
                          className={`rounded-full border px-2 py-0.5 text-[9.5px] font-semibold uppercase tracking-wider ${TAG_PILL[c.tag]}`}
                        >
                          {c.tag}
                        </span>
                      </div>
                      <p className="mt-1 text-[13.5px] leading-snug text-fg-muted">{c.subject}</p>
                      <a
                        href={`${REPO_URL}/commit/${c.hash}`}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-1 inline-flex text-[11.5px] font-medium text-accent hover:text-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                      >
                        view on GitHub →
                      </a>
                    </div>
                  </li>
                ))}
              </ol>

              <div className="mt-2 border-t border-border pt-4 text-[12px] text-fg-faint">
                Refresh via{' '}
                <code className="rounded bg-bg-subtle px-1 py-0.5 font-mono text-[11px]">
                  git log --oneline -7
                </code>{' '}
                — paste the literal subjects + hashes into the array at the top of this file.
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function GithubIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <title>GitHub</title>
      <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.4 3-.405 1.02.005 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
    </svg>
  );
}
