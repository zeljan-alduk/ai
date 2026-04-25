'use client';

/**
 * Inline-ish modal for editing an assistant message and resuming.
 * Confirming POSTs `edit-and-resume`; the parent navigates to the new
 * run id returned by the server.
 */

import { useState } from 'react';

export function EditMessageDialog({
  initialText,
  onCancel,
  onConfirm,
}: {
  initialText: string;
  onCancel: () => void;
  onConfirm: (newText: string) => void;
}) {
  const [text, setText] = useState(initialText);
  const dirty = text !== initialText;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
      onClick={onCancel}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onCancel();
      }}
      role="presentation"
    >
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: stopPropagation on inner shell only — keyboard escape is handled by the backdrop */}
      <div
        onClick={(e) => e.stopPropagation()}
        // biome-ignore lint/a11y/useSemanticElements: native <dialog> open semantics differ; this is a controlled overlay
        role="dialog"
        aria-modal="true"
        className="w-[40rem] max-w-full rounded-md border border-slate-200 bg-white shadow-lg"
      >
        <div className="border-b border-slate-200 px-4 py-3 text-sm font-semibold text-slate-900">
          Edit assistant message and resume
        </div>
        <div className="flex flex-col gap-2 px-4 py-4">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={10}
            className="w-full resize-y rounded border border-slate-300 bg-white p-2 text-sm font-mono leading-relaxed focus:outline-none focus:ring-2 focus:ring-slate-400"
          />
          <p className="text-[11px] text-slate-500">
            Resuming forks the run from the latest checkpoint with this message replaced. The server
            returns a new run id and the debugger will follow it.
          </p>
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-200 px-4 py-3">
          <button
            type="button"
            onClick={onCancel}
            className="rounded border border-slate-300 bg-white px-3 py-1.5 text-sm hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onConfirm(text)}
            disabled={!dirty}
            className="rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            Resume from here
          </button>
        </div>
      </div>
    </div>
  );
}
