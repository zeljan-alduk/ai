import { LocalModelsShell } from '@/components/local-models/local-models-shell';
import { PageHeader } from '@/components/page-header';

export const dynamic = 'force-dynamic';

/**
 * `/local-models` — discover local LLM servers and run a quality × speed
 * rating on any of them.
 *
 * Server component is intentionally thin: every interactive surface
 * (discovery list, scan-mode selector, suite picker, streaming results
 * table) lives in the client island so we can stream SSE frames from
 * `/v1/bench/suite` directly into the table without a server round-trip
 * per case.
 *
 * LLM-agnostic: every piece of model metadata flows through opaquely;
 * the UI never branches on a specific provider name.
 */
export default function LocalModelsPage() {
  return (
    <>
      <PageHeader
        title="Local models"
        description="Discover local LLM servers, then rate them on quality and speed. The bench fires a curated eval suite directly at the model's OpenAI-compatible endpoint and streams per-case results as they complete."
      />
      <LocalModelsShell />
    </>
  );
}
