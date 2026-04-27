import { EmptyState } from '@/components/empty-state';
import { ErrorView } from '@/components/error-boundary';
import { ModelsExplorer } from '@/components/models/models-explorer';
import { SavingsCard } from '@/components/models/savings-card';
import { PageHeader } from '@/components/page-header';
import { listModels } from '@/lib/api';

export const dynamic = 'force-dynamic';

/**
 * Wave-12 redesigned /models surface.
 *
 * Server component fetches the catalogue and KPIs once; the explorer
 * island handles filter state, view-toggle, and the cost-comparison
 * chart locally. The "savings" card is its own client island so it
 * can poll `/v1/models/savings` independently — keeping the heavy
 * catalogue render path off the polling clock.
 *
 * LLM-agnostic: every badge/colour is keyed off opaque strings from
 * the API. Provider names are displayed as-is and never branched on.
 */
export default async function ModelsPage() {
  let data: Awaited<ReturnType<typeof listModels>> | null = null;
  let error: unknown = null;
  try {
    data = await listModels();
  } catch (err) {
    error = err;
  }

  return (
    <>
      <PageHeader
        title="Models"
        description="The runtime catalogue. Filter by locality, privacy tier, or capability class — every column is opaque so swapping providers stays a config change."
      />
      <div className="mb-6">
        <SavingsCard />
      </div>
      {error ? (
        <ErrorView error={error} context="models" />
      ) : data ? (
        data.models.length === 0 ? (
          <EmptyState
            title="No models in catalog yet"
            hint="Add provider configuration to apps/api or seed the bundled fixture to make models available."
          />
        ) : (
          <ModelsExplorer models={data.models} />
        )
      ) : null}
    </>
  );
}
