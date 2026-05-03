'use client';

/**
 * Wave-4 — `/observability/spend` client island.
 *
 * Polls `/v1/spend` every 30s. The window picker is the page's only
 * truly stateful axis; capability/agent/project breakdowns each issue
 * one parallel call (with `groupBy=` flipped). The cards + timeseries
 * in the response are identical across calls so we keep the first.
 *
 * LLM-agnostic: every breakdown key is opaque (model id, capability
 * class, agent name, project slug). The page never branches on a
 * provider brand.
 *
 * Empty state: when totals.runs === 0 over the chosen window AND
 * across all three breakdowns, render the "no spend yet" hint with a
 * playground CTA — matches the brief for new tenants.
 */

import { ApiClientError, getSpend } from '@/lib/api';
import { listAlertRules } from '@/lib/api-dashboards';
import { useCurrentProject } from '@/lib/use-current-project';
import type {
  AlertRule,
  SpendBreakdownRow,
  SpendResponse,
  SpendTimeseriesPoint,
  SpendWindow,
} from '@aldo-ai/api-contract';
import Link from 'next/link';
import { useEffect, useState } from 'react';

const WINDOWS: ReadonlyArray<{ id: SpendWindow; label: string }> = [
  { id: '24h', label: '24h' },
  { id: '7d', label: '7d' },
  { id: '30d', label: '30d' },
  { id: '90d', label: '90d' },
];

const POLL_MS = 30_000;

interface ThreeBreakdowns {
  capability: SpendResponse;
  agent: SpendResponse;
  project: SpendResponse;
}

export function SpendDashboard() {
  const { projectSlug } = useCurrentProject();
  const [windowSel, setWindowSel] = useState<SpendWindow>('7d');
  const [data, setData] = useState<ThreeBreakdowns | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [alerts, setAlerts] = useState<readonly AlertRule[]>([]);

  // Fetch the three breakdown axes in parallel; keep the first
  // response's cards/timeseries (they're identical across calls).
  useEffect(() => {
    let alive = true;
    async function fetchOnce() {
      try {
        const [cap, agent, project] = await Promise.all([
          getSpend({
            ...(projectSlug !== null ? { project: projectSlug } : {}),
            window: windowSel,
            groupBy: 'capability',
          }),
          getSpend({
            ...(projectSlug !== null ? { project: projectSlug } : {}),
            window: windowSel,
            groupBy: 'agent',
          }),
          getSpend({
            ...(projectSlug !== null ? { project: projectSlug } : {}),
            window: windowSel,
            groupBy: 'project',
          }),
        ]);
        if (!alive) return;
        setData({ capability: cap, agent, project });
        setError(null);
      } catch (err) {
        if (!alive) return;
        if (err instanceof ApiClientError) setError(err.message);
        else setError('failed to load spend');
      }
    }
    fetchOnce();
    const t = setInterval(fetchOnce, POLL_MS);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [windowSel, projectSlug]);

  // Best-effort load of alerts. Missing endpoint or 4xx → empty list,
  // never block the page.
  useEffect(() => {
    let alive = true;
    listAlertRules()
      .then((res) => {
        if (alive) setAlerts(res.rules);
      })
      .catch(() => {
        // Permission errors / 401 / 404 — silently empty. The page
        // renders the "Create budget alert" CTA either way.
      });
    return () => {
      alive = false;
    };
  }, []);

  if (error !== null) {
    return (
      <div
        role="alert"
        className="rounded-md border border-danger bg-danger-subtle px-4 py-3 text-sm text-danger"
      >
        Couldn't load spend: {error}
      </div>
    );
  }
  if (data === null) {
    return <div className="text-sm text-fg-muted">Loading spend…</div>;
  }

  const cards = data.capability.cards;
  const totals = data.capability.totals;
  const timeseries = data.capability.timeseries;
  const empty =
    totals.runs === 0 &&
    data.agent.totals.runs === 0 &&
    data.project.totals.runs === 0 &&
    cards.activeRuns === 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <WindowPicker value={windowSel} onChange={setWindowSel} />
        <div className="flex items-center gap-2">
          <ExportCsvButton data={data} window={windowSel} />
          <span className="text-xs text-fg-faint">refreshes every 30s</span>
        </div>
      </div>

      <CardsRow cards={cards} />

      {empty ? <EmptyState /> : null}

      <TimeseriesCard points={timeseries} window={windowSel} totals={totals} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <BreakdownPanel
          title="By model capability"
          keyHeader="Capability"
          rows={data.capability.breakdown}
          total={data.capability.totals.costUsd}
          chart="donut"
        />
        <BreakdownPanel
          title="By agent"
          keyHeader="Agent"
          rows={data.agent.breakdown}
          total={data.agent.totals.costUsd}
          chart="bar"
        />
        <BreakdownPanel
          title="By project"
          keyHeader="Project"
          rows={data.project.breakdown}
          total={data.project.totals.costUsd}
          chart="bar"
        />
      </div>

      <BudgetAlertsCard alerts={alerts} />
    </div>
  );
}

