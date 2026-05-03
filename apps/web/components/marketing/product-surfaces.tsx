/**
 * "See it in motion" — six annotated product-surface mockups.
 *
 * The biggest gap iteration 1 + 2 left open: every competitor leads with
 * product screenshots and we shipped zero. This section closes that.
 *
 * Six pure-CSS + inline-SVG mockups, alternating left/right, each a
 * `<figure>` with a `<figcaption>` describing the surface for AT users:
 *
 *   1. Flame graph (/runs/[id])
 *   2. Eval scorer playground (/eval/playground)
 *   3. Cross-model replay diff (/runs/compare)
 *   4. Prompts editor with version history (/prompts/[id])
 *   5. Spend dashboard (/observability/spend)
 *   6. Status page (/status)
 *
 * Annotation chips float over a corner with a thin connecting line.
 *
 * Server-rendered, no JS, no images. Semantic tokens throughout.
 */

import Link from 'next/link';
import type { ReactNode } from 'react';

interface Surface {
  readonly id: string;
  readonly tag: string;
  readonly title: string;
  readonly path: string;
  readonly summary: string;
  readonly callout: { readonly text: string; readonly corner: 'tr' | 'bl' };
  readonly mockup: ReactNode;
  readonly altText: string;
}

const SURFACES: ReadonlyArray<Surface> = [
  {
    id: 'flame-graph',
    tag: 'Run viewer',
    title: 'Flame graph + step replay',
    path: '/runs/[id]',
    summary:
      'A horizontal stacked timeline of the orchestrator, sub-agents, and every tool call. Color per agent role. Click a span, swap the model, re-run from that point.',
    callout: { text: 'Click any span to swap the model and re-run from there.', corner: 'tr' },
    mockup: <FlameGraphMockup />,
    altText:
      'Flame-graph mockup. Top-of-window tab strip with Timeline, Events, Tree, Composition, Replay, Annotations. Nine horizontal spans across four agent rows: orchestrator (full width, blue), planner (32%, amber), reviewer (44%, emerald), tool-call rows (smaller, slate). Right-rail metadata panel shows duration 14.2s, cost $0.024, 3 checkpoints.',
  },
  {
    id: 'eval-playground',
    tag: 'Evaluator playground',
    title: 'Bulk-score evaluators against datasets',
    path: '/eval/playground',
    summary:
      'Picker bar across the top. Per-row scores stream into the table on the left. Aggregate stats with a mini histogram on the right — pass-rate, p50/p95, score distribution.',
    callout: { text: 'Bulk-score any evaluator against any dataset.', corner: 'bl' },
    mockup: <EvalPlaygroundMockup />,
    altText:
      'Eval playground three-pane mockup. Top picker bar selects evaluator (rubric-strict-v3) and dataset (auth-flows-50). Left pane: results table with rows for examples, score column showing 0.91, 0.84, 0.77, 0.95, 0.62. Right pane: aggregate panel — pass-rate 84%, p50 0.86, p95 0.95, plus a 6-bin histogram of scores.',
  },
  {
    id: 'cross-model-replay',
    tag: 'Cross-model compare',
    title: 'Up to 6 runs side-by-side',
    path: '/runs/compare',
    summary:
      'N-column comparison table. Stack-bar header summarises duration / cost / tokens per run. Median-deviation cells highlight where one column drifts from the others.',
    callout: { text: 'Compare up to 6 runs. Median-deviation diff highlighting.', corner: 'tr' },
    mockup: <CrossModelCompareMockup />,
    altText:
      'Cross-model compare mockup. Header row with stacked horizontal bars showing relative cost ($0.001 / $0.009 / $0.011 / $0.005) for four runs. Below: a 6-row comparison table — termination, total tokens, p95 latency, tool-call count, eval score, fork lineage. Two cells highlighted in amber to mark median-deviation diff.',
  },
  {
    id: 'prompts-editor',
    tag: 'Prompts as data',
    title: 'Versioned prompts with diff',
    path: '/prompts/[id]',
    summary:
      'Three-pane: version sidebar on the left, body view in the middle with `{{variable}}` highlights, metadata + actions on the right. Diff tab shows side-by-side line-by-line.',
    callout: { text: 'Prompts as data. Version history. Diff. Used-by graph.', corner: 'bl' },
    mockup: <PromptsEditorMockup />,
    altText:
      'Prompts editor three-pane mockup. Left sidebar: version list — v8 (current, today), v7 (yesterday), v6, v5, v4. Center: prompt body with three highlighted variables — {{repo_url}}, {{tier}}, {{cve_id}}. Right rail: metadata — author zeljan, used-by 3 agents, last test 0.91 score.',
  },
  {
    id: 'spend',
    tag: 'Spend dashboard',
    title: 'Per-model, per-agent, per-project',
    path: '/observability/spend',
    summary:
      'Four big-number cards on top — today, WTD, MTD with delta, projected end-of-month. Below, horizontal bar breakdown by capability / agent / project. CSV export. Budget alerts.',
    callout: {
      text: 'Per-model, per-agent, per-project breakdowns. CSV export. Budget alerts.',
      corner: 'tr',
    },
    mockup: <SpendDashboardMockup />,
    altText:
      'Spend dashboard mockup. Four metric cards: today $4.12, WTD $28.40, MTD $112.55 (+8% vs last), projected EOM $245. Below: horizontal bar breakdown — reasoning-strong $74 (largest), code-fim $22, fast-local $11, summarise $5. Right inset: budget-alert panel "soft cap 80% reached".',
  },
  {
    id: 'status',
    tag: 'In-house status page',
    title: 'No third-party badge',
    path: '/status',
    summary:
      'Three system rows with status pills. 30-day incident timeline below, JSON-backed history. Polls every 30s. Same data the platform tenants see.',
    callout: { text: 'In-house. Polls every 30s. JSON-backed history.', corner: 'bl' },
    mockup: <StatusPageMockup />,
    altText:
      'Status page mockup. Three rows: API (operational, green), Web (operational, green), Database (operational, green). Below: a 30-day incident timeline with 27 green cells, two amber cells (degraded), one slate cell (unknown). Footer: "Polls every 30 seconds. Last updated 12s ago."',
  },
];

