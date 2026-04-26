'use client';

import type { AuditLogEntry } from '@aldo-ai/api-contract';
import { useState } from 'react';

export function AuditTable({ entries }: { entries: readonly AuditLogEntry[] }) {
  const [open, setOpen] = useState<AuditLogEntry | null>(null);
  return (
    <>
      <div className="overflow-hidden rounded-md border border-slate-200 bg-white">
        <table className="aldo-table">
          <thead>
            <tr>
              <th>When</th>
              <th>Actor</th>
              <th>Verb</th>
              <th>Object</th>
              <th>IP</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr
                key={e.id}
                onClick={() => setOpen(e)}
                onKeyDown={(ev) => {
                  if (ev.key === 'Enter' || ev.key === ' ') {
                    ev.preventDefault();
                    setOpen(e);
                  }
                }}
                tabIndex={0}
                className="cursor-pointer hover:bg-slate-50 focus:bg-slate-50 focus:outline-none"
              >
                <td className="text-xs text-slate-500">{new Date(e.at).toLocaleString()}</td>
                <td className="text-xs">
                  {e.actorUserId ? (
                    <span className="font-mono">{e.actorUserId.slice(0, 8)}…</span>
                  ) : e.actorApiKeyId ? (
                    <span className="font-mono text-amber-700">api-key</span>
                  ) : (
                    <span className="text-slate-400">system</span>
                  )}
                </td>
                <td>
                  <span className="font-mono text-xs text-slate-700">{e.verb}</span>
                </td>
                <td className="text-xs">
                  <span className="font-mono">{e.objectKind}</span>
                  {e.objectId ? <span className="ml-1 text-slate-500">/ {e.objectId}</span> : null}
                </td>
                <td className="text-xs text-slate-500">{e.ip ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {open ? (
        <div
          // biome-ignore lint/a11y/useSemanticElements: native <dialog> open semantics differ; this is a controlled overlay
          role="dialog"
          aria-modal="true"
          className="fixed inset-y-0 right-0 z-50 flex w-full max-w-lg flex-col border-l border-slate-200 bg-white shadow-lg"
        >
          <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
            <h3 className="text-sm font-semibold text-slate-900">Audit entry</h3>
            <button
              type="button"
              onClick={() => setOpen(null)}
              className="rounded px-2 py-1 text-sm text-slate-600 hover:bg-slate-100"
              aria-label="Close"
            >
              ×
            </button>
          </div>
          <div className="flex-1 overflow-auto p-5">
            <pre className="whitespace-pre-wrap break-all rounded bg-slate-50 p-3 font-mono text-xs text-slate-800">
              {JSON.stringify(open, null, 2)}
            </pre>
          </div>
        </div>
      ) : null}
    </>
  );
}
