/**
 * /datasets — gallery of dataset cards (wave 16).
 *
 * Server component. Pulls the list, applies URL-driven filters
 * (q, tag, sort) and renders cards. CTA links to the wizard.
 *
 * LLM-agnostic: never branches on a provider name; datasets are
 * platform-level objects.
 */

import { DatasetCard } from '@/components/datasets/dataset-card';
import { applyDatasetFilters, uniqueTags } from '@/components/datasets/dataset-filters';
import { DatasetsFiltersUi } from '@/components/datasets/dataset-filters-ui';
import { ErrorView } from '@/components/error-boundary';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { listDatasets } from '@/lib/api';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

interface SearchParams {
  q?: string;
  tag?: string;
  sort?: string;
}

export default async function DatasetsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  let listed: Awaited<ReturnType<typeof listDatasets>> | null = null;
  let error: unknown = null;
  try {
    listed = await listDatasets();
  } catch (err) {
    error = err;
  }

  if (error) {
    return (
      <>
        <PageHeader title="Datasets" description="Eval-backed example collections." />
        <ErrorView error={error} context="datasets" />
      </>
    );
  }
  if (!listed) return null;

  const tags = uniqueTags(listed.datasets);
  const filtered = applyDatasetFilters(listed.datasets, {
    ...(sp.q ? { search: sp.q } : {}),
    ...(sp.tag ? { tag: sp.tag } : {}),
    sort: sp.sort === 'name' ? 'name' : sp.sort === 'examples' ? 'examples' : 'updated',
  });

  return (
    <>
      <PageHeader
        title="Datasets"
        description="Tenant-scoped collections of (input, expected) examples that back dataset-driven eval suites."
        actions={
          <Button asChild>
            <Link href="/datasets/new">New dataset</Link>
          </Button>
        }
      />
      {listed.datasets.length === 0 ? (
        <EmptyState
          title="No datasets in this tenant yet"
          description="Create your first dataset to start running dataset-backed eval suites. Upload a CSV, paste JSON, or build it row-by-row."
          illustration={<EmptyDatasetsIllustration />}
          action={
            <Button asChild>
              <Link href="/datasets/new">Create your first dataset</Link>
            </Button>
          }
        />
      ) : (
        <div className="flex flex-col gap-5">
          <DatasetsFiltersUi tags={tags} />
          <p className="text-xs text-fg-muted">
            {filtered.length} of {listed.datasets.length} dataset
            {listed.datasets.length === 1 ? '' : 's'} match these filters
          </p>
          {filtered.length === 0 ? (
            <EmptyState
              title="No datasets match these filters"
              description="Clear the search or pick a different tag to broaden the list."
            />
          ) : (
            <div
              className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
              data-testid="datasets-grid"
            >
              {filtered.map((d) => (
                <DatasetCard key={d.id} dataset={d} />
              ))}
            </div>
          )}
        </div>
      )}
    </>
  );
}

function EmptyDatasetsIllustration() {
  return (
    <svg width="84" height="84" viewBox="0 0 84 84" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id="datasets-empty-grad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#0ea5e9" />
          <stop offset="100%" stopColor="#1e3a8a" />
        </linearGradient>
      </defs>
      <ellipse cx="42" cy="20" rx="26" ry="7" fill="url(#datasets-empty-grad)" opacity="0.3" />
      <path
        d="M16 20 V42 C16 47 28 51 42 51 C56 51 68 47 68 42 V20"
        stroke="url(#datasets-empty-grad)"
        strokeWidth="2"
        fill="none"
      />
      <path
        d="M16 42 V64 C16 69 28 73 42 73 C56 73 68 69 68 64 V42"
        stroke="url(#datasets-empty-grad)"
        strokeWidth="2"
        fill="none"
      />
    </svg>
  );
}
