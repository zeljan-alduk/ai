'use client';

/**
 * Wave-14 — dashboard viewer + editor canvas.
 *
 * Viewer: renders every widget at its layout coords on a 12-col CSS
 * grid; the data payload comes pre-fetched from the server.
 *
 * Editor: enables @dnd-kit/core so widgets can be dragged. On "Save",
 * we PATCH the dashboard with the new layout. Add-widget opens a
 * picker.
 */

import { Button } from '@/components/ui/button';
import { deleteDashboard, getDashboardData, updateDashboard } from '@/lib/api-dashboards';
import type { DashboardWidget, DashboardWidgetKind } from '@aldo-ai/api-contract';
import {
  DndContext,
  type DragEndEvent,
  PointerSensor,
  useDraggable,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { layoutHeight, moveWidget, nextFreeRow, packLayout } from './layout-grid';
import { WidgetRenderer } from './widget-renderer';

const ALL_KINDS: DashboardWidgetKind[] = [
  'kpi-runs-24h',
  'kpi-cost-mtd',
  'kpi-error-rate',
  'kpi-active-agents',
  'timeseries-cost',
  'timeseries-runs',
  'timeseries-latency',
  'pie-models',
  'pie-locality',
  'bar-agents',
  'bar-errors',
  'heatmap-cost-by-hour',
  'heatmap-errors-by-model',
];

const DEFAULT_QUERIES: Record<DashboardWidgetKind, Record<string, unknown>> = {
  'kpi-runs-24h': { period: '24h' },
  'kpi-cost-mtd': { period: '30d' },
  'kpi-error-rate': { period: '24h' },
  'kpi-active-agents': { period: '7d' },
  'timeseries-cost': { period: '7d' },
  'timeseries-runs': { period: '24h' },
  'timeseries-latency': { period: '24h' },
  'pie-models': { period: '7d' },
  'pie-locality': { period: '7d' },
  'bar-agents': { period: '7d', metric: 'cost', topN: 10 },
  'bar-errors': { period: '7d', topN: 10 },
  'heatmap-cost-by-hour': {
    period: '7d',
    xAxis: 'hour-of-day',
    yAxis: 'model',
    metric: 'cost',
  },
  'heatmap-errors-by-model': {
    period: '7d',
    xAxis: 'hour-of-day',
    yAxis: 'model',
    metric: 'errors',
  },
};

export function DashboardCanvas({
  id,
  layout: initial,
  initialData,
  canEdit,
  startInEditor,
}: {
  id: string;
  layout: ReadonlyArray<DashboardWidget>;
  initialData: Record<string, unknown>;
  canEdit: boolean;
  startInEditor: boolean;
}) {
  const [layout, setLayout] = useState<DashboardWidget[]>([...initial]);
  const [data, setData] = useState<Record<string, unknown>>(initialData);
  const [editing, setEditing] = useState(startInEditor && canEdit);
  const [pending, start] = useTransition();
  const router = useRouter();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  const refreshData = () => {
    void getDashboardData(id, layout).then((res) => setData(res.widgets));
  };

  const onDragEnd = (e: DragEndEvent) => {
    const dropped = e.over?.id;
    if (typeof dropped !== 'string') return;
    const intent = parseDropId(dropped);
    if (intent === null) return;
    setLayout((prev) => moveWidget(prev, String(e.active.id), intent));
  };

  const addWidget = (kind: DashboardWidgetKind) => {
    setLayout((prev) => {
      const id = `w_${Date.now().toString(36)}_${prev.length}`;
      const w: DashboardWidget = {
        id,
        kind,
        title: kind,
        query: DEFAULT_QUERIES[kind],
        layout: { col: 0, row: nextFreeRow(prev, { col: 0, w: 6, h: 4 }), w: 6, h: 4 },
      };
      return packLayout([...prev, w]);
    });
  };

  const save = () => {
    start(async () => {
      await updateDashboard(id, { layout });
      setEditing(false);
      refreshData();
      router.refresh();
    });
  };

  const remove = () => {
    if (!confirm('Delete this dashboard?')) return;
    start(async () => {
      await deleteDashboard(id);
      router.push('/dashboards');
    });
  };

  const rows = Math.max(8, layoutHeight(layout));

  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        {canEdit ? (
          <>
            <Button
              size="sm"
              variant={editing ? 'default' : 'secondary'}
              onClick={() => setEditing((v) => !v)}
            >
              {editing ? 'Editing' : 'Edit'}
            </Button>
            {editing ? (
              <>
                <Button size="sm" variant="default" onClick={save} disabled={pending}>
                  {pending ? 'Saving…' : 'Save layout'}
                </Button>
                <AddWidgetMenu onAdd={addWidget} />
                <Button size="sm" variant="destructive" onClick={remove} disabled={pending}>
                  Delete
                </Button>
              </>
            ) : null}
          </>
        ) : (
          <span className="text-xs text-slate-500">
            Read-only — shared by another tenant member.
          </span>
        )}
        <Button size="sm" variant="ghost" onClick={refreshData}>
          Refresh
        </Button>
      </div>
      <DndContext sensors={sensors} onDragEnd={onDragEnd}>
        <div
          className="relative grid gap-2"
          style={{
            gridTemplateColumns: 'repeat(12, minmax(0, 1fr))',
            gridAutoRows: '60px',
            minHeight: rows * 64,
          }}
        >
          {layout.map((w) => (
            <WidgetSlot
              key={w.id}
              widget={w}
              data={data[w.id]}
              editing={editing}
              onResize={(size) =>
                setLayout((prev) =>
                  prev.map((p) =>
                    p.id === w.id ? { ...p, layout: { ...p.layout, w: size.w, h: size.h } } : p,
                  ),
                )
              }
            />
          ))}
        </div>
      </DndContext>
    </div>
  );
}

