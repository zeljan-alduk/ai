'use client';

/**
 * Client island that wires the trace flame graph to the side-panel.
 *
 * The parent (server component) hands us the resolved RunTreeNode +
 * the run's full event list; we map each clicked node to its events
 * by `runId` and open the Sheet.
 *
 * No data fetches happen here. Pure presentation + interactivity.
 */

import type { RunDetail, RunEvent, RunTreeNode } from '@aldo-ai/api-contract';
import { useState } from 'react';
import { EventDetailSheet } from './event-detail-sheet';
import { FlameGraph } from './flame-graph';

export function TimelineView({
  tree,
  run,
}: {
  tree: RunTreeNode;
  run: RunDetail;
}) {
  const [selected, setSelected] = useState<RunTreeNode | null>(null);

  // For the in-tree node we look up events from the parent run-detail
  // payload. v0 only ships the parent run's events to the client (the
  // child runs would each need their own /v1/runs/:id call); when the
  // user clicks a child bar we still surface the metadata (status,
  // model, cost) but show "no events for this span" until the runtime
  // ships per-child event hydration.
  const events: ReadonlyArray<RunEvent> =
    selected !== null && selected.runId === run.id ? run.events : [];

  return (
    <>
      <FlameGraph tree={tree} onSelect={setSelected} selectedRunId={selected?.runId ?? null} />
      <EventDetailSheet
        open={selected !== null}
        node={selected}
        events={events}
        onClose={() => setSelected(null)}
      />
    </>
  );
}
