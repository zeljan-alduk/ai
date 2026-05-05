'use client';

/**
 * Live bench results table — rows fade in as each case completes,
 * and each row is click-to-expand: a panel slides open below with
 * the full prompt the model saw, the expected condition, the actual
 * output, the reasoning trace (when the provider emitted one), and
 * the evaluator's failure detail (json-schema validation errors,
 * regex failures, etc).
 *
 * Long inputs (the needle-haystack and long-context cases run 7-18 KB)
 * truncate by default with a "show full" toggle so the table doesn't
 * push the bench summary off the screen.
 */

import { useState } from 'react';
import type { BenchCaseRow, BenchSummary } from './bench-direct';

interface Props {
  readonly rows: readonly BenchCaseRow[];
  readonly summary: BenchSummary | null;
  readonly runError: string | null;
  readonly suiteCases: number;
}

export function BenchTable({ rows, summary, runError, suiteCases }: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const peakTps = peakTokps(rows);
  const placeholders = Math.max(0, suiteCases - rows.length);

  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="flex flex-col gap-4">
      {runError !== null ? (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
          {runError}
        </div>
      ) : null}

      <div className="overflow-x-auto rounded-lg border border-border bg-bg">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-bg-subtle/40 text-[10px] uppercase tracking-wide text-fg-muted">
              <th className="w-7 px-2 py-2" aria-label="expand" />
              <th className="px-3 py-2 text-left font-medium">Case</th>
              <th className="px-2 py-2 text-center font-medium">Pass</th>
              <th className="px-2 py-2 text-right font-medium">Total</th>
              <th className="px-2 py-2 text-right font-medium">TTFT</th>
              <th className="px-2 py-2 text-right font-medium">Tok in</th>
              <th className="px-2 py-2 text-right font-medium">Tok out</th>
              <th className="px-2 py-2 text-right font-medium">Reason</th>
              <th className="px-2 py-2 text-right font-medium">Tok/s</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const isOpen = expanded.has(r.id);
              return (
                <FragmentRow
                  key={r.id}
                  row={r}
                  isOpen={isOpen}
                  onToggle={() => toggle(r.id)}
                  peakTps={peakTps}
                />
              );
            })}
            {Array.from({ length: placeholders }, (_, i) => (
              <tr key={`pending-${i}`} className="border-b border-border/40 last:border-0">
                <td colSpan={9} className="px-3 py-2 text-xs text-fg-muted">
                  <span className="inline-block h-2 w-32 animate-pulse rounded bg-bg-subtle" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {summary !== null ? <SummaryFooter summary={summary} /> : null}
    </div>
  );
}

function FragmentRow({
  row,
  isOpen,
  onToggle,
  peakTps,
}: {
  row: BenchCaseRow;
  isOpen: boolean;
  onToggle: () => void;
  peakTps: number;
}) {
  return (
    <>
      <Row row={row} isOpen={isOpen} onToggle={onToggle} peakTps={peakTps} />
      {isOpen ? (
        <tr className="border-b border-border/60 last:border-0 bg-bg-subtle/30">
          <td colSpan={9} className="px-4 py-4">
            <ExpandedDetail row={row} />
          </td>
        </tr>
      ) : null}
    </>
  );
}

function Row({
  row,
  isOpen,
  onToggle,
  peakTps,
}: {
  row: BenchCaseRow;
  isOpen: boolean;
  onToggle: () => void;
  peakTps: number;
}) {
  const passSym = row.skipped
    ? {
        glyph: '–',
        class: 'bg-bg-subtle text-fg-muted',
        label: 'skipped',
      }
    : row.passed
      ? {
          glyph: '✓',
          class: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400',
          label: 'pass',
        }
      : row.error !== undefined
        ? {
            glyph: '!',
            class: 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
            label: 'error',
          }
        : { glyph: '✗', class: 'bg-red-500/15 text-red-600 dark:text-red-400', label: 'fail' };
  const tpsBarPct =
    row.tokPerSec !== null && peakTps > 0
      ? Math.min(100, Math.max(4, (row.tokPerSec / peakTps) * 100))
      : 0;
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: the dedicated chevron button inside this row provides keyboard access; the row-click is a redundant convenience for mouse users.
    <tr
      className={`animate-fade-in border-b border-border/60 last:border-0 cursor-pointer transition-colors hover:bg-bg-subtle/40 ${
        isOpen ? 'bg-bg-subtle/40' : ''
      }`}
      onClick={onToggle}
    >
      <td className="px-2 py-2 text-center align-top">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onToggle();
          }}
          aria-label={isOpen ? 'Collapse details' : 'Expand details'}
          aria-expanded={isOpen}
          className="inline-flex h-5 w-5 items-center justify-center rounded text-fg-muted hover:bg-bg-subtle hover:text-fg"
        >
          <svg
            viewBox="0 0 12 12"
            className={`h-3 w-3 transition-transform ${isOpen ? 'rotate-90' : ''}`}
            aria-hidden
          >
            <path
              d="M4 2 L8 6 L4 10"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </td>
      <td className="px-3 py-2 align-top font-mono text-fg">
        <div className="flex flex-col gap-0.5">
          <span>{row.id}</span>
          {row.error !== undefined ? (
            <span className="truncate font-normal text-[10px] text-amber-600/80 dark:text-amber-400/80">
              {row.error}
            </span>
          ) : null}
        </div>
      </td>
      <td className="px-2 py-2 text-center">
        <span
          className={`inline-flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-semibold ${passSym.class}`}
          aria-label={passSym.label}
          title={passSym.label}
        >
          {passSym.glyph}
        </span>
      </td>
      <td className="px-2 py-2 text-right font-mono tabular-nums text-fg-muted">
        {fmtMs(row.totalMs)}
      </td>
      <td className="px-2 py-2 text-right font-mono tabular-nums text-fg-muted">
        {row.ttftMs !== null ? fmtMs(row.ttftMs) : '—'}
      </td>
      <td className="px-2 py-2 text-right font-mono tabular-nums text-fg-muted">
        {row.tokensIn ?? '—'}
      </td>
      <td className="px-2 py-2 text-right font-mono tabular-nums text-fg-muted">
        {row.tokensOut ?? '—'}
      </td>
      <td className="px-2 py-2 text-right">
        {row.reasoningRatio !== null ? (
          <span
            className="rounded-full bg-violet-500/10 px-2 py-0.5 font-mono text-[10px] text-violet-700 dark:text-violet-400"
            title="Fraction of output tokens spent in reasoning_content"
          >
            {Math.round(row.reasoningRatio * 100)}%
          </span>
        ) : (
          <span className="font-mono text-[10px] text-fg-muted">—</span>
        )}
      </td>
      <td className="px-2 py-2 text-right">
        {row.tokPerSec !== null ? (
          <div className="flex items-center justify-end gap-2">
            <div className="hidden h-1.5 w-12 overflow-hidden rounded-full bg-bg-subtle sm:block">
              <div className="h-full bg-accent" style={{ width: `${tpsBarPct}%` }} />
            </div>
            <span className="font-mono tabular-nums text-fg">{row.tokPerSec.toFixed(1)}</span>
          </div>
        ) : (
          <span className="font-mono text-fg-muted">—</span>
        )}
      </td>
    </tr>
  );
}

