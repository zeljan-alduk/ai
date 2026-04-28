/**
 * Server-rendered project list. Pure presentation — the create
 * dialog (`<CreateProjectButton />`) is the only client island on
 * this page.
 */

import { formatRelativeTime } from '@/lib/format';
import type { Project } from '@aldo-ai/api-contract';
import Link from 'next/link';

export function ProjectsList({
  projects,
  showArchived,
}: {
  projects: ReadonlyArray<Project>;
  showArchived: boolean;
}) {
  if (projects.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-10 text-center">
        <p className="text-sm font-medium text-slate-700">No projects yet</p>
        <p className="mt-1 text-xs text-slate-500">
          Create your first project to start grouping agents, runs, and datasets.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3 text-xs text-slate-500">
        <span>
          {projects.length} project{projects.length === 1 ? '' : 's'}
        </span>
        <span className="text-slate-300">·</span>
        {showArchived ? (
          <Link href="/projects" className="text-blue-600 hover:underline">
            Hide archived
          </Link>
        ) : (
          <Link href="/projects?archived=1" className="text-blue-600 hover:underline">
            Show archived
          </Link>
        )}
      </div>
      <ul className="flex flex-col divide-y divide-slate-100 overflow-hidden rounded-lg border border-slate-200 bg-white">
        {projects.map((p) => (
          <li key={p.id}>
            <Link
              href={`/projects/${encodeURIComponent(p.slug)}`}
              className="flex items-baseline gap-3 px-4 py-3 transition hover:bg-slate-50"
            >
              <span className="font-medium text-slate-900">{p.name}</span>
              <span className="font-mono text-[11px] text-slate-500">{p.slug}</span>
              {p.archivedAt !== null ? (
                <span className="rounded-full border border-slate-200 bg-slate-100 px-2 py-0.5 text-[10px] uppercase tracking-wider text-slate-600">
                  archived
                </span>
              ) : null}
              <span className="ml-auto text-[11px] text-slate-500">
                created {formatRelativeTime(p.createdAt)}
              </span>
            </Link>
            {p.description !== '' ? (
              <p className="px-4 pb-3 text-xs text-slate-600">{p.description}</p>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
