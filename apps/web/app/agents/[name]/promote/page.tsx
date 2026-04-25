import { ErrorView } from '@/components/error-boundary';
import { PageHeader } from '@/components/page-header';
import { getAgent, listModels } from '@/lib/api';
import Link from 'next/link';
import { PromoteForm } from './promote-form';

export const dynamic = 'force-dynamic';

export default async function PromotePage({
  params,
}: {
  params: Promise<{ name: string }>;
}) {
  const { name } = await params;
  const decoded = decodeURIComponent(name);

  let agentRes: Awaited<ReturnType<typeof getAgent>> | null = null;
  let modelsRes: Awaited<ReturnType<typeof listModels>> | null = null;
  let error: unknown = null;
  try {
    [agentRes, modelsRes] = await Promise.all([getAgent(decoded), listModels()]);
  } catch (err) {
    error = err;
  }

  return (
    <>
      <PageHeader
        title={`Promote ${decoded}`}
        description="Run the agent's eval gate against your selected models. Promotion only happens if every gate suite passes."
        actions={
          <Link
            href={`/agents/${encodeURIComponent(decoded)}`}
            className="rounded border border-slate-300 bg-white px-3 py-1 text-sm hover:bg-slate-50"
          >
            Back to agent
          </Link>
        }
      />
      {error ? (
        <ErrorView error={error} context="this agent" />
      ) : agentRes && modelsRes ? (
        <PromoteForm agent={agentRes.agent} models={modelsRes.models} />
      ) : null}
    </>
  );
}
