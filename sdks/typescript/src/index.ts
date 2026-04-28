/**
 * @aldo-ai/sdk — official TypeScript / JavaScript client for the
 * ALDO AI control plane.
 *
 * Usage:
 *
 *   import { Aldo } from '@aldo-ai/sdk';
 *
 *   const aldo = new Aldo({ apiKey: process.env.ALDO_API_KEY! });
 *
 *   const agents = await aldo.agents.list();
 *   const run = await aldo.runs.create({ agentName: 'researcher' });
 *   const detail = await aldo.runs.get(run.run.id);
 *
 * See https://ai.aldo.tech/docs for the full surface.
 */

export { Aldo, type AldoConfig } from './client.js';
export { AldoError, AldoApiError, AldoNetworkError } from './errors.js';
export type {
  // Domain types
  AgentSummary,
  CreateDatasetExampleRequest,
  CreateProjectRequest,
  CreateRunRequest,
  CreateRunResponse,
  Dataset,
  DatasetExample,
  DatasetSplit,
  ListAgentsResponse,
  ListRunsQuery,
  ListRunsResponse,
  PrivacyTier,
  Project,
  RunDetail,
  RunEvent,
  RunStatus,
  RunSummary,
  UsageRow,
} from './types.js';
