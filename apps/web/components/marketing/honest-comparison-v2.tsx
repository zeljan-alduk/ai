/**
 * Honest comparison v2.
 *
 * Compares ALDO to LangSmith / Braintrust / CrewAI, row-by-row, on the
 * surfaces we actually shipped through Wave-3 + Wave-4. ✅/❌/➖ glyphs.
 * Rows sorted so ALDO's wins float to the top — unique-to-us first,
 * then matched-parity, then competitor-wins last (we link to /vs/* for
 * the deep dive).
 *
 * Date-stamped. Re-verify quarterly. Source-of-truth deep-dives live
 * at /vs/braintrust, /vs/langsmith, /vs/crewai.
 */

import Link from 'next/link';

type Cell = 'yes' | 'no' | 'partial';

interface Row {
  readonly feature: string;
  readonly aldo: Cell;
  readonly langsmith: Cell;
  readonly braintrust: Cell;
  readonly crewai: Cell;
  readonly note?: string;
  readonly tier: 'unique' | 'parity' | 'theirs';
}

const ROWS: ReadonlyArray<Row> = [
  // ── Unique to ALDO (sort first) ─────────────────────────────────
  {
    feature: 'Privacy tier — fail-closed router',
    aldo: 'yes',
    langsmith: 'no',
    braintrust: 'no',
    crewai: 'no',
    note: 'Sensitive agents physically blocked from cloud. Author convention vs. router enforcement.',
    tier: 'unique',
  },
  {
    feature: 'Cross-model step replay',
    aldo: 'yes',
    langsmith: 'partial',
    braintrust: 'partial',
    crewai: 'no',
    note: 'LangGraph ships same-model time-travel; our fork routes the new step through any provider.',
    tier: 'unique',
  },
  {
    feature: 'Local-model first-class (5 runtimes probed)',
    aldo: 'yes',
    langsmith: 'partial',
    braintrust: 'partial',
    crewai: 'partial',
    note: 'Ollama, vLLM, llama.cpp, MLX, LM Studio — auto-discovered with per-model context.',
    tier: 'unique',
  },
  {
    feature: 'Eval-gated promotion (blocks regressions)',
    aldo: 'yes',
    langsmith: 'no',
    braintrust: 'no',
    crewai: 'no',
    note: 'Eval libs exist everywhere. Refusing to promote a version that fell below threshold does not.',
    tier: 'unique',
  },
  {
    feature: 'Git-synced agent specs',
    aldo: 'yes',
    langsmith: 'no',
    braintrust: 'no',
    crewai: 'no',
    note: 'Connect a repo, specs sync from aldo/agents/*.yaml on push. Net-new wedge.',
    tier: 'unique',
  },
  // ── At-parity (we match on it) ──────────────────────────────────
  {
    feature: 'Prompt versioning + diff + playground',
    aldo: 'yes',
    langsmith: 'yes',
    braintrust: 'yes',
    crewai: 'no',
    tier: 'parity',
  },
  {
    feature: 'Threads (chat-style transcripts)',
    aldo: 'yes',
    langsmith: 'yes',
    braintrust: 'partial',
    crewai: 'no',
    tier: 'parity',
  },
  {
    feature: 'Run sharing (public read-only links)',
    aldo: 'yes',
    langsmith: 'yes',
    braintrust: 'yes',
    crewai: 'no',
    tier: 'parity',
  },
  {
    feature: 'N-way run comparison (≥3)',
    aldo: 'yes',
    langsmith: 'partial',
    braintrust: 'yes',
    crewai: 'no',
    note: 'Up to 6 runs simultaneously, with median-deviation diff highlight.',
    tier: 'parity',
  },
  {
    feature: 'Tags + powerful trace search',
    aldo: 'yes',
    langsmith: 'yes',
    braintrust: 'yes',
    crewai: 'no',
    tier: 'parity',
  },
  {
    feature: 'Spend dashboard + budget alerts',
    aldo: 'yes',
    langsmith: 'yes',
    braintrust: 'partial',
    crewai: 'no',
    tier: 'parity',
  },
  {
    feature: 'Eval scorer playground',
    aldo: 'yes',
    langsmith: 'yes',
    braintrust: 'yes',
    crewai: 'no',
    tier: 'parity',
  },
  {
    feature: 'Template gallery + per-card fork',
    aldo: 'yes',
    langsmith: 'partial',
    braintrust: 'no',
    crewai: 'yes',
    tier: 'parity',
  },
  {
    feature: 'MCP Streamable HTTP (ChatGPT-ready)',
    aldo: 'yes',
    langsmith: 'no',
    braintrust: 'no',
    crewai: 'no',
    note: 'Self-host the HTTP transport today; mcp.aldo.tech operator-deploy is in flight.',
    tier: 'parity',
  },
  {
    feature: 'Helm chart + Terraform self-host',
    aldo: 'yes',
    langsmith: 'yes',
    braintrust: 'partial',
    crewai: 'no',
    note: 'charts/aldo-ai/ + AWS-EKS / GCP-GKE / Azure-AKS Terraform modules in-repo today.',
    tier: 'parity',
  },
  {
    feature: 'Command palette ⌘K',
    aldo: 'yes',
    langsmith: 'no',
    braintrust: 'yes',
    crewai: 'no',
    tier: 'parity',
  },
  {
    feature: 'Status page (in-house)',
    aldo: 'yes',
    langsmith: 'yes',
    braintrust: 'yes',
    crewai: 'no',
    tier: 'parity',
  },
  // ── Where they win (be honest) ──────────────────────────────────
  {
    feature: 'SOC 2 / HIPAA today',
    aldo: 'no',
    langsmith: 'yes',
    braintrust: 'yes',
    crewai: 'partial',
    note: 'SOC 2 Type 1 in flight, Type 2 follow-up. Be honest, link /security.',
    tier: 'theirs',
  },
  {
    feature: 'EU data residency',
    aldo: 'no',
    langsmith: 'yes',
    braintrust: 'yes',
    crewai: 'no',
    tier: 'theirs',
  },
];

