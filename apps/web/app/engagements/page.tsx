/**
 * /engagements — MISSING_PIECES §12.4 (Wave-Agency).
 *
 * Lists every engagement in the current tenant. An engagement groups
 * a customer's milestones + sign-off + threaded comments around a
 * piece of work the agency is doing for them. Threads were the
 * closest analogue today; engagements add the SOW-shaped semantics
 * threads lacked.
 *
 * Server-component first: this page owns the data fetch and renders
 * static markup. Status filter is a link-driven URL param.
 *
 * LLM-agnostic — rows display opaque slug + name strings only.
 */

import { CreateEngagementForm } from '@/components/engagements/create-form';
import { ErrorView } from '@/components/error-boundary';
import { EmptyState } from '@/components/empty-state';
import { PageHeader } from '@/components/page-header';
import { Card } from '@/components/ui/card';
import { listEngagementsApi } from '@/lib/api';
import { formatRelativeTime } from '@/lib/format';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

const STATUS_FILTERS = ['active', 'paused', 'complete', 'archived'] as const;

const STATUS_PILL: Record<string, string> = {
  active: 'bg-success/12 text-success ring-success/30',
  paused: 'bg-warning/12 text-warning ring-warning/30',
  complete: 'bg-accent/12 text-accent ring-accent/30',
  archived: 'bg-fg-muted/15 text-fg-muted ring-border',
};

export default async function EngagementsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const rawStatus = Array.isArray(sp.status) ? sp.status[0] : sp.status;
  const status =
    typeof rawStatus === 'string' && (STATUS_FILTERS as readonly string[]).includes(rawStatus)
      ? rawStatus
      : undefined;

  let result: Awaited<ReturnType<typeof listEngagementsApi>> | null = null;
  let error: unknown = null;
  try {
    result = await listEngagementsApi(status !== undefined ? { status } : {});
  } catch (err) {
    error = err;
  }

  if (error !== null) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-8">
        <PageHeader
          title="Customer engagements"
          description="Milestones · sign-off · change-request comments. The engagement-shaped surface threads lacked."
        />
        <ErrorView error={error} context="loading engagements" />
      </div>
    );
  }

  const rows = result?.engagements ?? [];

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <PageHeader
        title="Customer engagements"
        description="Milestones · sign-off · change-request comments. The engagement-shaped surface threads lacked."
      />

      <div className="mt-6 flex flex-wrap items-center gap-3 text-sm">
        <Link
          href="/engagements"
          className={`rounded-full px-3 py-1 ring-1 ${
            status === undefined
              ? 'bg-accent/12 text-accent ring-accent/30'
              : 'bg-bg-subtle/40 text-fg-muted ring-border hover:text-fg'
          }`}
        >
          All
        </Link>
        {STATUS_FILTERS.map((s) => (
          <Link
            key={s}
            href={`/engagements?status=${s}`}
            className={`rounded-full px-3 py-1 ring-1 ${
              status === s
                ? STATUS_PILL[s]
                : 'bg-bg-subtle/40 text-fg-muted ring-border hover:text-fg'
            }`}
          >
            {s}
          </Link>
        ))}
      </div>

      <Card className="mt-6 p-6">
        <h2 className="text-base font-semibold text-fg">Start a new engagement</h2>
        <p className="mt-1 text-sm text-fg-muted">
          Create a slug for the customer's project. Add milestones + comments after.
        </p>
        <CreateEngagementForm />
      </Card>

      <div className="mt-8">
        {rows.length === 0 ? (
          <EmptyState
            title={
              status !== undefined
                ? `No ${status} engagements`
                : 'No engagements yet'
            }
            description="Engagements give a customer a place to review milestones, sign off on deliverables, and request changes mid-sprint."
          />
        ) : (
          <ul className="space-y-3">
            {rows.map((e) => (
              <li key={e.id}>
                <Link
                  href={`/engagements/${e.slug}`}
                  className="block rounded-xl border border-border bg-bg-subtle/30 p-5 transition hover:bg-bg-subtle/60"
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <span className="font-mono text-sm text-fg-faint">{e.slug}</span>
                      <span className="text-base font-semibold text-fg">{e.name}</span>
                    </div>
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ${
                        STATUS_PILL[e.status] ??
                        'bg-fg-muted/15 text-fg-muted ring-border'
                      }`}
                    >
                      {e.status}
                    </span>
                  </div>
                  {e.description ? (
                    <p className="mt-2 line-clamp-2 text-sm text-fg-muted">{e.description}</p>
                  ) : null}
                  <p className="mt-3 text-xs text-fg-faint">
                    Created {formatRelativeTime(e.createdAt)}
                    {e.archivedAt !== null
                      ? ` · archived ${formatRelativeTime(e.archivedAt)}`
                      : ''}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
