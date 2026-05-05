/**
 * /engagements/[slug] — MISSING_PIECES §12.4 (Wave-Agency).
 *
 * Single-engagement detail with milestone timeline + threaded
 * comments + sign-off / reject controls. Server-component fetches
 * three resources in parallel; interactive bits (sign-off button,
 * comment composer, milestone composer) are client islands.
 *
 * LLM-agnostic — no model fields anywhere.
 */

import { CommentComposer } from '@/components/engagements/comment-composer';
import { MilestoneActions } from '@/components/engagements/milestone-actions';
import { MilestoneComposer } from '@/components/engagements/milestone-composer';
import { ErrorView } from '@/components/error-boundary';
import { PageHeader } from '@/components/page-header';
import { Card } from '@/components/ui/card';
import {
  getEngagementApi,
  listEngagementCommentsApi,
  listMilestonesApi,
} from '@/lib/api';
import { formatRelativeTime } from '@/lib/format';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

const STATUS_PILL: Record<string, string> = {
  active: 'bg-success/12 text-success ring-success/30',
  paused: 'bg-warning/12 text-warning ring-warning/30',
  complete: 'bg-accent/12 text-accent ring-accent/30',
  archived: 'bg-fg-muted/15 text-fg-muted ring-border',
};

const MILESTONE_PILL: Record<string, string> = {
  pending: 'bg-fg-muted/15 text-fg-muted ring-border',
  in_review: 'bg-warning/12 text-warning ring-warning/30',
  signed_off: 'bg-success/12 text-success ring-success/30',
  rejected: 'bg-danger/12 text-danger ring-danger/30',
};

const COMMENT_KIND_LABEL: Record<string, string> = {
  comment: 'Comment',
  change_request: 'Change request',
  architecture_decision: 'Architecture decision',
};

const COMMENT_KIND_PILL: Record<string, string> = {
  comment: 'bg-fg-muted/15 text-fg-muted ring-border',
  change_request: 'bg-warning/12 text-warning ring-warning/30',
  architecture_decision: 'bg-accent/12 text-accent ring-accent/30',
};

export default async function EngagementDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  let head: Awaited<ReturnType<typeof getEngagementApi>> | null = null;
  let milestones: Awaited<ReturnType<typeof listMilestonesApi>> | null = null;
  let comments: Awaited<ReturnType<typeof listEngagementCommentsApi>> | null = null;
  let error: unknown = null;
  try {
    [head, milestones, comments] = await Promise.all([
      getEngagementApi(slug),
      listMilestonesApi(slug),
      listEngagementCommentsApi(slug),
    ]);
  } catch (err) {
    error = err;
  }

  if (error !== null || head === null) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-8">
        <PageHeader title={slug} description="Engagement not found." />
        <ErrorView
          error={error ?? new Error('engagement missing')}
          context={`loading engagement ${slug}`}
        />
        <p className="mt-6">
          <Link href="/engagements" className="text-accent hover:text-accent-hover">
            ← Back to engagements
          </Link>
        </p>
      </div>
    );
  }

  const eng = head.engagement;
  const ms = milestones?.milestones ?? [];
  const cm = comments?.comments ?? [];

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <p className="mb-3 text-sm">
        <Link href="/engagements" className="text-fg-muted hover:text-fg">
          ← Engagements
        </Link>
      </p>
      <PageHeader title={eng.name} description={eng.description || ''} />

      <Card className="mt-4 flex flex-wrap items-center gap-4 p-5 text-sm">
        <span className="font-mono text-fg-faint">{eng.slug}</span>
        <span
          className={`rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ${
            STATUS_PILL[eng.status] ?? 'bg-fg-muted/15 text-fg-muted ring-border'
          }`}
        >
          {eng.status}
        </span>
        <span className="text-fg-muted">
          Created {formatRelativeTime(eng.createdAt)}
        </span>
        {eng.archivedAt !== null ? (
          <span className="text-fg-muted">
            Archived {formatRelativeTime(eng.archivedAt)}
          </span>
        ) : null}
      </Card>

      <section className="mt-8">
        <h2 className="text-lg font-semibold text-fg">Milestones</h2>
        <Card className="mt-3 p-5">
          <MilestoneComposer slug={eng.slug} />
        </Card>
        {ms.length === 0 ? (
          <p className="mt-3 text-sm text-fg-muted">
            No milestones yet — add the first checkpoint above.
          </p>
        ) : (
          <ol className="mt-4 space-y-3">
            {ms.map((m) => (
              <li
                key={m.id}
                className="rounded-xl border border-border bg-bg-subtle/30 p-5"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <span className="text-base font-semibold text-fg">{m.title}</span>
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ${
                        MILESTONE_PILL[m.status] ??
                        'bg-fg-muted/15 text-fg-muted ring-border'
                      }`}
                    >
                      {m.status.replace('_', ' ')}
                    </span>
                  </div>
                  {m.dueAt !== null ? (
                    <span className="text-xs text-fg-muted">
                      due {formatRelativeTime(m.dueAt)}
                    </span>
                  ) : null}
                </div>
                {m.description ? (
                  <p className="mt-2 text-sm text-fg-muted">{m.description}</p>
                ) : null}
                {m.status === 'signed_off' ? (
                  <p className="mt-2 text-xs text-fg-faint">
                    Signed off {m.signedOffAt !== null ? formatRelativeTime(m.signedOffAt) : ''}
                    {m.signedOffBy !== null ? ` by ${m.signedOffBy}` : ''}
                  </p>
                ) : null}
                {m.status === 'rejected' ? (
                  <p className="mt-2 text-xs text-danger">
                    Rejected: {m.rejectedReason ?? '(no reason given)'}
                  </p>
                ) : null}
                {m.status === 'pending' || m.status === 'in_review' ? (
                  <MilestoneActions slug={eng.slug} milestoneId={m.id} />
                ) : null}
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className="mt-10">
        <h2 className="text-lg font-semibold text-fg">Discussion</h2>
        <Card className="mt-3 p-5">
          <CommentComposer slug={eng.slug} />
        </Card>
        {cm.length === 0 ? (
          <p className="mt-3 text-sm text-fg-muted">
            No comments yet — start with an architectural decision or a change
            request.
          </p>
        ) : (
          <ul className="mt-4 space-y-3">
            {cm.map((c) => (
              <li
                key={c.id}
                className="rounded-xl border border-border bg-bg-subtle/30 p-5"
              >
                <div className="flex flex-wrap items-center gap-3">
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ${
                      COMMENT_KIND_PILL[c.kind] ??
                      'bg-fg-muted/15 text-fg-muted ring-border'
                    }`}
                  >
                    {COMMENT_KIND_LABEL[c.kind] ?? c.kind}
                  </span>
                  <span className="text-xs text-fg-faint">
                    {formatRelativeTime(c.at)}
                    {c.authorUserId !== null ? ` · ${c.authorUserId}` : ''}
                  </span>
                  {c.runId !== null ? (
                    <Link
                      href={`/runs/${c.runId}`}
                      className="text-xs text-accent hover:text-accent-hover"
                    >
                      run {c.runId.slice(0, 8)} →
                    </Link>
                  ) : null}
                </div>
                <p className="mt-2 whitespace-pre-wrap text-sm text-fg">{c.body}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
