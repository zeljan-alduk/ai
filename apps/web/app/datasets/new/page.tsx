/**
 * /datasets/new — wizard for creating a dataset (wave 16).
 *
 * Steps (single-screen progressive disclosure rather than multi-page):
 *   1) name + description + tags
 *   2) source picker: CSV / JSONL / paste JSON / start empty
 *   3) preview + editable schema column list
 *   4) submit -> POST /v1/datasets, then POST /import or
 *      POST /examples for the source's payload, then redirect to
 *      /datasets/[id].
 *
 * Multipart upload is owned by `importDatasetExamples()` in lib/api.ts.
 *
 * LLM-agnostic: the wizard never references a provider name.
 */

import { PageHeader } from '@/components/page-header';
import { NewDatasetWizard } from './new-dataset-wizard';

export const dynamic = 'force-dynamic';

export default function NewDatasetPage() {
  return (
    <>
      <PageHeader
        title="New dataset"
        description="Create a tenant-scoped dataset. You can grow it later by uploading more files or labelling rows from /runs."
      />
      <NewDatasetWizard />
    </>
  );
}