// ── Expanded detail panel ────────────────────────────────────────────

const PROMPT_TRUNCATE = 600;

function ExpandedDetail({ row }: { row: BenchCaseRow }) {
  const expectLabel = describeExpect(row.expect);
  const evaluatorOk = row.skipped
    ? 'skipped — not evaluated'
    : row.passed
      ? 'pass'
      : row.error !== undefined
        ? `error: ${row.error}`
        : 'fail';
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Section
        title="Prompt"
        subtitle={`${row.input.length.toLocaleString()} chars · sent verbatim to ${row.tokensIn ?? '?'} input tokens`}
      >
        <CollapsibleText text={row.input} threshold={PROMPT_TRUNCATE} />
      </Section>

      <Section title="Expected" subtitle={expectLabel.subtitle}>
        <pre className="whitespace-pre-wrap break-words rounded-md border border-border bg-bg px-3 py-2 font-mono text-[12px] text-fg">
          {expectLabel.body}
        </pre>
      </Section>

      <Section
        title="Output"
        subtitle={`${row.output.length.toLocaleString()} chars · ${row.tokensOut ?? '?'} tokens · ${
          row.tokPerSec !== null ? `${row.tokPerSec.toFixed(1)} tok/s` : '—'
        }`}
        className="lg:col-span-2"
      >
        {row.output.length === 0 && row.error === undefined ? (
          <p className="rounded-md border border-dashed border-border bg-bg px-3 py-4 text-center text-xs text-fg-muted">
            (empty content — model produced no visible output)
          </p>
        ) : (
          <CollapsibleText
            text={row.output}
            threshold={PROMPT_TRUNCATE * 2}
            highlight={highlightForExpect(row.expect, row.output)}
          />
        )}
      </Section>

      {row.reasoningOutput.length > 0 ? (
        <Section
          title="Reasoning trace"
          subtitle={`${row.reasoningOutput.length.toLocaleString()} chars · model "thinking" content (excluded from evaluator)`}
          className="lg:col-span-2"
        >
          <CollapsibleText text={row.reasoningOutput} threshold={PROMPT_TRUNCATE} muted />
        </Section>
      ) : null}

      <Section title="Evaluator detail" subtitle={evaluatorOk} className="lg:col-span-2">
        {row.detail !== undefined ? (
          <pre className="whitespace-pre-wrap break-words rounded-md border border-border bg-bg px-3 py-2 font-mono text-[11px] text-fg-muted">
            {JSON.stringify(row.detail, null, 2)}
          </pre>
        ) : (
          <p className="rounded-md border border-dashed border-border bg-bg px-3 py-2 text-xs text-fg-muted">
            {row.passed ? 'Evaluator passed cleanly — no detail to show.' : 'No structured detail.'}
          </p>
        )}
      </Section>
    </div>
  );
}

