'use client';

/**
 * Wave-13 /runs selection toolbar — slides in from the bottom when one
 * or more rows are selected. Bulk actions:
 *
 *   * Export — synthesises CSV + JSON Blob downloads in the browser
 *   * Archive — POST /v1/runs/bulk { action: 'archive' }
 *   * Unarchive — same, with action: 'unarchive'
 *   * Label — prompts for a tag and POSTs add-tag
 *
 * The state machine + export helpers live in `bulk-selection.ts` so
 * the React surface here stays focused on UI orchestration.
 */

import { Button } from '@/components/ui';
import { Input } from '@/components/ui/input';
import { bulkRunAction } from '@/lib/api';
import type { RunSummary } from '@aldo-ai/api-contract';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { type ExportableRun, exportToCsv, exportToJson } from './bulk-selection';

export interface SelectionToolbarProps {
  readonly selectedIds: ReadonlyArray<string>;
  readonly visibleRuns: ReadonlyArray<RunSummary>;
  readonly onClear: () => void;
}

export function SelectionToolbar({ selectedIds, visibleRuns, onClear }: SelectionToolbarProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [showLabel, setShowLabel] = useState(false);
  const [labelText, setLabelText] = useState('');
  const [error, setError] = useState<string | null>(null);

  if (selectedIds.length === 0) return null;

  const selectedSet = new Set(selectedIds);
  const selectedRuns: ExportableRun[] = visibleRuns
    .filter((r) => selectedSet.has(r.id))
    .map(toExportable);

  const onExport = (kind: 'csv' | 'json') => {
    const text = kind === 'csv' ? exportToCsv(selectedRuns) : exportToJson(selectedRuns);
    const mime = kind === 'csv' ? 'text/csv' : 'application/json';
    const blob = new Blob([text], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `runs-${new Date().toISOString().replace(/[:.]/g, '-')}.${kind}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const runBulk = async (action: 'archive' | 'unarchive' | 'add-tag', tag?: string) => {
    setError(null);
    try {
      await bulkRunAction({
        runIds: [...selectedIds],
        action,
        ...(tag !== undefined ? { tag } : {}),
      });
      onClear();
      startTransition(() => router.refresh());
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div
      role="toolbar"
      aria-label="Run selection actions"
      className="fixed inset-x-0 bottom-4 z-40 flex justify-center"
    >
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-bg-elevated px-4 py-2 shadow-lg">
        <span className="text-sm font-medium">{selectedIds.length} selected</span>
        <div className="h-4 w-px bg-border" aria-hidden="true" />
        <Button variant="secondary" size="sm" type="button" onClick={() => onExport('csv')}>
          Export CSV
        </Button>
        <Button variant="secondary" size="sm" type="button" onClick={() => onExport('json')}>
          Export JSON
        </Button>
        <Button
          variant="secondary"
          size="sm"
          type="button"
          disabled={pending}
          onClick={() => void runBulk('archive')}
        >
          Archive
        </Button>
        <Button
          variant="secondary"
          size="sm"
          type="button"
          disabled={pending}
          onClick={() => void runBulk('unarchive')}
        >
          Unarchive
        </Button>
        {showLabel ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (labelText.trim().length === 0) return;
              void runBulk('add-tag', labelText.trim());
              setLabelText('');
              setShowLabel(false);
            }}
            className="flex items-center gap-1"
          >
            <Input
              value={labelText}
              onChange={(e) => setLabelText(e.target.value)}
              placeholder="tag"
              autoFocus
              className="h-8 w-32 text-xs"
              aria-label="Tag to apply"
            />
            <Button size="sm" type="submit">
              Apply
            </Button>
            <Button
              variant="ghost"
              size="sm"
              type="button"
              onClick={() => {
                setShowLabel(false);
                setLabelText('');
              }}
            >
              Cancel
            </Button>
          </form>
        ) : (
          <Button variant="secondary" size="sm" type="button" onClick={() => setShowLabel(true)}>
            Label
          </Button>
        )}
        <div className="h-4 w-px bg-border" aria-hidden="true" />
        <Button variant="ghost" size="sm" type="button" onClick={onClear}>
          Clear
        </Button>
        {error ? <span className="text-xs text-danger">{error}</span> : null}
      </div>
    </div>
  );
}

function toExportable(r: RunSummary): ExportableRun {
  const tags = r.tags;
  return {
    id: r.id,
    agentName: r.agentName,
    agentVersion: r.agentVersion,
    status: r.status,
    startedAt: r.startedAt,
    endedAt: r.endedAt,
    durationMs: r.durationMs,
    totalUsd: r.totalUsd,
    lastProvider: r.lastProvider,
    lastModel: r.lastModel,
    ...(tags !== undefined ? { tags } : {}),
  };
}
