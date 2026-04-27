/**
 * /datasets/[id] — paginated examples table (wave 16).
 *
 * Server-shell + client island for the table + edit Sheet. Loads the
 * first page server-side; pagination + filters call the API directly
 * from the client island via the lib/api helpers.
 *
 * "Run sweep" CTA links to /eval/sweeps/new with this dataset
 * preselected via the `dataset` query param (Engineer 16A wires the
 * other side).
 */

import { ErrorView } from '@/components/error-boundary';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { getDataset, listDatasetExamples } from '@/lib/api';
import Link from 'next/link';
import { DatasetDetail } from './dataset-detail';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 50;

export default async function DatasetDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const decoded = decodeURIComponent(id);

  let dataset: Awaited<ReturnType<typeof getDataset>> | null = null;
  let examples: Awaited<ReturnType<typeof listDatasetExamples>> | null = null;
  let error: unknown = null;
  try {
    [dataset, examples] = await Promise.all([
      getDataset(decoded),
      listDatasetExamples(decoded, { limit: PAGE_SIZE }),
    ]);
  } catch (err) {
    error = err;
  }

  return (
    <>
      <PageHeader
        title={dataset?.dataset.name ?? `Dataset ${decoded.slice(0, 8)}`}
        description={
          dataset?.dataset.description?.length
            ? dataset.dataset.description
            : 'Tenant-scoped dataset of (input, expected) examples.'
        }
        actions={
          <div className="flex items-center gap-2">
            <Button asChild variant="secondary">
              <Link href="/datasets">All datasets</Link>
            </Button>
            <Button asChild>
              <Link
                href={`/eval/sweeps/new?dataset=${encodeURIComponent(decoded)}`}
                data-testid="run-sweep-cta"
              >
                Run sweep
              </Link>
            </Button>
          </div>
        }
      />
      {error ? (
        <ErrorView error={error} context="this dataset" />
      ) : dataset && examples ? (
        <DatasetDetail
          datasetId={decoded}
          dataset={dataset.dataset}
          initialExamples={examples.examples}
          initialNextCursor={examples.nextCursor}
        />
      ) : null}
    </>
  );
}
