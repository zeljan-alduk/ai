/**
 * MISSING_PIECES §9 / Phase D — replay UI cycle tree for iterative runs.
 *
 * Server-rendered (no client island — collapse uses native `<details>`,
 * which the browser handles). The parent run-detail page only mounts
 * this component when the run carries at least one `cycle.start`
 * event; pre-§9 leaf runs and composite runs render their existing
 * tree/timeline panels unchanged.
 *
 * Each cycle panel surfaces:
 *   - Cycle header (cycle N / maxCycles, latency, tokens, USD)
 *   - Model response text (truncated at ~600 chars)
 *   - Tool calls + their results (icon-tagged on isError)
 *   - history.compressed event when fired in this cycle
 *   - run.terminated_by reason on the LAST cycle (when present)
 *
 * Design parity: matches the flame-graph's wave-13 semantic-token
 * theme so the two views can sit side-by-side in the run-detail tabs.
 */

import { NeutralBadge, StatusBadge } from '@/components/badge';
import type { RunEvent } from '@aldo-ai/api-contract';

export interface CycleTreeEvent {
  readonly type: string;
  readonly at: string;
  readonly payload: unknown;
}

/** Public testing helper: assemble one CyclePanel from a flat event list. */
export interface CyclePanel {
  readonly cycle: number;
  readonly maxCycles: number | null;
  readonly startedAt: string;
  readonly endedAt: string | null;
  readonly modelText: string;
  readonly toolCalls: ReadonlyArray<{
    readonly callId: string;
    readonly tool: string;
    readonly args: unknown;
  }>;
  readonly toolResults: ReadonlyArray<{
    readonly callId: string;
    readonly tool: string | null;
    readonly isError: boolean;
    readonly result: unknown;
  }>;
  readonly compression: {
    readonly strategy: string;
    readonly droppedMessages: number;
    readonly keptMessages: number;
  } | null;
  readonly usage: {
    readonly tokensIn: number;
    readonly tokensOut: number;
    readonly usd: number;
  } | null;
  readonly terminatedBy: { readonly reason: string } | null;
}

/**
 * Pure, exported for unit tests. Group a flat event stream into one
 * `CyclePanel` per cycle. Events without a `payload.cycle` (or that
 * arrived before the first `cycle.start`) are dropped — they belong
 * to other replay surfaces (timeline, events list).
 */
