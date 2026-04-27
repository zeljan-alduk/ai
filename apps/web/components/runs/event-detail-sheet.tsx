'use client';

/**
 * Side-panel sheet for inspecting a flame-graph node + its events.
 *
 * Wraps Engineer S's `Sheet` (Radix Dialog under the hood). The flame
 * graph fires `onSelect` → we set `node` and the sheet opens. Closing
 * fires `onClose` → we clear the node and the sheet collapses.
 *
 * The brief calls for syntax-highlighted JSON; we keep a small zero-
 * dep highlighter inline rather than pull `prismjs` into the bundle
 * for one component. The output is plain HTML with semantic spans.
 *
 * LLM-agnostic: never colours by provider.
 */

import { StatusBadge } from '@/components/badge';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { formatDuration, formatUsd } from '@/lib/format';
import type { RunEvent, RunTreeNode } from '@aldo-ai/api-contract';

export function EventDetailSheet({
  open,
  node,
  events,
  onClose,
}: {
  open: boolean;
  node: RunTreeNode | null;
  events: ReadonlyArray<RunEvent>;
  onClose: () => void;
}) {
  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      {/* Wave-15E — full-screen sheet on mobile (`w-screen` + override
          the primitive's default 420px width); cap at `max-w-lg` from
          `sm:` upward. */}
      <SheetContent side="right" className="w-screen max-w-full sm:max-w-lg">
        {node !== null ? (
          <>
            <SheetHeader>
              <SheetTitle>{node.agentName}</SheetTitle>
              <SheetDescription>
                <span className="font-mono text-[11px] text-fg-muted">{node.runId}</span>
              </SheetDescription>
            </SheetHeader>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-fg-muted">
              <StatusBadge status={node.status} />
              <span title="Duration">{formatDuration(node.durationMs)}</span>
              <span title="Cost">{formatUsd(node.totalUsd)}</span>
            </div>
            <div className="mt-4 space-y-4">
              <KeyValueGrid
                rows={[
                  ['Started', node.startedAt],
                  ['Ended', node.endedAt ?? '—'],
                  ['Last model', node.lastModel ?? '—'],
                  ['Class used', node.classUsed ?? '—'],
                  ['Parent run', node.parentRunId ?? '—'],
                ]}
              />
              <section>
                <h3 className="text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
                  Events for this span
                </h3>
                {events.length === 0 ? (
                  <p className="mt-2 text-xs text-fg-muted">
                    No event payloads recorded yet for this span.
                  </p>
                ) : (
                  <ol className="mt-2 space-y-3">
                    {events.map((ev) => (
                      <li
                        key={ev.id}
                        className="rounded border border-border bg-bg-subtle px-3 py-2 text-xs"
                      >
                        <div className="mb-1 flex items-baseline gap-2">
                          <span className="font-mono text-[10px] uppercase tracking-wider text-fg-muted">
                            {ev.type}
                          </span>
                          <span className="text-[10px] text-fg-muted">{ev.at}</span>
                        </div>
                        <pre
                          className="overflow-x-auto whitespace-pre-wrap break-words font-mono text-[11px] text-fg"
                          // biome-ignore lint/security/noDangerouslySetInnerHtml: trusted server payload, escaped via highlightJson
                          dangerouslySetInnerHTML={{ __html: highlightJson(ev.payload) }}
                        />
                      </li>
                    ))}
                  </ol>
                )}
              </section>
            </div>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function KeyValueGrid({ rows }: { rows: ReadonlyArray<[string, string]> }) {
  return (
    <dl className="grid grid-cols-3 gap-x-3 gap-y-2 text-xs">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-fg-muted">{k}</dt>
          <dd className="col-span-2 break-all text-fg">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * Tiny zero-dep JSON highlighter. Returns escaped HTML with semantic
 * `<span>`s so a stylesheet (or Tailwind utility classes) can colour
 * keys, strings, numbers, booleans separately. Defensive against
 * non-serialisable input.
 */
function highlightJson(payload: unknown): string {
  let json: string;
  try {
    json = JSON.stringify(payload, null, 2);
  } catch {
    return escapeHtml(String(payload));
  }
  if (json === undefined) return '';
  const escaped = escapeHtml(json);
  return escaped.replace(
    /("(\\u[a-fA-F0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g,
    (match) => {
      let cls = 'text-rose-700'; // numbers
      if (/^"/.test(match)) {
        cls = /:$/.test(match) ? 'text-sky-800 font-medium' : 'text-emerald-700';
      } else if (/true|false/.test(match)) {
        cls = 'text-amber-700';
      } else if (/null/.test(match)) {
        cls = 'text-slate-500';
      }
      return `<span class="${cls}">${match}</span>`;
    },
  );
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
