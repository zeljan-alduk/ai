/**
 * "Compliance posture, no marketing" — three columns: Today / In flight
 * / Not yet. Glyphs (✅ / ⏳ / ❌) are intentionally honest — we don't
 * fake a compliance badge to win a comparison row.
 *
 * Source-of-truth: STATUS.md "Compliance / posture" + the Known issues
 * table. Re-verify each wave.
 *
 * Server component, semantic tokens.
 */

import Link from 'next/link';

type Status = 'shipped' | 'inflight' | 'notyet';

interface Item {
  readonly text: string;
  readonly note?: string;
}

interface Column {
  readonly title: string;
  readonly subtitle: string;
  readonly status: Status;
  readonly items: ReadonlyArray<Item>;
}

const COLUMNS: ReadonlyArray<Column> = [
  {
    title: 'Today',
    subtitle: 'Shipped, deployed, audit-traceable.',
    status: 'shipped',
    items: [
      { text: 'Privacy-tier router (fail-closed at the edge)' },
      { text: 'FSL-1.1-ALv2 source-available licence', note: 'Apache 2.0 in 2 yrs' },
      { text: 'Audit log on every privileged action' },
      { text: 'Encrypted secrets at rest (SecretStore)' },
      { text: 'Configurable retention enforcement', note: 'job runs hourly' },
      { text: 'In-house status page (30s polling)' },
      { text: 'Operator runbook + support intake docs' },
      { text: 'Process-isolated tool execution' },
    ],
  },
  {
    title: 'In flight',
    subtitle: 'Active work, ETA this quarter or next.',
    status: 'inflight',
    items: [
      { text: 'SOC 2 Type 1 — kickoff', note: 'Type 2 follow-up' },
      { text: 'OCI Helm publish to ghcr.io', note: 'one-shot helm push' },
      { text: 'mcp.aldo.tech HTTP transport deploy', note: 'code + container ready' },
      { text: 'Git OAuth-app installation', note: 'eliminates PAT minting' },
    ],
  },
  {
    title: 'Not yet',
    subtitle: 'On the roadmap. We will not pretend otherwise.',
    status: 'notyet',
    items: [
      { text: 'SOC 2 Type 2' },
      { text: 'SSO / SAML' },
      { text: 'EU data residency', note: 'single-region today' },
      { text: 'FedRAMP' },
      { text: 'HIPAA BAA' },
      { text: 'ISO 27001 / 27017 / 27018' },
    ],
  },
];

const STATUS_GLYPH: Record<Status, string> = {
  shipped: '✓',
  inflight: '◐',
  notyet: '✗',
};

const STATUS_TEXT: Record<Status, string> = {
  shipped: 'shipped',
  inflight: 'in progress',
  notyet: 'not yet',
};

const STATUS_RING: Record<Status, string> = {
  shipped: 'border-success/40 text-success',
  inflight: 'border-warning/40 text-warning',
  notyet: 'border-fg-faint/40 text-fg-faint',
};

const STATUS_HEADER: Record<Status, string> = {
  shipped: 'border-success/30 bg-success/5',
  inflight: 'border-warning/30 bg-warning/5',
  notyet: 'border-border bg-bg-subtle/40',
};

const STATUS_PILL: Record<Status, string> = {
  shipped: 'border-success/40 bg-success/10 text-success',
  inflight: 'border-warning/40 bg-warning/10 text-warning',
  notyet: 'border-border bg-bg-subtle text-fg-muted',
};

export function CompliancePosture() {
  return (
    <section id="compliance" className="border-t border-border bg-bg">
      <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-24">
        <div className="mb-10 flex flex-wrap items-end justify-between gap-4">
          <div className="max-w-2xl">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-accent">
              Compliance posture, no marketing
            </p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight text-fg sm:text-[2.1rem]">
              Three columns. No fudged glyphs.
            </h2>
            <p className="mt-3 text-base leading-relaxed text-fg-muted">
              The competitive scan has more{' '}
              <code className="rounded bg-bg-subtle px-1 py-0.5 font-mono text-[12.5px] text-fg">
                ✅
              </code>{' '}
              than us today — we&rsquo;re going to catch up, and we&rsquo;re going to be honest
              about what&rsquo;s shipped vs. what&rsquo;s on the roadmap. Source-of-truth:{' '}
              <Link
                href="/security"
                className="text-accent hover:text-accent-hover hover:underline"
              >
                /security
              </Link>
              .
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
          {COLUMNS.map((c) => (
            <article
              key={c.title}
              className={`flex flex-col rounded-xl border bg-bg-elevated shadow-sm ${STATUS_HEADER[c.status]}`}
            >
              <header className="border-b border-border px-5 py-4">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-[16px] font-semibold tracking-tight text-fg">{c.title}</div>
                  <span
                    className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${STATUS_PILL[c.status]}`}
                  >
                    {STATUS_TEXT[c.status]}
                  </span>
                </div>
                <p className="mt-1 text-[12.5px] leading-relaxed text-fg-muted">{c.subtitle}</p>
              </header>
              <ul className="flex-1 divide-y divide-border">
                {c.items.map((it) => (
                  <li key={it.text} className="flex items-start gap-3 px-5 py-3">
                    <span
                      className={`flex h-5 w-5 flex-none items-center justify-center rounded-full border font-mono text-[11px] font-bold ${STATUS_RING[c.status]}`}
                      aria-label={STATUS_TEXT[c.status]}
                    >
                      {STATUS_GLYPH[c.status]}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="text-[13.5px] leading-snug text-fg">{it.text}</div>
                      {it.note ? (
                        <div className="mt-0.5 text-[11.5px] leading-snug text-fg-faint">
                          {it.note}
                        </div>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </div>

        <div className="mt-8 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-bg-elevated p-5 text-sm text-fg-muted">
          <span>
            Buyers in regulated industries: this page is the conversation, not a closed door. Email
            and we&rsquo;ll walk through the open lines.
          </span>
          <Link
            href="/security"
            className="rounded border border-border bg-bg px-3 py-1.5 text-sm font-medium text-fg transition-colors hover:bg-bg-subtle"
          >
            Read the security page →
          </Link>
        </div>
      </div>
    </section>
  );
}