export function buildCyclePanels(events: readonly CycleTreeEvent[]): readonly CyclePanel[] {
  const panels = new Map<number, MutablePanel>();
  let lastCycle: number | null = null;

  const seen = (n: number): MutablePanel => {
    let p = panels.get(n);
    if (p === undefined) {
      p = {
        cycle: n,
        maxCycles: null,
        startedAt: '',
        endedAt: null,
        modelText: '',
        toolCalls: [],
        toolResults: [],
        compression: null,
        usage: null,
        terminatedBy: null,
      };
      panels.set(n, p);
    }
    return p;
  };

  for (const e of events) {
    const cycle = readCycle(e.payload);
    if (e.type === 'cycle.start' && typeof cycle === 'number') {
      const p = seen(cycle);
      p.startedAt = e.at;
      const maxCycles = (e.payload as { maxCycles?: number } | null)?.maxCycles;
      if (typeof maxCycles === 'number') p.maxCycles = maxCycles;
      lastCycle = cycle;
      continue;
    }
    if (e.type === 'model.response' && typeof cycle === 'number') {
      const p = seen(cycle);
      const usage = (e.payload as { usage?: CyclePanel['usage'] } | null)?.usage;
      if (usage) p.usage = usage;
      continue;
    }
    if (e.type === 'message') {
      // Assistant text after a model.response lands as `message`. We
      // capture text-only parts on the LAST opened cycle so the panel
      // body shows what the model actually said this turn.
      if (lastCycle === null) continue;
      const p = seen(lastCycle);
      const text = readAssistantText(e.payload);
      if (text.length > 0) p.modelText = text;
      continue;
    }
    if (e.type === 'tool_call') {
      if (lastCycle === null) continue;
      const p = seen(lastCycle);
      const tc = e.payload as
        | { callId?: string; tool?: string; args?: unknown }
        | null;
      if (tc?.callId !== undefined && tc.tool !== undefined) {
        p.toolCalls.push({ callId: tc.callId, tool: tc.tool, args: tc.args });
      }
      continue;
    }
    if (e.type === 'tool_result') {
      if (lastCycle === null) continue;
      const p = seen(lastCycle);
      const tr = e.payload as
        | { callId?: string; tool?: string; isError?: boolean; result?: unknown }
        | null;
      if (tr?.callId !== undefined) {
        p.toolResults.push({
          callId: tr.callId,
          tool: tr.tool ?? null,
          isError: tr.isError === true,
          result: tr.result,
        });
      }
      continue;
    }
    if (e.type === 'history.compressed' && typeof cycle === 'number') {
      const p = seen(cycle);
      const c = e.payload as
        | { strategy?: string; droppedMessages?: number; keptMessages?: number }
        | null;
      if (
        c?.strategy !== undefined &&
        typeof c.droppedMessages === 'number' &&
        typeof c.keptMessages === 'number'
      ) {
        p.compression = {
          strategy: c.strategy,
          droppedMessages: c.droppedMessages,
          keptMessages: c.keptMessages,
        };
      }
      continue;
    }
    if (e.type === 'run.terminated_by') {
      if (lastCycle === null) continue;
      const p = seen(lastCycle);
      const reason = (e.payload as { reason?: string } | null)?.reason;
      if (reason !== undefined) p.terminatedBy = { reason };
    }
  }
  return Array.from(panels.values()).sort((a, b) => a.cycle - b.cycle);
}

interface MutablePanel {
  cycle: number;
  maxCycles: number | null;
  startedAt: string;
  endedAt: string | null;
  modelText: string;
  toolCalls: Array<{ callId: string; tool: string; args: unknown }>;
  toolResults: Array<{
    callId: string;
    tool: string | null;
    isError: boolean;
    result: unknown;
  }>;
  compression: CyclePanel['compression'];
  usage: CyclePanel['usage'];
  terminatedBy: CyclePanel['terminatedBy'];
}

function readCycle(payload: unknown): number | null {
  if (payload === null || typeof payload !== 'object') return null;
  const v = (payload as { cycle?: unknown }).cycle;
  return typeof v === 'number' ? v : null;
}

function readAssistantText(payload: unknown): string {
  if (payload === null || typeof payload !== 'object') return '';
  const role = (payload as { role?: string }).role;
  if (role !== 'assistant') return '';
  const content = (payload as { content?: ReadonlyArray<{ type?: string; text?: string }> })
    .content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((p) => p?.type === 'text' && typeof p.text === 'string')
    .map((p) => p.text as string)
    .join('\n');
}

// ─── render ────────────────────────────────────────────────────────

