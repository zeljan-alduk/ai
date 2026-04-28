/**
 * Wire-format TypeScript types for the ALDO AI API.
 *
 * Hand-maintained: we deliberately do NOT depend on the internal
 * `@aldo-ai/api-contract` package because that's a private workspace
 * package containing Zod schemas. Customers should be able to install
 * this SDK without pulling internal infrastructure.
 *
 * Keep these in sync with `platform/api-contract/src/*.ts` whenever
 * a wire shape changes. The api-contract Zod schemas are the source
 * of truth; these are the published mirror.
 *
 * LLM-agnostic: provider / model fields are opaque strings.
 */

export type PrivacyTier = 'public' | 'internal' | 'sensitive';
export type RunStatus = 'running' | 'completed' | 'cancelled' | 'errored';
export type DatasetSplit = 'all' | 'train' | 'eval' | 'holdout';

// ──────────────────────────────────────────── Agents

export interface AgentSummary {
  readonly name: string;
  readonly owner: string;
  readonly latestVersion: string;
  readonly promoted: boolean;
  readonly description: string;
  readonly privacyTier: PrivacyTier;
  readonly team: string;
  readonly tags: ReadonlyArray<string>;
}

export interface ListAgentsResponse {
  readonly agents: ReadonlyArray<AgentSummary>;
}

// ──────────────────────────────────────────── Runs

export interface RunSummary {
  readonly id: string;
  readonly agentName: string;
  readonly agentVersion: string;
  readonly parentRunId: string | null;
  readonly status: RunStatus;
  readonly startedAt: string;
  readonly endedAt: string | null;
  readonly durationMs: number | null;
  readonly totalUsd: number;
  readonly lastProvider: string | null;
  readonly lastModel: string | null;
}

export interface RunEvent {
  readonly id: string;
  readonly type: string;
  readonly at: string;
  readonly payload: unknown;
}

export interface UsageRow {
  readonly provider: string;
  readonly model: string;
  readonly tokensIn: number;
  readonly tokensOut: number;
  readonly usd: number;
  readonly at: string;
}

export interface RunDetail extends RunSummary {
  readonly events: ReadonlyArray<RunEvent>;
  readonly usage: ReadonlyArray<UsageRow>;
}

export interface ListRunsQuery {
  readonly agentName?: string;
  readonly status?: RunStatus;
  readonly cursor?: string;
  readonly limit?: number;
}

export interface ListRunsResponse {
  readonly runs: ReadonlyArray<RunSummary>;
  readonly meta: { readonly nextCursor: string | null };
}

export interface CreateRunRequest {
  readonly agentName: string;
  readonly agentVersion?: string;
  readonly inputs?: unknown;
}

export interface CreateRunResponse {
  readonly run: {
    readonly id: string;
    readonly agentName: string;
    readonly agentVersion: string;
    readonly status: RunStatus;
    readonly startedAt: string;
  };
}

// ──────────────────────────────────────────── Datasets

export interface Dataset {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly tags: ReadonlyArray<string>;
  readonly exampleCount: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface DatasetExample {
  readonly id: string;
  readonly datasetId: string;
  readonly input: unknown;
  readonly expected: unknown;
  readonly metadata: Record<string, unknown>;
  readonly label: string | null;
  readonly split: string;
  readonly createdAt: string;
}

export interface CreateDatasetExampleRequest {
  readonly input: unknown;
  readonly expected?: unknown;
  readonly metadata?: Record<string, unknown>;
  readonly label?: string;
  readonly split?: DatasetSplit;
}

// ──────────────────────────────────────────── Projects

export interface Project {
  readonly id: string;
  readonly tenantId: string;
  readonly slug: string;
  readonly name: string;
  readonly description: string;
  readonly archivedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CreateProjectRequest {
  readonly slug: string;
  readonly name: string;
  readonly description?: string;
}

// ──────────────────────────────────────────── Errors

export interface ApiErrorEnvelope {
  readonly error: {
    readonly code: string;
    readonly message: string;
    readonly details?: unknown;
  };
}
