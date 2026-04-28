/**
 * /projects/[slug] — project detail.
 *
 * Foundation-only: no scoped lists of agents/runs/datasets yet. The
 * page surfaces metadata + a settings island (rename / archive). When
 * the entity-scoping retrofit lands, this page will host the project's
 * own /agents, /runs, /datasets tabs.
 */

import { ErrorView } from '@/components/error-boundary';
import { PageHeader } from '@/components/page-header';
import { ProjectSettingsCard } from '@/components/projects/project-settings-card';
import { Card, CardContent } from '@/components/ui/card';
import { ApiClientError, getProjectBySlug } from '@/lib/api';
import { formatAbsolute, formatRelativeTime } from '@/lib/format';
import Link from 'next/link';
import { notFound } from 'next/navigation';

export const dynamic = 'force-dynamic';

export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  let data: Awaited<ReturnType<typeof getProjectBySlug>> | null = null;
  let error: unknown = null;
  try {
    data = await getProjectBySlug(slug);
  } catch (err) {
    if (err instanceof ApiClientError && err.status === 404) {
      notFound();
    }
    error = err;
  }

  return (
    <>
      <PageHeader
        title={data ? data.project.name : `Project ${slug}`}
        description={data?.project.description || 'Tenant-scoped project.'}
        actions={
          <Link
            href="/projects"
            className="rounded border border-slate-300 bg-white px-3 py-1 text-sm hover:bg-slate-50"
          >
            All projects
          </Link>
        }
      />
      {error ? (
        <ErrorView error={error} context="this project" />
      ) : data ? (
        <div className="flex flex-col gap-4">
          <Card>
            <CardContent className="grid grid-cols-2 gap-4 pt-6 text-sm sm:grid-cols-4">
              <Field label="Slug">
                <span className="font-mono text-[12px] text-slate-800">{data.project.slug}</span>
              </Field>
              <Field label="Created">
                <span className="text-slate-800" title={formatAbsolute(data.project.createdAt)}>
                  {formatRelativeTime(data.project.createdAt)}
                </span>
              </Field>
              <Field label="Updated">
                <span className="text-slate-800" title={formatAbsolute(data.project.updatedAt)}>
                  {formatRelativeTime(data.project.updatedAt)}
                </span>
              </Field>
              <Field label="Status">
                {data.project.archivedAt !== null ? (
                  <span className="rounded-full border border-slate-200 bg-slate-100 px-2 py-0.5 text-[10px] uppercase tracking-wider text-slate-600">
                    archived
                  </span>
                ) : (
                  <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] uppercase tracking-wider text-emerald-700">
                    active
                  </span>
                )}
              </Field>
            </CardContent>
          </Card>

          <ProjectSettingsCard project={data.project} />

          <Card>
            <CardContent className="pt-6 text-sm text-slate-600">
              <p>
                <strong className="text-slate-900">Coming next:</strong> agents, runs, datasets, and
                evaluators created here will appear in this view. We&rsquo;re landing
                project-scoping incrementally so each entity migration ships independently.
              </p>
            </CardContent>
          </Card>
        </div>
      ) : null}
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wider text-slate-500">{label}</div>
      <div className="mt-1">{children}</div>
    </div>
  );
}
