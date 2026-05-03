/**
 * /threads/[id] — wave-19 (Backend + Frontend Engineer).
 *
 * Chat-style transcript view for a single thread. Pulls the thread head
 * (run summaries) AND the flat event timeline in parallel so the page
 * renders a complete conversation in one round of fetches.
 *
 * Layout:
 *   - Header card: thread id (short) + run count + agents + total cost
 *   - Per-run section: a card striped by runId; inside, a chronological
 *     stack of message / tool_call / tool_result / error rows.
 *
 * The "chat" framing intentionally leans on payload shape rather than
 * forcing every event into a strict role. The UI displays:
 *   - `message` events with a payload string `text` -> message bubble
 *   - `tool_call` -> tool-call card (name + args)
 *   - `tool_result` -> tool-result card (output)
 *   - `error` -> red-tinted error card
 *   - everything else -> compact monospaced row
 *
 * LLM-agnostic: nothing in this file branches on a specific provider.
 */

import { NeutralBadge, StatusBadge } from '@/components/badge';
import { ErrorView } from '@/components/error-boundary';
import { PageHeader } from '@/components/page-header';
import { ThreadTranscript } from '@/components/threads/thread-transcript';
import { Card, CardContent } from '@/components/ui/card';
import { getThreadApi, getThreadTimelineApi } from '@/lib/api';
import { formatRelativeTime, formatUsd } from '@/lib/format';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

export default async function ThreadDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  let head: Awaited<ReturnType<typeof getThreadApi>> | null = null;
  let timeline: Awaited<ReturnType<typeof getThreadTimelineApi>> | null = null;
  let error: unknown = null;
  try {
    [head, timeline] = await Promise.all([getThreadApi(id), getThreadTimelineApi(id)]);
  } catch (err) {
    error = err;
  }

  return (
    <>
      <PageHeader
        title={`Thread ${id.length > 24 ? `${id.slice(0, 24)}…` : id}`}
        description="Chat-style transcript across every run that shares this thread_id."
        actions={
          <Link
            href="/threads"
            className="rounded border border-border bg-bg-elevated px-3 py-1 text-sm hover:bg-bg-subtle"
          >
            All threads
          </Link>
        }
      />
      {error ? (
        <ErrorView error={error} context="this thread" />
      ) : head !== null && timeline !== null ? (
        <div className="flex flex-col gap-6">
          <Card>
            <CardContent className="pt-6">
              <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                <Field label="Status">
                  <StatusBadge status={head.thread.lastStatus as never} />
                </Field>
                <Field label="Runs">
                  <span className="font-mono tabular-nums text-fg">{head.thread.runCount}</span>
                </Field>
                <Field label="Total cost">
                  <span className="font-mono tabular-nums text-fg">
                    {formatUsd(head.thread.totalUsd)}
                  </span>
                </Field>
                <Field label="Last activity">
                  <span className="text-sm text-fg" title={head.thread.lastActivityAt}>
                    {formatRelativeTime(head.thread.lastActivityAt)}
                  </span>
                </Field>
                <Field label="Began">
                  <span className="text-sm text-fg" title={head.thread.firstActivityAt}>
                    {formatRelativeTime(head.thread.firstActivityAt)}
                  </span>
                </Field>
                <Field label="Agents">
                  <div className="flex flex-wrap gap-1">
                    {head.thread.agentNames.map((n) => (
                      <NeutralBadge key={n}>{n}</NeutralBadge>
                    ))}
                  </div>
                </Field>
                <Field label="thread_id">
                  <span
                    className="block max-w-full truncate font-mono text-xs text-fg-muted"
                    title={head.thread.id}
                  >
                    {head.thread.id}
                  </span>
                </Field>
              </div>
            </CardContent>
          </Card>

          <ThreadTranscript runs={head.runs} events={timeline.events} />
        </div>
      ) : null}
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] uppercase tracking-wider text-fg-faint">{label}</div>
      <div className="mt-1">{children}</div>
    </div>
  );
}