// --- Window picker --------------------------------------------------------

function WindowPicker({
  value,
  onChange,
}: {
  value: SpendWindow;
  onChange: (w: SpendWindow) => void;
}) {
  return (
    <fieldset
      aria-label="Window"
      className="inline-flex overflow-hidden rounded-md border border-border p-0"
    >
      <legend className="sr-only">Window</legend>
      {WINDOWS.map((w) => {
        const active = value === w.id;
        return (
          <button
            key={w.id}
            type="button"
            onClick={() => onChange(w.id)}
            aria-pressed={active}
            className={`min-h-touch px-3 py-1.5 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg ${
              active ? 'bg-fg text-fg-inverse' : 'bg-bg-elevated text-fg-muted hover:bg-bg-subtle'
            }`}
          >
            {w.label}
          </button>
        );
      })}
    </fieldset>
  );
}

// --- Cards row ------------------------------------------------------------

function CardsRow({ cards }: { cards: SpendResponse['cards'] }) {
  return (
    <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <BigNumberCard
        label="Today"
        value={fmtUsd(cards.today.costUsd)}
        delta={cards.today.delta}
        sub="vs yesterday"
      />
      <BigNumberCard
        label="Week to date"
        value={fmtUsd(cards.weekToDate.costUsd)}
        delta={cards.weekToDate.delta}
        sub="vs prior week (same days)"
      />
      <BigNumberCard
        label="Month to date"
        value={fmtUsd(cards.monthToDate.costUsd)}
        delta={cards.monthToDate.delta}
        sub={`projected ${fmtUsd(cards.monthToDate.projectedMonthEndUsd)} end of month`}
      />
      <ActiveRunsCard count={cards.activeRuns} />
    </dl>
  );
}

function BigNumberCard({
  label,
  value,
  delta,
  sub,
}: {
  label: string;
  value: string;
  delta: { deltaUsd: number; deltaPct: number | null };
  sub?: string;
}) {
  const dir = delta.deltaUsd > 0 ? 'up' : delta.deltaUsd < 0 ? 'down' : 'flat';
  // Up = more spend = warning; down = saving = success. Flat = neutral.
  const tone = dir === 'up' ? 'text-warning' : dir === 'down' ? 'text-success' : 'text-fg-faint';
  const arrow = dir === 'up' ? '▲' : dir === 'down' ? '▼' : '·';
  const pct = delta.deltaPct === null ? '' : ` ${(Math.abs(delta.deltaPct) * 100).toFixed(0)}%`;
  return (
    <div className="rounded-md border border-border bg-bg-elevated px-4 py-3">
      <dt className="text-[11px] uppercase tracking-wider text-fg-muted">{label}</dt>
      <dd className="mt-1 font-mono text-2xl font-semibold tabular-nums text-fg">{value}</dd>
      <dd className={`mt-0.5 text-xs ${tone}`}>
        <span aria-hidden>{arrow}</span>
        <span className="sr-only">{dir === 'up' ? 'up' : dir === 'down' ? 'down' : 'flat'}</span>{' '}
        {fmtSignedUsd(delta.deltaUsd)}
        {pct}
      </dd>
      {sub ? <dd className="mt-1 text-[11px] text-fg-faint">{sub}</dd> : null}
    </div>
  );
}

function ActiveRunsCard({ count }: { count: number }) {
  const live = count > 0;
  return (
    <div className="rounded-md border border-border bg-bg-elevated px-4 py-3">
      <dt className="text-[11px] uppercase tracking-wider text-fg-muted">Active runs</dt>
      <dd className="mt-1 flex items-center gap-2">
        {live ? (
          <span aria-hidden className="relative flex h-2.5 w-2.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-75" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-success" />
          </span>
        ) : null}
        <span className="font-mono text-2xl font-semibold tabular-nums text-fg">{count}</span>
      </dd>
      <dd className="mt-1 text-[11px] text-fg-faint">queued + running</dd>
    </div>
  );
}