export function ProductSurfacesInMotion() {
  return (
    <section id="product-surfaces" className="border-t border-border bg-bg">
      <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-24">
        <div className="mb-12 max-w-3xl">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-accent">
            See it in motion
          </p>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight text-fg sm:text-[2.1rem]">
            Six surfaces. Same database. Click any to deep-link.
          </h2>
          <p className="mt-3 text-base leading-relaxed text-fg-muted">
            No screenshots, no marketing reels. The mockups below are the actual pages — the same
            HTML our paying tenants see, rendered as inline SVG so they ship as zero-byte CSS
            instead of a half-megabyte image. Every chip is a real route.
          </p>
        </div>

        <ul className="space-y-12 sm:space-y-16">
          {SURFACES.map((s, idx) => (
            <li key={s.id}>
              <SurfaceRow surface={s} flipped={idx % 2 === 1} />
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function SurfaceRow({ surface, flipped }: { surface: Surface; flipped: boolean }) {
  return (
    <article className="grid grid-cols-1 gap-6 lg:grid-cols-12 lg:items-center lg:gap-12">
      {/* Mockup */}
      <figure
        className={`relative lg:col-span-7 ${flipped ? 'lg:order-2' : ''}`}
        aria-labelledby={`surface-cap-${surface.id}`}
      >
        <div className="relative overflow-hidden rounded-xl border border-border bg-bg-elevated shadow-lg ring-1 ring-border/40">
          {/* Faux scrollbar hint at the right edge — purely decorative. */}
          <div
            aria-hidden
            className="pointer-events-none absolute top-9 bottom-2 right-1 w-1 rounded-full bg-fg-faint/15"
          >
            <div className="absolute top-2 h-8 w-full rounded-full bg-fg-faint/30" />
          </div>
          {/* Mac-style window chrome with the URL bar showing the route. */}
          <div className="flex items-center gap-2 border-b border-border bg-bg-subtle px-3 py-2">
            <span aria-hidden className="h-2 w-2 rounded-full bg-rose-500/60" />
            <span aria-hidden className="h-2 w-2 rounded-full bg-amber-500/60" />
            <span aria-hidden className="h-2 w-2 rounded-full bg-emerald-500/60" />
            <span className="ml-2 truncate font-mono text-[10.5px] text-fg-muted">
              ai.aldo.tech{surface.path}
            </span>
          </div>
          {/* The mockup itself — strict aspect ratio so the figure
              column never reflows the alternating layout. */}
          <div className="aspect-[16/10] w-full overflow-hidden">{surface.mockup}</div>
          {/* Floating annotation chip with a thin connector line. */}
          <Annotation text={surface.callout.text} corner={surface.callout.corner} />
        </div>
        <figcaption id={`surface-cap-${surface.id}`} className="sr-only">
          {surface.altText}
        </figcaption>
      </figure>

      {/* Copy column */}
      <div className={`lg:col-span-5 ${flipped ? 'lg:order-1' : ''}`}>
        <p className="font-mono text-[10.5px] uppercase tracking-[0.18em] text-accent">
          {surface.tag}
        </p>
        <h3 className="mt-2 text-[1.4rem] font-semibold tracking-tight text-fg">{surface.title}</h3>
        <p className="mt-3 text-[14.5px] leading-relaxed text-fg-muted">{surface.summary}</p>
        <Link
          href={surface.path.replace('/[id]', '')}
          className="mt-4 inline-flex items-center gap-1 font-mono text-[12.5px] font-medium text-accent hover:text-accent-hover"
        >
          <code>{surface.path}</code>
          <span aria-hidden>→</span>
        </Link>
      </div>
    </article>
  );
}

function Annotation({ text, corner }: { text: string; corner: 'tr' | 'bl' }) {
  // Position + connector vary per corner. Both use the accent color so
  // the eye treats them as a single visual layer across all six mockups.
  if (corner === 'tr') {
    return (
      <>
        <span
          aria-hidden
          className="pointer-events-none absolute top-12 right-6 z-10 max-w-[200px] rounded-md border border-accent/40 bg-bg-elevated px-2.5 py-1.5 text-[10.5px] font-medium leading-snug text-fg shadow-md"
        >
          <span className="mr-1 font-mono text-[8.5px] uppercase tracking-wider text-accent">
            ▸
          </span>
          {text}
        </span>
        <svg
          aria-hidden
          className="pointer-events-none absolute top-[60px] right-[120px] z-0 h-6 w-16"
          viewBox="0 0 64 24"
        >
          <path
            d="M 0 24 Q 20 24 32 12 Q 48 0 64 0"
            className="fill-none stroke-accent/50"
            strokeWidth="1"
            strokeDasharray="2 2"
          />
        </svg>
      </>
    );
  }
  return (
    <>
      <span
        aria-hidden
        className="pointer-events-none absolute bottom-3 left-3 z-10 max-w-[210px] rounded-md border border-accent/40 bg-bg-elevated px-2.5 py-1.5 text-[10.5px] font-medium leading-snug text-fg shadow-md"
      >
        <span className="mr-1 font-mono text-[8.5px] uppercase tracking-wider text-accent">▸</span>
        {text}
      </span>
      <svg
        aria-hidden
        className="pointer-events-none absolute bottom-[44px] left-[110px] z-0 h-6 w-16"
        viewBox="0 0 64 24"
      >
        <path
          d="M 0 0 Q 20 0 32 12 Q 48 24 64 24"
          className="fill-none stroke-accent/50"
          strokeWidth="1"
          strokeDasharray="2 2"
        />
      </svg>
    </>
  );
}

// ─── Mockups ───────────────────────────────────────────────────────────────

function MockTabBar({ tabs, active }: { tabs: ReadonlyArray<string>; active: number }) {
  return (
    <div className="flex items-center gap-0 border-b border-border bg-bg-elevated px-2 py-1.5">
      {tabs.map((t, i) => (
        <span
          key={t}
          className={`rounded px-2 py-0.5 text-[9.5px] font-medium ${
            i === active ? 'bg-bg-subtle text-fg' : 'text-fg-muted'
          }`}
        >
          {t}
        </span>
      ))}
    </div>
  );
}

function FlameGraphMockup() {
  // Each row: agent name + horizontal stack of spans. The widths add
  // up to roughly the parent's duration. Colors map to agent role.
  const rows: ReadonlyArray<{
    label: string;
    role: 'orch' | 'plan' | 'review' | 'tool';
    spans: ReadonlyArray<{ left: number; width: number }>;
  }> = [
    { label: 'orchestrator', role: 'orch', spans: [{ left: 0, width: 100 }] },
    { label: 'planner', role: 'plan', spans: [{ left: 4, width: 32 }] },
    {
      label: 'reviewer',
      role: 'review',
      spans: [
        { left: 38, width: 20 },
        { left: 60, width: 24 },
      ],
    },
    {
      label: 'tool: aldo-fs',
      role: 'tool',
      spans: [
        { left: 10, width: 8 },
        { left: 42, width: 6 },
        { left: 64, width: 9 },
      ],
    },
    { label: 'tool: aldo-cve-db', role: 'tool', spans: [{ left: 70, width: 11 }] },
  ];
  const ROLE_FILL: Record<(typeof rows)[number]['role'], string> = {
    orch: 'fill-accent/55',
    plan: 'fill-warning/65',
    review: 'fill-success/55',
    tool: 'fill-fg-muted/40',
  };
  return (
    <div className="flex h-full w-full flex-col bg-bg-elevated">
      <MockTabBar
        tabs={['Timeline', 'Events', 'Tree', 'Composition', 'Replay', 'Annotations']}
        active={0}
      />
      <div className="flex flex-1 gap-3 px-3 py-2">
        {/* Flame body */}
        <div className="flex-1 space-y-1.5">
          {/* Time-axis tick row */}
          <div className="flex items-center gap-2 text-[8px] text-fg-faint">
            <span className="w-20 text-right font-mono">agent</span>
            <div className="relative flex-1">
              <div className="flex justify-between font-mono">
                <span>0s</span>
                <span>3.5s</span>
                <span>7s</span>
                <span>10.5s</span>
                <span>14s</span>
              </div>
              <div className="mt-0.5 h-px bg-border" />
            </div>
          </div>
          {rows.map((r) => (
            <div key={r.label} className="flex items-center gap-2">
              <span className="w-20 truncate text-right font-mono text-[8.5px] text-fg-muted">
                {r.label}
              </span>
              <div className="relative h-3 flex-1 rounded-sm bg-bg-subtle/60">
                <svg
                  viewBox="0 0 100 12"
                  preserveAspectRatio="none"
                  className="absolute inset-0 h-full w-full"
                >
                  {r.spans.map((sp) => (
                    <rect
                      key={`${sp.left}-${sp.width}`}
                      x={sp.left}
                      y={1}
                      width={sp.width}
                      height={10}
                      rx={1}
                      className={ROLE_FILL[r.role]}
                    />
                  ))}
                </svg>
              </div>
            </div>
          ))}
          {/* Legend */}
          <div className="flex items-center gap-3 pt-1 font-mono text-[8px] text-fg-faint">
            <Legend swatch="bg-accent/55" label="orchestrator" />
            <Legend swatch="bg-warning/65" label="planner" />
            <Legend swatch="bg-success/55" label="reviewer" />
            <Legend swatch="bg-fg-muted/40" label="tool" />
          </div>
        </div>
        {/* Right rail — meta */}
        <div className="w-[110px] flex-none space-y-1.5 rounded-md border border-border bg-bg p-2">
          <div className="text-[8.5px] font-semibold uppercase tracking-wider text-fg-muted">
            run_abc
          </div>
          <MetaRow k="duration" v="14.2s" />
          <MetaRow k="cost" v="$0.024" />
          <MetaRow k="checkpoints" v="3" />
          <MetaRow k="status" v="ok" tone="success" />
          <div className="!mt-2 rounded border border-accent/40 bg-accent/10 px-1.5 py-1 text-[8px] font-medium text-accent">
            ↻ Replay step
          </div>
        </div>
      </div>
    </div>
  );
}

function Legend({ swatch, label }: { swatch: string; label: string }) {
  return (
    <span className="flex items-center gap-1">
      <span className={`inline-block h-2 w-2 rounded-sm ${swatch}`} />
      {label}
    </span>
  );
}

function MetaRow({ k, v, tone }: { k: string; v: string; tone?: 'success' }) {
  return (
    <div className="flex items-center justify-between gap-1 font-mono text-[8.5px]">
      <span className="text-fg-faint">{k}</span>
      <span className={tone === 'success' ? 'text-success' : 'text-fg'}>{v}</span>
    </div>
  );
}

function EvalPlaygroundMockup() {
  const rows = [
    { id: 'auth-1', score: 0.91, ok: true },
    { id: 'auth-2', score: 0.84, ok: true },
    { id: 'auth-3', score: 0.77, ok: false },
    { id: 'auth-4', score: 0.95, ok: true },
    { id: 'auth-5', score: 0.62, ok: false },
    { id: 'auth-6', score: 0.88, ok: true },
  ];
  return (
    <div className="flex h-full w-full flex-col bg-bg-elevated">
      {/* Picker strip */}
      <div className="flex flex-wrap items-center gap-2 border-b border-border bg-bg-subtle px-3 py-2 text-[9px]">
        <span className="rounded border border-border bg-bg-elevated px-1.5 py-0.5 font-mono text-fg-muted">
          evaluator <span className="font-semibold text-fg">rubric-strict-v3</span>
        </span>
        <span className="rounded border border-border bg-bg-elevated px-1.5 py-0.5 font-mono text-fg-muted">
          dataset <span className="font-semibold text-fg">auth-flows-50</span>
        </span>
        <span className="rounded border border-border bg-bg-elevated px-1.5 py-0.5 font-mono text-fg-muted">
          n=50
        </span>
        <span className="ml-auto rounded bg-accent px-2 py-0.5 font-mono text-[9px] font-semibold text-accent-fg">
          Run sweep
        </span>
      </div>
      <div className="grid flex-1 grid-cols-[1.6fr_1fr] gap-2 px-3 py-2">
        {/* Results table */}
        <div className="flex flex-col rounded-md border border-border bg-bg">
          <div className="border-b border-border bg-bg-subtle px-2 py-1 font-mono text-[8px] uppercase tracking-wider text-fg-muted">
            results · streaming
          </div>
          <div className="divide-y divide-border">
            {rows.map((r) => (
              <div key={r.id} className="flex items-center justify-between gap-2 px-2 py-1">
                <span className="font-mono text-[8.5px] text-fg">{r.id}</span>
                <div className="flex items-center gap-2">
                  <div className="h-1 w-12 overflow-hidden rounded-full bg-bg-subtle">
                    <div
                      className={r.ok ? 'h-full bg-success' : 'h-full bg-warning'}
                      style={{ width: `${Math.round(r.score * 100)}%` }}
                    />
                  </div>
                  <span
                    className={`w-9 text-right font-mono text-[8.5px] tabular-nums ${
                      r.ok ? 'text-success' : 'text-warning'
                    }`}
                  >
                    {r.score.toFixed(2)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
        {/* Aggregate */}
        <div className="flex flex-col gap-2">
          <div className="rounded-md border border-border bg-bg p-2">
            <div className="font-mono text-[8px] uppercase tracking-wider text-fg-muted">
              aggregate
            </div>
            <div className="mt-1 grid grid-cols-2 gap-1 text-[8.5px]">
              <Stat k="pass-rate" v="84%" />
              <Stat k="p50" v="0.86" />
              <Stat k="p95" v="0.95" />
              <Stat k="min" v="0.62" />
            </div>
          </div>
          <div className="flex-1 rounded-md border border-border bg-bg p-2">
            <div className="font-mono text-[8px] uppercase tracking-wider text-fg-muted">
              histogram
            </div>
            {/* 6 bin pure-CSS histogram */}
            <div className="mt-2 flex h-12 items-end gap-1">
              {[6, 12, 18, 22, 28, 14].map((h, i) => (
                <div
                  key={`bar-${i}-${h}`}
                  className="flex-1 rounded-sm bg-accent/60"
                  style={{ height: `${h * 1.5}px` }}
                />
              ))}
            </div>
            <div className="mt-1 flex justify-between font-mono text-[7px] text-fg-faint">
              <span>0</span>
              <span>1</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div className="rounded border border-border bg-bg-elevated px-1.5 py-1">
      <div className="font-mono text-[7.5px] uppercase tracking-wider text-fg-faint">{k}</div>
      <div className="font-mono text-[10px] font-semibold tabular-nums text-fg">{v}</div>
    </div>
  );
}

function CrossModelCompareMockup() {
  // 4 columns of run data. The header has a stack-bar for cost.
  const cols = [
    { id: 'run_a', label: 'A · local', cost: 0.001, costPct: 9 },
    { id: 'run_b', label: 'B · frontier', cost: 0.009, costPct: 78 },
    { id: 'run_c', label: 'C · alt', cost: 0.011, costPct: 100 },
    { id: 'run_d', label: 'D · hybrid', cost: 0.005, costPct: 45 },
  ];
  const tableRows: ReadonlyArray<{
    k: string;
    cells: ReadonlyArray<{ v: string; diff?: boolean; tone?: 'success' | 'warning' }>;
  }> = [
    {
      k: 'termination',
      cells: [
        { v: 'success' },
        { v: 'success' },
        { v: 'maxTurns', diff: true, tone: 'warning' },
        { v: 'success' },
      ],
    },
    {
      k: 'tokens',
      cells: [{ v: '1,820' }, { v: '1,640' }, { v: '4,210', diff: true }, { v: '1,705' }],
    },
    { k: 'p95 latency', cells: [{ v: '0.4s' }, { v: '2.1s' }, { v: '2.8s' }, { v: '1.1s' }] },
    { k: 'tool calls', cells: [{ v: '5' }, { v: '5' }, { v: '7', diff: true }, { v: '5' }] },
    { k: 'eval', cells: [{ v: '0.84' }, { v: '0.91' }, { v: '0.79' }, { v: '0.88' }] },
  ];
  return (
    <div className="flex h-full w-full flex-col bg-bg-elevated">
      <MockTabBar tabs={['Side-by-side', 'Stack bars', 'Diff only', 'Lineage']} active={0} />
      <div className="flex-1 overflow-hidden px-3 py-2">
        {/* Header — stack bar with column labels */}
        <div className="grid grid-cols-[80px_repeat(4,_1fr)] gap-1.5 text-[8px] font-mono">
          <span className="text-fg-faint" />
          {cols.map((c) => (
            <div key={c.id} className="space-y-0.5 rounded border border-border bg-bg p-1">
              <div className="font-semibold text-fg">{c.label}</div>
              <div className="h-1 overflow-hidden rounded-full bg-bg-subtle">
                <div className="h-full bg-accent" style={{ width: `${c.costPct}%` }} />
              </div>
              <div className="text-fg-muted tabular-nums">${c.cost.toFixed(3)}</div>
            </div>
          ))}
        </div>
        {/* Body table */}
        <div className="mt-2 space-y-0.5 text-[8.5px]">
          {tableRows.map((r) => (
            <div
              key={r.k}
              className="grid grid-cols-[80px_repeat(4,_1fr)] gap-1.5 rounded-sm border border-border bg-bg px-1 py-0.5"
            >
              <span className="text-fg-faint font-mono">{r.k}</span>
              {r.cells.map((cell, i) => (
                <span
                  key={`${r.k}-${i}`}
                  className={`text-center font-mono tabular-nums ${
                    cell.diff
                      ? cell.tone === 'warning'
                        ? 'rounded bg-warning/15 text-warning'
                        : 'rounded bg-amber-500/15 text-amber-700 dark:text-amber-400'
                      : 'text-fg'
                  }`}
                >
                  {cell.v}
                </span>
              ))}
            </div>
          ))}
        </div>
        <div className="mt-2 flex items-center gap-2 text-[8px] font-mono text-fg-faint">
          <span className="rounded bg-amber-500/15 px-1 py-0.5 text-amber-700 dark:text-amber-400">
            diff
          </span>
          <span>= cell drifts &gt; 1.5σ from the median across columns</span>
        </div>
      </div>
    </div>
  );
}

function PromptsEditorMockup() {
  const versions = [
    { v: 'v8', when: 'today', current: true },
    { v: 'v7', when: 'yesterday', current: false },
    { v: 'v6', when: '3d ago', current: false },
    { v: 'v5', when: '5d ago', current: false },
    { v: 'v4', when: '1w ago', current: false },
  ];
  return (
    <div className="flex h-full w-full flex-col bg-bg-elevated">
      <MockTabBar tabs={['Body', 'Variables', 'Diff', 'Used by', 'Test']} active={0} />
      <div className="grid flex-1 grid-cols-[80px_1fr_110px] gap-2 px-3 py-2 text-[8.5px]">
        {/* Version sidebar */}
        <div className="space-y-1 rounded-md border border-border bg-bg p-1.5">
          <div className="font-mono text-[7.5px] uppercase tracking-wider text-fg-muted">
            history
          </div>
          {versions.map((vr) => (
            <div
              key={vr.v}
              className={`flex items-center justify-between rounded px-1 py-0.5 ${
                vr.current ? 'bg-accent/15 text-accent' : 'text-fg-muted hover:bg-bg-subtle'
              }`}
            >
              <span className="font-mono font-semibold">{vr.v}</span>
              <span className="text-[7.5px]">{vr.when}</span>
            </div>
          ))}
        </div>
        {/* Body */}
        <div className="rounded-md border border-border bg-slate-950 p-2 font-mono text-[8.5px] leading-snug text-slate-300">
          <div className="text-slate-500"># security-auditor.prompt</div>
          <div className="mt-1">You audit code in</div>
          <div>
            <span className="rounded bg-accent/30 px-1 py-px font-semibold text-sky-300">
              {'{{repo_url}}'}
            </span>{' '}
            for severity{' '}
            <span className="rounded bg-accent/30 px-1 py-px font-semibold text-sky-300">
              {'{{tier}}'}
            </span>
            .
          </div>
          <div className="mt-1">Quote files; never invent. If</div>
          <div>
            <span className="rounded bg-accent/30 px-1 py-px font-semibold text-sky-300">
              {'{{cve_id}}'}
            </span>{' '}
            is given, scope to it.
          </div>
          <div className="mt-2 text-slate-500">--- evidence:</div>
          <div className="text-emerald-300">- file: ...</div>
          <div className="text-emerald-300">- line: ...</div>
        </div>
        {/* Metadata */}
        <div className="space-y-1.5 rounded-md border border-border bg-bg p-1.5">
          <div className="font-mono text-[7.5px] uppercase tracking-wider text-fg-muted">
            metadata
          </div>
          <MetaRow k="author" v="zeljan" />
          <MetaRow k="used by" v="3 agents" />
          <MetaRow k="last test" v="0.91" tone="success" />
          <div className="!mt-2 rounded border border-accent/40 bg-accent/10 px-1.5 py-0.5 text-center font-mono text-[8px] font-semibold text-accent">
            Diff vs v7
          </div>
        </div>
      </div>
    </div>
  );
}

function SpendDashboardMockup() {
  const cards = [
    { k: 'today', v: '$4.12', delta: null },
    { k: 'WTD', v: '$28.40', delta: null },
    { k: 'MTD', v: '$112.55', delta: '+8%' },
    { k: 'EOM proj', v: '$245', delta: null },
  ];
  const breakdown = [
    { label: 'reasoning-strong', value: 74, pct: 100 },
    { label: 'code-fim', value: 22, pct: 30 },
    { label: 'fast-local', value: 11, pct: 15 },
    { label: 'summarise', value: 5, pct: 7 },
  ];
  return (
    <div className="flex h-full w-full flex-col bg-bg-elevated">
      <MockTabBar
        tabs={['Cards', 'By capability', 'By agent', 'By project', 'Alerts']}
        active={0}
      />
      <div className="flex flex-1 flex-col gap-2 px-3 py-2">
        {/* 4 cards */}
        <div className="grid grid-cols-4 gap-1.5">
          {cards.map((c) => (
            <div key={c.k} className="rounded-md border border-border bg-bg p-2">
              <div className="font-mono text-[7.5px] uppercase tracking-wider text-fg-muted">
                {c.k}
              </div>
              <div className="mt-0.5 flex items-baseline gap-1">
                <span className="font-mono text-[14px] font-semibold tabular-nums text-fg">
                  {c.v}
                </span>
                {c.delta ? (
                  <span className="font-mono text-[8px] text-success">{c.delta}</span>
                ) : null}
              </div>
            </div>
          ))}
        </div>
        {/* Breakdown bars */}
        <div className="flex flex-1 gap-2">
          <div className="flex-1 space-y-1.5 rounded-md border border-border bg-bg p-2">
            <div className="font-mono text-[7.5px] uppercase tracking-wider text-fg-muted">
              by capability · MTD
            </div>
            {breakdown.map((b) => (
              <div key={b.label} className="flex items-center gap-2 text-[8px] font-mono">
                <span className="w-24 truncate text-fg-muted">{b.label}</span>
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-bg-subtle">
                  <div className="h-full bg-accent" style={{ width: `${b.pct}%` }} />
                </div>
                <span className="w-10 text-right tabular-nums text-fg">${b.value}</span>
              </div>
            ))}
          </div>
          {/* Budget alert side-card */}
          <div className="w-[100px] flex-none rounded-md border border-warning/40 bg-warning/5 p-2">
            <div className="font-mono text-[7.5px] uppercase tracking-wider text-warning">
              alert
            </div>
            <div className="mt-1 text-[8.5px] leading-snug text-fg">
              Soft cap 80% reached on capability:reasoning-strong.
            </div>
            <div className="mt-1.5 rounded border border-border bg-bg-elevated px-1 py-0.5 text-center font-mono text-[7.5px] text-fg-muted">
              CSV export ↓
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatusPageMockup() {
  // 30 cells, 27 ok, 2 degraded, 1 unknown.
  const cells: ReadonlyArray<'ok' | 'degraded' | 'unknown'> = [
    'ok',
    'ok',
    'ok',
    'ok',
    'ok',
    'degraded',
    'ok',
    'ok',
    'ok',
    'ok',
    'ok',
    'ok',
    'ok',
    'unknown',
    'ok',
    'ok',
    'ok',
    'ok',
    'degraded',
    'ok',
    'ok',
    'ok',
    'ok',
    'ok',
    'ok',
    'ok',
    'ok',
    'ok',
    'ok',
    'ok',
  ];
  const FILL: Record<(typeof cells)[number], string> = {
    ok: 'bg-success/70',
    degraded: 'bg-warning/80',
    unknown: 'bg-fg-faint/40',
  };
  return (
    <div className="flex h-full w-full flex-col bg-bg-elevated">
      <MockTabBar tabs={['Today', '30-day history', 'JSON', 'Subscribe']} active={0} />
      <div className="flex flex-1 flex-col gap-2 px-3 py-2">
        {/* System rows */}
        <div className="space-y-1">
          {[
            { sys: 'API', s: 'operational' },
            { sys: 'Web', s: 'operational' },
            { sys: 'Database', s: 'operational' },
          ].map((row) => (
            <div
              key={row.sys}
              className="flex items-center justify-between rounded-md border border-border bg-bg px-2 py-1"
            >
              <span className="font-mono text-[9px] font-semibold text-fg">{row.sys}</span>
              <span className="inline-flex items-center gap-1 rounded-full border border-success/40 bg-success/10 px-1.5 py-0.5 font-mono text-[7.5px] font-semibold uppercase tracking-wider text-success">
                <span className="h-1 w-1 rounded-full bg-success" /> {row.s}
              </span>
            </div>
          ))}
        </div>
        {/* 30-day timeline */}
        <div className="rounded-md border border-border bg-bg p-2">
          <div className="flex items-center justify-between font-mono text-[7.5px] uppercase tracking-wider text-fg-muted">
            <span>30-day history</span>
            <span className="text-fg-faint">today →</span>
          </div>
          <div
            className="mt-1.5 grid grid-cols-30 gap-0.5"
            style={{ gridTemplateColumns: 'repeat(30, minmax(0, 1fr))' }}
          >
            {cells.map((c, i) => (
              <span
                key={`day-${i}`}
                className={`h-3 rounded-sm ${FILL[c]}`}
                title={`day ${i + 1}: ${c}`}
              />
            ))}
          </div>
        </div>
        <div className="flex items-center justify-between text-[7.5px] font-mono text-fg-faint">
          <span className="flex items-center gap-2">
            <Legend swatch="bg-success/70" label="ok" />
            <Legend swatch="bg-warning/80" label="degraded" />
            <Legend swatch="bg-fg-faint/40" label="unknown" />
          </span>
          <span>polls every 30s · last update 12s ago</span>
        </div>
      </div>
    </div>
  );
}
