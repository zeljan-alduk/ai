'use client';

/**
 * Center pane: detail view for the currently-selected timeline entry.
 *
 * Renders by entry kind:
 *  - message     → role + text (assistant rows get an "Edit message" affordance)
 *  - tool_call   → tool name + JSON args
 *  - tool_result → JSON result (with isError chrome if present)
 *  - paused      → checkpoint id + pretty payload
 *  - other       → JSON payload
 */

import type { TimelineEntry } from './timeline';

export function StatePane({
  entry,
  onEditMessage,
}: {
  entry: TimelineEntry | null;
  onEditMessage: (messageIndex: number, currentText: string) => void;
}) {
  if (!entry) {
    return (
      <section className="flex flex-1 items-center justify-center rounded-md border border-dashed border-slate-300 bg-white px-6 py-12 text-sm text-slate-500">
        Select an event from the timeline to inspect it.
      </section>
    );
  }

  return (
    <section className="flex flex-1 flex-col rounded-md border border-slate-200 bg-white">
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            {entry.type}
          </span>
          <span className="font-mono text-[11px] text-slate-500" title={entry.at}>
            {entry.at}
          </span>
        </div>
        <span className="text-[10px] uppercase tracking-wider text-slate-400">
          {entry.source === 'live' ? 'live' : 'persisted'}
        </span>
      </div>
      <div className="flex-1 overflow-y-auto p-4">
        <Body entry={entry} onEditMessage={onEditMessage} />
      </div>
    </section>
  );
}

function Body({
  entry,
  onEditMessage,
}: {
  entry: TimelineEntry;
  onEditMessage: (messageIndex: number, currentText: string) => void;
}) {
  const p = entry.payload as Record<string, unknown> | null | undefined;

  if (entry.type === 'message' && p) {
    const role = typeof p.role === 'string' ? p.role : 'message';
    const text = typeof p.text === 'string' ? p.text : '';
    const messageIndex = typeof p.messageIndex === 'number' ? p.messageIndex : 0;
    return (
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] uppercase tracking-wide text-slate-700">
            {role}
          </span>
          {role === 'assistant' ? (
            <button
              type="button"
              onClick={() => onEditMessage(messageIndex, text)}
              className="rounded border border-slate-300 bg-white px-2 py-1 text-xs hover:bg-slate-50"
            >
              Edit message
            </button>
          ) : null}
        </div>
        <pre className="whitespace-pre-wrap break-words rounded bg-slate-50 p-3 text-sm leading-relaxed text-slate-800">
          {text}
        </pre>
      </div>
    );
  }

  if (entry.type === 'tool_call' && p) {
    const tool = typeof p.tool === 'string' ? p.tool : typeof p.name === 'string' ? p.name : 'tool';
    return (
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <span className="text-xs uppercase tracking-wider text-slate-500">tool</span>
          <span className="font-mono text-sm text-slate-900">{tool}</span>
        </div>
        <Json title="args" value={p.args} />
      </div>
    );
  }

  if (entry.type === 'tool_result' && p) {
    const isError = p.isError === true;
    return (
      <div className="flex flex-col gap-3">
        {isError ? (
          <div className="rounded border border-red-200 bg-red-50 px-2 py-1 text-xs font-medium text-red-700">
            tool returned an error
          </div>
        ) : null}
        <Json title="result" value={p.result} />
      </div>
    );
  }

  if (entry.type === 'paused' && p) {
    const cid = typeof p.checkpointId === 'string' ? p.checkpointId : '(unknown)';
    const reason = typeof p.reason === 'string' ? p.reason : '(unknown)';
    return (
      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <div className="text-[11px] uppercase tracking-wider text-slate-500">Checkpoint</div>
            <div className="font-mono text-xs text-slate-800">{cid}</div>
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-wider text-slate-500">Reason</div>
            <div className="text-slate-800">{reason}</div>
          </div>
        </div>
        <Json title="payload" value={p} />
      </div>
    );
  }

  if (entry.type === 'checkpoint' && p) {
    const cid = typeof p.checkpointId === 'string' ? p.checkpointId : '(unknown)';
    return (
      <div className="flex flex-col gap-3">
        <div>
          <div className="text-[11px] uppercase tracking-wider text-slate-500">Checkpoint</div>
          <div className="font-mono text-xs text-slate-800">{cid}</div>
        </div>
        <Json title="payload" value={p.payload ?? p} />
      </div>
    );
  }

  return <Json title="payload" value={entry.payload} />;
}

function Json({ title, value }: { title: string; value: unknown }) {
  let body: string;
  try {
    body = JSON.stringify(value, null, 2);
  } catch {
    body = String(value);
  }
  return (
    <div>
      <div className="mb-1 text-[11px] uppercase tracking-wider text-slate-500">{title}</div>
      <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded bg-slate-900 p-3 text-xs leading-relaxed text-slate-100">
        {body}
      </pre>
    </div>
  );
}