// --- Timeseries chart -----------------------------------------------------

function TimeseriesCard({
  points,
  window: windowSel,
  totals,
}: {
  points: ReadonlyArray<SpendTimeseriesPoint>;
  window: SpendWindow;
  totals: SpendResponse['totals'];
}) {
  return (
    <Card
      title="Spend over time"
      subtitle={`Total ${fmtUsd(totals.costUsd)} · ${totals.runs} runs · ${windowLabel(windowSel)}`}
    >
      <SpendBarChart points={points} byHour={windowSel === '24h'} />
    </Card>
  );
}

/**
 * Bare-SVG bar chart. Avoids pulling in a chart library; the codebase
 * intentionally keeps observability surfaces dependency-light. Width
 * is scaled by viewBox so it rerenders cleanly across the responsive
 * breakpoints. Hover shows the bucket's tooltip.
 */
export function SpendBarChart({
  points,
  byHour,
  height = 280,
}: {
  points: ReadonlyArray<SpendTimeseriesPoint>;
  byHour: boolean;
  height?: number;
}) {
  const width = 1000;
  const padL = 48;
  const padR = 12;
  const padT = 16;
  const padB = 40;
  const innerW = width - padL - padR;
  const innerH = height - padT - padB;
  const max = Math.max(0.0001, ...points.map((p) => p.costUsd));
  const barW = points.length > 0 ? innerW / points.length : 0;
  // Choose tick count that fits the chart.
  const ticks = niceTicks(max, 4);

  return (
    <div className="overflow-x-auto">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="Spend over time"
        className="w-full"
        preserveAspectRatio="xMidYMid meet"
      >
        <title>Spend over time</title>
        {/* Y-axis grid + labels */}
        {ticks.map((t) => {
          const y = padT + innerH - (t / max) * innerH;
          return (
            <g key={`y-${t}`}>
              <line
                x1={padL}
                x2={width - padR}
                y1={y}
                y2={y}
                stroke="currentColor"
                strokeOpacity={0.08}
                strokeWidth={1}
              />
              <text
                x={padL - 6}
                y={y + 3}
                textAnchor="end"
                fontSize={10}
                fill="currentColor"
                opacity={0.6}
                className="font-mono"
              >
                {fmtUsd(t)}
              </text>
            </g>
          );
        })}

        {/* Bars */}
        {points.map((p, i) => {
          const h = (p.costUsd / max) * innerH;
          const x = padL + i * barW + Math.max(0, (barW - Math.max(2, barW * 0.7)) / 2);
          const w = Math.max(2, barW * 0.7);
          const y = padT + innerH - h;
          return (
            <g key={p.dateBucket}>
              <rect
                x={x}
                y={y}
                width={w}
                height={Math.max(0, h)}
                fill="currentColor"
                opacity={0.85}
                className="text-fg"
              >
                <title>{`${formatBucket(p.dateBucket, byHour)} — ${fmtUsd(p.costUsd)} · ${p.runs} runs · ${p.tokens.toLocaleString()} tokens`}</title>
              </rect>
            </g>
          );
        })}

        {/* X-axis: a few labels evenly spaced */}
        {xAxisTicks(points, byHour).map(({ index, label }) => {
          const x = padL + index * barW + barW / 2;
          return (
            <text
              key={`x-${index}-${label}`}
              x={x}
              y={height - padB + 16}
              textAnchor="middle"
              fontSize={10}
              fill="currentColor"
              opacity={0.6}
            >
              {label}
            </text>
          );
        })}
      </svg>
    </div>
  );
}

export function xAxisTicks(
  points: ReadonlyArray<SpendTimeseriesPoint>,
  byHour: boolean,
  maxTicks = 6,
): ReadonlyArray<{ index: number; label: string }> {
  if (points.length === 0) return [];
  const step = Math.max(1, Math.ceil(points.length / maxTicks));
  const out: Array<{ index: number; label: string }> = [];
  for (let i = 0; i < points.length; i += step) {
    const p = points[i];
    if (p === undefined) continue;
    out.push({ index: i, label: formatBucket(p.dateBucket, byHour, true) });
  }
  return out;
}