export function CycleTree({ events }: { events: readonly RunEvent[] }) {
  const panels = buildCyclePanels(events as readonly CycleTreeEvent[]);
  if (panels.length === 0) return null;

  return (
    <section
      className="overflow-hidden rounded-md border border-slate-200 bg-white"
      data-testid="cycle-tree"
    >
      <header className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-700">
            Cycle tree
          </h2>
          <p className="text-xs text-slate-500">
            Iterative run with {panels.length} cycle{panels.length === 1 ? '' : 's'}.
            Click a cycle to expand its model response and tool dispatch.
          </p>
        </div>
      </header>
      <ol className="divide-y divide-slate-100">
        {panels.map((p) => (
          <li key={p.cycle} data-testid={`cycle-panel-${p.cycle}`}>
            <details open={p.cycle === panels.length || p.terminatedBy !== null}>
              <summary className="flex cursor-pointer flex-wrap items-center gap-3 px-4 py-3 text-sm hover:bg-slate-50">
                <span className="font-semibold text-slate-900">Cycle {p.cycle}</span>
                {p.maxCycles !== null ? (
                  <span className="font-mono text-[11px] text-slate-400">
                    / {p.maxCycles}
                  </span>
                ) : null}
                {p.usage !== null ? (
                  <>
                    <span
                      className="font-mono text-xs tabular-nums text-slate-700"
                      title="Tokens in / out"
                    >
                      {p.usage.tokensIn}/{p.usage.tokensOut}
                    </span>
                    <span
                      className="font-mono text-xs tabular-nums text-slate-700"
                      title="Cost (this cycle)"
                    >
                      ${p.usage.usd.toFixed(6)}
                    </span>
                  </>
                ) : null}
                {p.toolCalls.length > 0 ? (
                  <NeutralBadge>{p.toolCalls.length} tool call{p.toolCalls.length === 1 ? '' : 's'}</NeutralBadge>
                ) : null}
                {p.compression !== null ? (
                  <NeutralBadge>{p.compression.strategy}</NeutralBadge>
                ) : null}
                {p.terminatedBy !== null ? (
                  <StatusBadge status={p.terminatedBy.reason === 'maxCycles' ? 'cancelled' : 'completed'} />
                ) : null}
              </summary>
              <div className="space-y-3 border-t border-slate-100 bg-slate-50/50 px-4 py-3 text-sm">
                {p.modelText.length > 0 ? (
                  <div>
                    <div className="text-xs uppercase tracking-wide text-slate-500">
                      Model response
                    </div>
                    <pre className="mt-1 whitespace-pre-wrap break-words rounded border border-slate-200 bg-white p-2 font-mono text-xs text-slate-800">
                      {truncate(p.modelText, 600)}
                    </pre>
                  </div>
                ) : null}
                {p.toolCalls.length > 0 ? (
                  <div>
                    <div className="text-xs uppercase tracking-wide text-slate-500">
                      Tool dispatch
                    </div>
                    <ul className="mt-1 space-y-1">
                      {p.toolCalls.map((tc) => {
                        const r = p.toolResults.find((x) => x.callId === tc.callId);
                        return (
                          <li
                            key={tc.callId}
                            className="rounded border border-slate-200 bg-white p-2 font-mono text-xs"
                          >
                            <div className="flex items-center gap-2">
                              <span
                                className={
                                  r?.isError
                                    ? 'rounded bg-rose-100 px-1.5 py-0.5 text-rose-700'
                                    : 'rounded bg-emerald-100 px-1.5 py-0.5 text-emerald-700'
                                }
                              >
                                {r?.isError ? 'error' : 'ok'}
                              </span>
                              <span className="font-semibold text-slate-900">{tc.tool}</span>
                              <span className="text-slate-400">{tc.callId}</span>
                            </div>
                            <pre className="mt-1 whitespace-pre-wrap break-words text-[11px] text-slate-600">
                              {truncate(stringify(tc.args), 240)}
                            </pre>
                            {r !== undefined ? (
                              <pre className="mt-1 whitespace-pre-wrap break-words text-[11px] text-slate-700">
                                → {truncate(stringify(r.result), 320)}
                              </pre>
                            ) : null}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ) : null}
                {p.compression !== null ? (
                  <div className="rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">
                    History compressed via{' '}
                    <span className="font-mono">{p.compression.strategy}</span> — dropped{' '}
                    {p.compression.droppedMessages} messages, kept {p.compression.keptMessages}.
                  </div>
                ) : null}
                {p.terminatedBy !== null ? (
                  <div className="rounded border border-slate-300 bg-slate-100 p-2 text-xs text-slate-800">
                    Run terminated by:{' '}
                    <span className="font-mono">{p.terminatedBy.reason}</span>
                  </div>
                ) : null}
              </div>
            </details>
          </li>
        ))}
      </ol>
    </section>
  );
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return `${s.slice(0, n)}…`;
}

function stringify(v: unknown): string {
  if (typeof v === 'string') return v;
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}
