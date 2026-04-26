/**
 * Wave-13 — `/activity` page.
 *
 * Tenant-scoped, server-rendered timeline grouped by day. Each row
 * carries the actor (or "system"), the verb, the object link, and a
 * relative timestamp. Filter chips at the top by actor + verb.
 *
 * The activity_events table is append-only; no CRUD. Older pages are
 * paginated through the cursor returned by the API.
 *
 * LLM-agnostic: nothing here references a model provider.
 */

import { EmptyState } from '@/components/empty-state';
import { ErrorView } from '@/components/error-boundary';
import { PageHeader } from '@/components/page-header';
import { listActivityApi } from '@/lib/api';
import { formatAbsolute, formatRelativeTime } from '@/lib/format';
import type { ActivityEvent } from '@aldo-ai/api-contract';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

interface SearchParamsShape {
  readonly verb?: string | string[];
  readonly actor?: string | string[];
  readonly cursor?: string | string[];
}

export default async function ActivityPage({
  searchParams,
}: {
  searchParams: Promise<SearchParamsShape>;
}) {
  const params = await searchParams;
  const verb = pickFirst(params.verb);
  const actor = pickFirst(params.actor);
  const cursor = pickFirst(params.cursor);

  let body: Awaited<ReturnType<typeof listActivityApi>> | null = null;
  let error: unknown = null;
  try {
    body = await listActivityApi({
      limit: 100,
      ...(verb ? { verb } : {}),
      ...(actor ? { actorUserId: actor } : {}),
      ...(cursor ? { cursor } : {}),
    });
  } catch (err) {
    error = err;
  }

  // Build the actor / verb dropdown options out of the current page's
  // events. Good enough for v0; the API can hand back a dedicated
  // facet endpoint if a tenant grows large enough that the page
  // misses values.
  const actorChoices = uniq(
    (body?.events ?? [])
      .map((e) => ({ id: e.actorUserId, label: e.actorLabel }))
      .filter((a): a is { id: string; label: string | null } => a.id !== null),
  );
  const verbs = Array.from(new Set((body?.events ?? []).map((e) => e.verb))).sort();

  const grouped = groupByDay(body?.events ?? []);

  return (
    <>
      <PageHeader
        title="Activity"
        description="Recent actions across your tenant — who ran what, who updated which agent, and when."
      />
      <div className="mb-4 flex flex-wrap items-center gap-2 text-xs">
        <FilterDropdown
          label="Verb"
          name="verb"
          value={verb ?? null}
          options={verbs.map((v) => ({ value: v, label: v }))}
        />
        <FilterDropdown
          label="Actor"
          name="actor"
          value={actor ?? null}
          options={actorChoices.map((a) => ({ value: a.id, label: a.label ?? a.id }))}
        />
        {(verb || actor) && (
          <Link
            href="/activity"
            className="ml-2 rounded border border-slate-300 px-2 py-0.5 text-slate-600 hover:bg-slate-100"
          >
            Reset
          </Link>
        )}
      </div>

      {error ? (
        <ErrorView error={error} context="activity feed" />
      ) : body !== null && body.events.length === 0 ? (
        <EmptyState
          title="No activity yet."
          hint="Actions like running an agent or updating a spec will appear here."
        />
      ) : body !== null ? (
        <>
          {grouped.map((g) => (
            <section key={g.day} className="mb-6">
              <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                {g.day}
              </h2>
              <ol className="divide-y divide-slate-200 rounded-md border border-slate-200 bg-white">
                {g.events.map((e) => (
                  <ActivityRow key={e.id} event={e} />
                ))}
              </ol>
            </section>
          ))}
          {body.hasMore && body.nextCursor !== null ? (
            <div className="flex justify-center">
              <Link
                href={cursorHref(body.nextCursor, verb, actor)}
                className="rounded border border-slate-300 bg-white px-4 py-1.5 text-xs hover:bg-slate-100"
              >
                Load older
              </Link>
            </div>
          ) : null}
        </>
      ) : null}
    </>
  );
}

function ActivityRow({ event }: { event: ActivityEvent }) {
  const actorLabel =
    event.actorUserId === null ? 'system' : (event.actorLabel ?? event.actorUserId);
  const objectHref = objectLink(event);
  return (
    <li className="flex items-baseline gap-3 px-4 py-2">
      <span className="shrink-0 truncate text-xs font-medium text-slate-900" title={actorLabel}>
        {actorLabel}
      </span>
      <span className="shrink-0 text-xs text-slate-500">{event.verb}</span>
      <span className="min-w-0 flex-1 truncate text-xs text-slate-700">
        {objectHref ? (
          <Link href={objectHref} className="hover:underline">
            {event.objectKind}/{event.objectId}
          </Link>
        ) : (
          <span>
            {event.objectKind}/{event.objectId}
          </span>
        )}
      </span>
      <span className="shrink-0 text-[11px] text-slate-500" title={formatAbsolute(event.at)}>
        {formatRelativeTime(event.at)}
      </span>
    </li>
  );
}

function FilterDropdown({
  label,
  name,
  value,
  options,
}: {
  label: string;
  name: string;
  value: string | null;
  options: ReadonlyArray<{ value: string; label: string }>;
}) {
  return (
    <form method="GET" action="/activity" className="inline-flex items-center gap-1">
      <span className="text-slate-500">{label}:</span>
      <select
        name={name}
        defaultValue={value ?? ''}
        className="rounded border border-slate-300 bg-white px-2 py-0.5 text-xs"
      >
        <option value="">all</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <button
        type="submit"
        className="rounded border border-slate-300 bg-white px-2 py-0.5 text-xs hover:bg-slate-100"
      >
        Apply
      </button>
    </form>
  );
}

function pickFirst(v: string | string[] | undefined): string | undefined {
  if (Array.isArray(v)) return v[0];
  return v;
}

function uniq<T extends { id: string }>(arr: ReadonlyArray<T>): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const x of arr) {
    if (seen.has(x.id)) continue;
    seen.add(x.id);
    out.push(x);
  }
  return out;
}

function groupByDay(events: ReadonlyArray<ActivityEvent>): Array<{
  readonly day: string;
  readonly events: ReadonlyArray<ActivityEvent>;
}> {
  const out: Array<{ day: string; events: ActivityEvent[] }> = [];
  for (const e of events) {
    const day = formatAbsolute(e.at).slice(0, 10);
    const last = out[out.length - 1];
    if (last && last.day === day) {
      last.events.push(e);
    } else {
      out.push({ day, events: [e] });
    }
  }
  return out;
}

function objectLink(e: ActivityEvent): string | null {
  switch (e.objectKind) {
    case 'agent':
      return `/agents/${encodeURIComponent(e.objectId)}`;
    case 'run': {
      const runId =
        typeof e.metadata.runId === 'string' ? (e.metadata.runId as string) : e.objectId;
      return `/runs/${encodeURIComponent(runId)}`;
    }
    case 'sweep':
      return `/eval/sweeps/${encodeURIComponent(e.objectId)}`;
    case 'tenant':
      return null;
    default:
      return null;
  }
}

function cursorHref(cursor: string, verb: string | undefined, actor: string | undefined): string {
  const sp = new URLSearchParams();
  sp.set('cursor', cursor);
  if (verb) sp.set('verb', verb);
  if (actor) sp.set('actor', actor);
  return `/activity?${sp.toString()}`;
}