export function niceTicks(max: number, count: number): number[] {
  if (max <= 0) return [0];
  const rough = max / count;
  const mag = 10 ** Math.floor(Math.log10(rough));
  const norm = rough / mag;
  let step: number;
  if (norm < 1.5) step = 1 * mag;
  else if (norm < 3) step = 2 * mag;
  else if (norm < 7) step = 5 * mag;
  else step = 10 * mag;
  const out: number[] = [];
  for (let v = 0; v <= max + step / 2; v += step) {
    out.push(roundTick(v));
  }
  return out;
}

function roundTick(v: number): number {
  return Math.round(v * 1e6) / 1e6;
}

function formatBucket(iso: string, byHour: boolean, axisLabel = false): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  if (byHour) {
    const h = String(d.getUTCHours()).padStart(2, '0');
    if (axisLabel) return `${h}:00`;
    return `${d.toISOString().slice(0, 10)} ${h}:00 UTC`;
  }
  const month = d.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' });
  const day = d.getUTCDate();
  if (axisLabel) return `${month} ${day}`;
  return `${month} ${day}, ${d.getUTCFullYear()}`;
}

function windowLabel(w: SpendWindow): string {
  return w === '24h' ? 'last 24 hours' : `last ${w}`;
}

// --- Breakdown panel ------------------------------------------------------

