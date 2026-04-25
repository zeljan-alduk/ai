'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const NAV: ReadonlyArray<{ href: string; label: string; match: (p: string) => boolean }> = [
  { href: '/runs', label: 'Runs', match: (p) => p === '/runs' || p.startsWith('/runs/') },
  { href: '/agents', label: 'Agents', match: (p) => p === '/agents' || p.startsWith('/agents/') },
  {
    href: '/secrets',
    label: 'Secrets',
    match: (p) => p === '/secrets' || p.startsWith('/secrets/'),
  },
  { href: '/models', label: 'Models', match: (p) => p === '/models' || p.startsWith('/models/') },
  { href: '/eval', label: 'Eval', match: (p) => p === '/eval' || p.startsWith('/eval/') },
  { href: '/docs', label: 'Docs', match: (p) => p.startsWith('/docs') },
];

/** Match `/runs/<id>` and any sub-route (e.g. `/runs/<id>/debug`). */
const RUN_DETAIL_RE = /^\/runs\/([^/]+)(?:\/.*)?$/;

export function Sidebar() {
  const pathname = usePathname() ?? '/';
  const runMatch = RUN_DETAIL_RE.exec(pathname);
  const runId = runMatch?.[1] ? decodeURIComponent(runMatch[1]) : null;
  const onDebug = runId ? pathname === `/runs/${encodeURIComponent(runId)}/debug` : false;

  return (
    <aside className="flex w-56 shrink-0 flex-col border-r border-slate-200 bg-white">
      <div className="flex items-center gap-2 px-5 py-5 border-b border-slate-200">
        <div className="h-6 w-6 rounded bg-slate-900" aria-hidden />
        <div>
          <div className="text-sm font-semibold leading-tight text-slate-900">ALDO AI</div>
          <div className="text-[11px] uppercase tracking-wider text-slate-500">control plane</div>
        </div>
      </div>
      <nav className="flex flex-col gap-0.5 p-2">
        {NAV.map((item) => {
          const active = item.match(pathname);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`rounded px-3 py-2 text-sm transition-colors ${
                active ? 'bg-slate-900 text-white' : 'text-slate-700 hover:bg-slate-100'
              }`}
            >
              {item.label}
            </Link>
          );
        })}
        {runId ? (
          <div className="mt-1 ml-2 flex flex-col gap-0.5 border-l border-slate-200 pl-2">
            <div className="px-3 py-1 text-[10px] uppercase tracking-wider text-slate-400">
              Run {runId.slice(0, 8)}
            </div>
            <Link
              href={`/runs/${encodeURIComponent(runId)}`}
              className={`rounded px-3 py-1.5 text-xs transition-colors ${
                pathname === `/runs/${encodeURIComponent(runId)}`
                  ? 'bg-slate-200 text-slate-900'
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              Detail
            </Link>
            <Link
              href={`/runs/${encodeURIComponent(runId)}/debug`}
              className={`rounded px-3 py-1.5 text-xs transition-colors ${
                onDebug ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              Debug
            </Link>
          </div>
        ) : null}
      </nav>
      <div className="mt-auto border-t border-slate-200 p-4 text-[11px] leading-relaxed text-slate-500">
        v0 control plane. Read-only.
      </div>
    </aside>
  );
}