const VERIFIED = '2026-05-03';

const CELL_LOOK: Record<Cell, { glyph: string; cls: string; aria: string }> = {
  yes: { glyph: '✓', cls: 'text-success', aria: 'yes' },
  no: { glyph: '✗', cls: 'text-fg-faint', aria: 'no' },
  partial: { glyph: '◐', cls: 'text-warning', aria: 'partial' },
};

const TIER_LABEL: Record<Row['tier'], { label: string; cls: string }> = {
  unique: {
    label: 'unique to ALDO',
    cls: 'border-success/30 bg-success/10 text-success',
  },
  parity: {
    label: 'at parity',
    cls: 'border-border bg-bg-subtle text-fg-muted',
  },
  theirs: {
    label: 'they win',
    cls: 'border-warning/30 bg-warning/10 text-warning',
  },
};

export function HonestComparisonV2() {
  return (
    <section id="comparison" className="border-t border-border bg-bg">
      <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-24">
        <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
          <div className="max-w-2xl">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-accent">
              Honest comparison
            </p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight text-fg sm:text-[2.1rem]">
              Where we win, where we tie, where they do.
            </h2>
            <p className="mt-3 text-base leading-relaxed text-fg-muted">
              Five lines we&rsquo;re alone on. Eleven where we&rsquo;ve closed parity in the last
              two waves. Two where the incumbents are still ahead — we&rsquo;ll catch up but
              we&rsquo;re not going to fudge the table.
            </p>
          </div>
          <div className="flex flex-wrap gap-2 text-[11px]">
            <Link
              href="/vs/langsmith"
              className="rounded-full border border-border bg-bg-elevated px-3 py-1 font-medium text-fg transition-colors hover:border-accent hover:text-accent"
            >
              vs LangSmith — deep dive
            </Link>
            <Link
              href="/vs/braintrust"
              className="rounded-full border border-border bg-bg-elevated px-3 py-1 font-medium text-fg transition-colors hover:border-accent hover:text-accent"
            >
              vs Braintrust
            </Link>
            <Link
              href="/vs/crewai"
              className="rounded-full border border-border bg-bg-elevated px-3 py-1 font-medium text-fg transition-colors hover:border-accent hover:text-accent"
            >
              vs CrewAI
            </Link>
          </div>
        </div>

        <div className="overflow-x-auto rounded-xl border border-border bg-bg-elevated shadow-sm">
          <table className="w-full text-left text-sm">
            <thead className="bg-bg-subtle text-[11px] uppercase tracking-wider text-fg-muted">
              <tr>
                <th className="px-4 py-3 font-semibold" scope="col">
                  Feature
                </th>
                <th className="px-4 py-3 text-center font-semibold" scope="col">
                  <span className="rounded bg-accent/10 px-2 py-0.5 text-accent">ALDO</span>
                </th>
                <th className="px-4 py-3 text-center font-semibold" scope="col">
                  LangSmith
                </th>
                <th className="px-4 py-3 text-center font-semibold" scope="col">
                  Braintrust
                </th>
                <th className="px-4 py-3 text-center font-semibold" scope="col">
                  CrewAI
                </th>
                <th className="px-4 py-3 text-right font-semibold" scope="col">
                  Tier
                </th>
              </tr>
            </thead>
            <tbody>
              {ROWS.map((r) => (
                <tr key={r.feature} className="border-t border-border align-top">
                  <td className="px-4 py-3">
                    <div className="font-medium text-fg">{r.feature}</div>
                    {r.note ? (
                      <div className="mt-1 text-[11.5px] leading-relaxed text-fg-faint">
                        {r.note}
                      </div>
                    ) : null}
                  </td>
                  <Cell value={r.aldo} bold />
                  <Cell value={r.langsmith} />
                  <Cell value={r.braintrust} />
                  <Cell value={r.crewai} />
                  <td className="px-4 py-3 text-right">
                    <span
                      className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${TIER_LABEL[r.tier].cls}`}
                    >
                      {TIER_LABEL[r.tier].label}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t-2 border-border bg-bg-subtle text-[11px] text-fg-muted">
              <tr>
                <td className="px-4 py-3" colSpan={6}>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <span>
                      <span className="font-mono">✓</span> shipped &nbsp;·&nbsp;
                      <span className="font-mono text-warning">◐</span> partial &nbsp;·&nbsp;
                      <span className="font-mono text-fg-faint">✗</span> not yet
                    </span>
                    <span>
                      Last verified: <span className="font-mono">{VERIFIED}</span>. Re-verified
                      quarterly.{' '}
                      <a className="underline hover:text-fg" href="mailto:info@aldo.tech">
                        Spot a stale row?
                      </a>
                    </span>
                  </div>
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </section>
  );
}

function Cell({ value, bold }: { value: Cell; bold?: boolean }) {
  const look = CELL_LOOK[value];
  return (
    <td className="px-4 py-3 text-center">
      <span
        className={`font-mono text-[16px] ${look.cls} ${bold ? 'font-bold' : ''}`}
        aria-label={look.aria}
      >
        {look.glyph}
      </span>
    </td>
  );
}