function BreakdownPanel({
  title,
  keyHeader,
  rows,
  total,
  chart,
}: {
  title: string;
  keyHeader: string;
  rows: ReadonlyArray<SpendBreakdownRow>;
  total: number;
  chart: 'donut' | 'bar';
}) {
  const top = rows.slice(0, 10);
  return (
    <Card title={title}>
      {rows.length === 0 ? (
        <p className="py-6 text-center text-xs text-fg-faint">No data in this window.</p>
      ) : (
        <>
          <div className="mb-3">
            {chart === 'donut' ? <Donut rows={top} total={total} /> : <BarRows rows={top} />}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left">
                  <th className="pb-1 font-medium text-fg-muted">{keyHeader}</th>
                  <th className="pb-1 text-right font-medium text-fg-muted">Runs</th>
                  <th className="pb-1 text-right font-medium text-fg-muted">Cost</th>
                  <th className="pb-1 text-right font-medium text-fg-muted">%</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {top.map((r) => (
                  <tr key={r.key} className="hover:bg-bg-subtle">
                    <td className="py-1 font-mono text-[11px] text-fg" title={r.label}>
                      {truncate(r.label, 28)}
                    </td>
                    <td className="py-1 text-right tabular-nums text-fg-muted">{r.runs}</td>
                    <td className="py-1 text-right font-mono tabular-nums text-fg">
                      {fmtUsd(r.costUsd)}
                    </td>
                    <td className="py-1 text-right tabular-nums text-fg-muted">
                      {r.percentOfTotal.toFixed(0)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Card>
  );
}

/**
 * Pure-SVG donut. Each slice is an arc; we keep colors from a stable
 * 8-tone palette so re-renders don't flicker as the data changes.
 */
function Donut({ rows, total }: { rows: ReadonlyArray<SpendBreakdownRow>; total: number }) {
  const size = 160;
  const r = 64;
  const inner = 36;
  const cx = size / 2;
  const cy = size / 2;
  let acc = 0;

  if (total <= 0) {
    return (
      <svg
        viewBox={`0 0 ${size} ${size}`}
        role="img"
        aria-label="No cost recorded"
        className="mx-auto block h-32 w-32"
      >
        <title>No cost recorded</title>
        <circle cx={cx} cy={cy} r={r} fill="currentColor" opacity={0.06} />
        <circle cx={cx} cy={cy} r={inner} fill="var(--bg-elevated, #fff)" />
      </svg>
    );
  }

  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label="Cost share by capability"
      className="mx-auto block h-40 w-40"
    >
      <title>Cost share by capability</title>
      {rows.map((row, i) => {
        const start = (acc / total) * Math.PI * 2;
        acc += row.costUsd;
        const end = (acc / total) * Math.PI * 2;
        const path = arcPath(cx, cy, r, inner, start, end);
        const tone = DONUT_TONES[i % DONUT_TONES.length] ?? '#94a3b8';
        return (
          <path key={row.key} d={path} fill={tone} opacity={0.92}>
            <title>{`${row.label} — ${fmtUsd(row.costUsd)} (${row.percentOfTotal.toFixed(0)}%)`}</title>
          </path>
        );
      })}
      <circle cx={cx} cy={cy} r={inner - 1} fill="var(--bg-elevated, #fff)" />
      <text
        x={cx}
        y={cy + 1}
        textAnchor="middle"
        fontSize={11}
        fill="currentColor"
        opacity={0.7}
        className="font-mono"
      >
        {fmtUsd(total)}
      </text>
    </svg>
  );
}

/** Flat 8-tone palette — slate-mid through accent-warm. Stable across renders. */
const DONUT_TONES: ReadonlyArray<string> = [
  '#0f172a',
  '#334155',
  '#475569',
  '#64748b',
  '#0ea5e9',
  '#22c55e',
  '#f59e0b',
  '#ef4444',
];

export function arcPath(
  cx: number,
  cy: number,
  rOuter: number,
  rInner: number,
  startRad: number,
  endRad: number,
): string {
  // Start angle at top (12 o'clock). 0 rad in SVG points along +X, so
  // we offset by -π/2.
  const a0 = startRad - Math.PI / 2;
  const a1 = endRad - Math.PI / 2;
  const x0 = cx + rOuter * Math.cos(a0);
  const y0 = cy + rOuter * Math.sin(a0);
  const x1 = cx + rOuter * Math.cos(a1);
  const y1 = cy + rOuter * Math.sin(a1);
  const x2 = cx + rInner * Math.cos(a1);
  const y2 = cy + rInner * Math.sin(a1);
  const x3 = cx + rInner * Math.cos(a0);
  const y3 = cy + rInner * Math.sin(a0);
  const large = endRad - startRad > Math.PI ? 1 : 0;
  return [
    `M ${x0} ${y0}`,
    `A ${rOuter} ${rOuter} 0 ${large} 1 ${x1} ${y1}`,
    `L ${x2} ${y2}`,
    `A ${rInner} ${rInner} 0 ${large} 0 ${x3} ${y3}`,
    'Z',
  ].join(' ');
}

function BarRows({ rows }: { rows: ReadonlyArray<SpendBreakdownRow> }) {
  const max = Math.max(0.0001, ...rows.map((r) => r.costUsd));
  return (
    <ul className="space-y-1.5">
      {rows.map((r) => {
        const widthPct = (r.costUsd / max) * 100;
        return (
          <li key={r.key} className="flex items-center gap-2">
            <span
              className="w-32 shrink-0 truncate font-mono text-[11px] text-fg-muted"
              title={r.label}
            >
              {truncate(r.label, 22)}
            </span>
            <span className="relative flex-1 overflow-hidden rounded-sm bg-bg-subtle">
              <span className="block h-3 bg-fg" style={{ width: `${widthPct}%`, opacity: 0.85 }} />
            </span>
            <span className="w-16 shrink-0 text-right font-mono text-[11px] tabular-nums text-fg">
              {fmtUsd(r.costUsd)}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

// --- Budget alerts --------------------------------------------------------

function BudgetAlertsCard({ alerts }: { alerts: ReadonlyArray<AlertRule> }) {
  const spendKinds: ReadonlySet<string> = new Set(['cost_spike', 'budget_threshold']);
  const spendAlerts = alerts.filter((a) => spendKinds.has(a.kind));
  return (
    <Card
      title="Budget alerts"
      subtitle="Cost-shaped alert rules. Triggered rules surface here too."
      actions={
        <Link
          href="/dashboards"
          className="inline-flex min-h-touch items-center rounded-md border border-border bg-bg-elevated px-3 py-1.5 text-xs font-medium text-fg hover:bg-bg-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
        >
          Create budget alert
        </Link>
      }
    >
      {spendAlerts.length === 0 ? (
        <p className="text-xs text-fg-muted">
          No spend-shaped alerts configured. Create a budget threshold or cost-spike rule from the
          Dashboards page.
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {spendAlerts.map((a) => (
            <li key={a.id} className="flex items-center justify-between py-2 text-sm">
              <div>
                <div className="font-medium text-fg">{a.name}</div>
                <div className="text-xs text-fg-muted">
                  {a.kind === 'budget_threshold' ? 'Monthly budget' : 'Cost spike'} ·{' '}
                  {a.threshold.comparator} {fmtUsd(a.threshold.value)} over {a.threshold.period}
                  {a.lastTriggeredAt ? ` · last fired ${formatRelative(a.lastTriggeredAt)}` : ''}
                </div>
              </div>
              <span
                className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wide ${
                  a.enabled
                    ? 'border border-success bg-success-subtle text-success'
                    : 'border border-border bg-bg-subtle text-fg-faint'
                }`}
              >
                {a.enabled ? 'enabled' : 'disabled'}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

// --- Export CSV -----------------------------------------------------------

function ExportCsvButton({
  data,
  window: windowSel,
}: {
  data: ThreeBreakdowns;
  window: SpendWindow;
}) {
  const onClick = () => {
    const csv = buildSpendCsv(data, windowSel);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const today = new Date().toISOString().slice(0, 10);
    a.download = `spend_${windowSel}_${today}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex min-h-touch items-center rounded-md border border-border bg-bg-elevated px-3 py-1.5 text-xs font-medium text-fg hover:bg-bg-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
    >
      Export CSV
    </button>
  );
}

/**
 * Build a CSV containing the timeseries + all three breakdown axes
 * stacked as separate sections. Excel / Sheets parses the multi-section
 * layout cleanly because each section starts with a header row.
 *
 * Exported for unit testing.
 */
export function buildSpendCsv(data: ThreeBreakdowns, windowSel: SpendWindow): string {
  const lines: string[] = [];
  lines.push(`# spend export window=${windowSel} generated=${data.capability.generatedAt}`);
  lines.push('# totals');
  lines.push('cost_usd,tokens_input,tokens_output,runs');
  lines.push(
    [
      data.capability.totals.costUsd,
      data.capability.totals.tokensInput,
      data.capability.totals.tokensOutput,
      data.capability.totals.runs,
    ].join(','),
  );
  lines.push('');
  lines.push('# timeseries');
  lines.push('date_bucket,cost_usd,tokens,runs');
  for (const p of data.capability.timeseries) {
    lines.push([p.dateBucket, p.costUsd, p.tokens, p.runs].join(','));
  }
  for (const [axis, payload] of [
    ['capability', data.capability],
    ['agent', data.agent],
    ['project', data.project],
  ] as const) {
    lines.push('');
    lines.push(`# breakdown by ${axis}`);
    lines.push('key,cost_usd,tokens_input,tokens_output,runs,percent_of_total');
    for (const r of payload.breakdown) {
      lines.push(
        [escapeCsv(r.key), r.costUsd, r.tokensInput, r.tokensOutput, r.runs, r.percentOfTotal].join(
          ',',
        ),
      );
    }
  }
  return `${lines.join('\n')}\n`;
}

function escapeCsv(s: string): string {
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replaceAll('"', '""')}"`;
  }
  return s;
}

// --- Empty state ----------------------------------------------------------

function EmptyState() {
  return (
    <div className="rounded-md border border-dashed border-border bg-bg-elevated px-6 py-12 text-center">
      <p className="text-sm font-medium text-fg">No spend yet.</p>
      <p className="mt-1 text-xs text-fg-muted">
        Try a run from{' '}
        <Link href="/playground" className="text-fg underline hover:text-fg-muted">
          /playground
        </Link>{' '}
        — cost rolls up here within a minute of completion.
      </p>
    </div>
  );
}

// --- Card chrome ----------------------------------------------------------

function Card({
  title,
  subtitle,
  actions,
  children,
}: {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-md border border-border bg-bg-elevated">
      <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-fg">{title}</h2>
          {subtitle ? <p className="text-xs text-fg-muted">{subtitle}</p> : null}
        </div>
        {actions}
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}

// --- Format helpers -------------------------------------------------------

export function fmtUsd(n: number): string {
  if (n === 0) return '$0';
  if (Math.abs(n) < 0.01) return `$${n.toFixed(4)}`;
  if (Math.abs(n) < 1) return `$${n.toFixed(3)}`;
  if (Math.abs(n) < 100) return `$${n.toFixed(2)}`;
  if (Math.abs(n) < 10_000) return `$${n.toFixed(0)}`;
  if (Math.abs(n) < 1_000_000) return `$${(n / 1_000).toFixed(1)}k`;
  return `$${(n / 1_000_000).toFixed(2)}m`;
}

function fmtSignedUsd(n: number): string {
  const sign = n > 0 ? '+' : n < 0 ? '−' : '';
  return `${sign}${fmtUsd(Math.abs(n))}`;
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}

function formatRelative(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const diffMs = Date.now() - d.getTime();
  const sec = Math.round(diffMs / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  return `${day}d ago`;
}