function Section({
  title,
  subtitle,
  children,
  className,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex flex-col gap-1.5 ${className ?? ''}`}>
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-wider text-fg-muted">{title}</p>
        {subtitle !== undefined ? <p className="text-[10px] text-fg-muted">{subtitle}</p> : null}
      </div>
      {children}
    </div>
  );
}

function CollapsibleText({
  text,
  threshold,
  muted,
  highlight,
}: {
  text: string;
  threshold: number;
  muted?: boolean;
  highlight?: { needle: string; tone: 'pass' | 'fail' } | null;
}) {
  const [showFull, setShowFull] = useState(false);
  const isLong = text.length > threshold;
  const visible = !isLong || showFull ? text : `${text.slice(0, threshold)}…`;
  return (
    <div>
      <pre
        className={`max-h-[24rem] overflow-y-auto whitespace-pre-wrap break-words rounded-md border border-border bg-bg px-3 py-2 font-mono text-[12px] leading-relaxed ${
          muted ? 'text-fg-muted' : 'text-fg'
        }`}
      >
        {highlight ? renderHighlighted(visible, highlight) : visible}
      </pre>
      {isLong ? (
        <button
          type="button"
          onClick={() => setShowFull((v) => !v)}
          className="mt-1 text-[11px] font-medium text-accent hover:underline"
        >
          {showFull ? 'Show less' : `Show all ${text.length.toLocaleString()} chars`}
        </button>
      ) : null}
    </div>
  );
}

function renderHighlighted(
  text: string,
  highlight: { needle: string; tone: 'pass' | 'fail' },
): React.ReactNode {
  const idx = text.indexOf(highlight.needle);
  if (idx === -1) return text;
  const cls =
    highlight.tone === 'pass'
      ? 'rounded bg-emerald-500/25 px-0.5 text-emerald-800 dark:text-emerald-300'
      : 'rounded bg-red-500/25 px-0.5 text-red-800 dark:text-red-300';
  return (
    <>
      {text.slice(0, idx)}
      <mark className={cls}>{highlight.needle}</mark>
      {text.slice(idx + highlight.needle.length)}
    </>
  );
}

// Highlight the matched (or forbidden) needle in the output for the
// kinds where it's a literal — readers can spot at a glance why the
// case passed or failed.
function highlightForExpect(
  expect: BenchCaseRow['expect'],
  output: string,
): { needle: string; tone: 'pass' | 'fail' } | null {
  if (expect.kind === 'contains' && output.includes(expect.value)) {
    return { needle: expect.value, tone: 'pass' };
  }
  if (expect.kind === 'not_contains' && output.includes(expect.value)) {
    return { needle: expect.value, tone: 'fail' };
  }
  if (expect.kind === 'exact' && output.trim() === expect.value) {
    return { needle: expect.value, tone: 'pass' };
  }
  return null;
}

function describeExpect(expect: BenchCaseRow['expect']): { subtitle: string; body: string } {
  switch (expect.kind) {
    case 'contains':
      return { subtitle: 'output must contain this string', body: expect.value };
    case 'not_contains':
      return { subtitle: 'output must NOT contain this string', body: expect.value };
    case 'regex':
      return { subtitle: 'output must match this regular expression', body: expect.value };
    case 'exact':
      return { subtitle: 'output (trimmed) must equal this exactly', body: expect.value };
    case 'json_schema':
      return {
        subtitle: 'output must parse as JSON and validate against this schema',
        body: JSON.stringify(expect.schema, null, 2),
      };
    default: {
      const _exhaust: never = expect;
      void _exhaust;
      return { subtitle: 'unknown evaluator', body: '' };
    }
  }
}

// ── Summary footer ───────────────────────────────────────────────────

function SummaryFooter({ summary }: { summary: BenchSummary }) {
  const passClass =
    summary.passRate >= 0.9
      ? 'text-emerald-600 dark:text-emerald-400'
      : summary.passRate >= 0.6
        ? 'text-amber-600 dark:text-amber-400'
        : 'text-red-600 dark:text-red-400';
  return (
    <div className="grid grid-cols-2 gap-3 rounded-lg border border-border bg-bg px-4 py-3 text-xs sm:grid-cols-4">
      <Stat
        label="Pass"
        value={`${summary.passed}/${summary.total}`}
        sub={`${Math.round(summary.passRate * 100)}%`}
        accent={passClass}
      />
      <Stat
        label="Avg tok/s"
        value={summary.avgTokPerSec === null ? '—' : summary.avgTokPerSec.toFixed(1)}
      />
      <Stat
        label="Avg reasoning"
        value={
          summary.avgReasoningRatio === null
            ? '—'
            : `${Math.round(summary.avgReasoningRatio * 100)}%`
        }
      />
      <Stat label="P95 latency" value={`${(summary.p95LatencyMs / 1000).toFixed(1)} s`} />
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: string;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] uppercase tracking-wide text-fg-muted">{label}</span>
      <span className={`font-mono text-base font-semibold tabular-nums text-fg ${accent ?? ''}`}>
        {value}
        {sub !== undefined ? (
          <span className="ml-1 text-[10px] font-normal text-fg-muted">{sub}</span>
        ) : null}
      </span>
    </div>
  );
}

function peakTokps(rows: readonly BenchCaseRow[]): number {
  let p = 0;
  for (const r of rows) if (r.tokPerSec !== null && r.tokPerSec > p) p = r.tokPerSec;
  return p;
}

function fmtMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}