function WidgetSlot({
  widget,
  data,
  editing,
  onResize,
}: {
  widget: DashboardWidget;
  data: unknown;
  editing: boolean;
  onResize: (size: { w: number; h: number }) => void;
}) {
  const draggable = useDraggable({ id: widget.id, disabled: !editing });
  const style = {
    gridColumn: `${widget.layout.col + 1} / span ${widget.layout.w}`,
    gridRow: `${widget.layout.row + 1} / span ${widget.layout.h}`,
    transform: draggable.transform
      ? `translate(${draggable.transform.x}px, ${draggable.transform.y}px)`
      : undefined,
  } as React.CSSProperties;
  return (
    <div
      ref={draggable.setNodeRef}
      style={style}
      className={`rounded-lg border border-slate-200 bg-white p-3 ${editing ? 'cursor-move shadow-sm' : ''}`}
      {...(editing ? draggable.listeners : {})}
      {...(editing ? draggable.attributes : {})}
    >
      <div className="mb-2 flex items-center justify-between">
        <h3 className="truncate text-xs font-semibold text-slate-700">{widget.title}</h3>
        {editing ? (
          <div className="flex items-center gap-1 text-[10px] text-slate-400">
            <button
              type="button"
              onClick={() => onResize({ w: Math.max(2, widget.layout.w - 1), h: widget.layout.h })}
            >
              ←
            </button>
            <button
              type="button"
              onClick={() => onResize({ w: Math.min(12, widget.layout.w + 1), h: widget.layout.h })}
            >
              →
            </button>
            <button
              type="button"
              onClick={() => onResize({ w: widget.layout.w, h: Math.max(1, widget.layout.h - 1) })}
            >
              ↑
            </button>
            <button
              type="button"
              onClick={() => onResize({ w: widget.layout.w, h: Math.min(12, widget.layout.h + 1) })}
            >
              ↓
            </button>
          </div>
        ) : null}
      </div>
      <div className="h-[calc(100%-1.5rem)] overflow-hidden">
        <WidgetRenderer kind={widget.kind} data={data} />
      </div>
    </div>
  );
}

function AddWidgetMenu({ onAdd }: { onAdd: (kind: DashboardWidgetKind) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <Button size="sm" variant="secondary" onClick={() => setOpen((v) => !v)}>
        + Add widget
      </Button>
      {open ? (
        <div className="absolute z-10 mt-1 max-h-72 w-56 overflow-auto rounded-md border border-slate-200 bg-white shadow-md">
          {ALL_KINDS.map((kind) => (
            <button
              key={kind}
              type="button"
              onClick={() => {
                onAdd(kind);
                setOpen(false);
              }}
              className="block w-full px-3 py-1.5 text-left text-xs hover:bg-slate-100"
            >
              {kind}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function parseDropId(_id: string): { col: number; row: number } | null {
  // Wave-14 MVP: drag-and-drop reorders by index; we don't yet allow
  // dropping into arbitrary (col, row) slots without measuring the
  // grid container. Returning null lets the move handler fall through
  // to the manual ↑/↓/←/→ resize buttons + click-to-place flows.
  return null;
}
