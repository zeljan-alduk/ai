/**
 * The `Aldo` client class — the only thing 99% of consumers import.
 *
 *   import { Aldo } from '@aldo-ai/sdk';
 *
 *   const aldo = new Aldo({
 *     apiKey: process.env.ALDO_API_KEY!,
 *     // baseUrl defaults to https://ai.aldo.tech.
 *   });
 *
 *   const agents = await aldo.agents.list();
 *   const run = await aldo.runs.create({ agentName: 'researcher' });
 *   const detail = await aldo.runs.get(run.run.id);
 *
 * Auth: the api key is sent as `Authorization: Bearer <key>` on every
 * request. Generate one at https://ai.aldo.tech/settings/api-keys.
 *
 * Privacy: this client runs in the consumer's environment (browser
 * worker, Node, edge, Bun, Deno). It is a thin REST client; no
 * credentials or run data leave that process except as direct calls
 * to the platform API your key is already authorised for.
 *
 * LLM-agnostic: the SDK never references a specific provider. Model
 * fields on Run/UsageRow are opaque strings.
 */

import { HttpClient, type HttpClientConfig } from './http.js';
import { AgentsResource } from './resources/agents.js';
import { DatasetsResource } from './resources/datasets.js';
import { ProjectsResource } from './resources/projects.js';
import { RunsResource } from './resources/runs.js';

export interface AldoConfig {
  /**
   * Bearer API key minted at /settings/api-keys. Required.
   */
  readonly apiKey: string;
  /**
   * API base URL. Defaults to the hosted control plane. Override for
   * self-host (`https://aldo.your-company.example`) or local dev
   * (`http://localhost:3001`).
   */
  readonly baseUrl?: string;
  /** Per-request timeout in ms. Default 30000. */
  readonly timeoutMs?: number;
  /** Optional fetch override — useful for tests or non-standard runtimes. */
  readonly fetch?: typeof globalThis.fetch;
  /**
   * Extra headers to send on every request. The SDK always sets
   * `authorization`, `accept`, and (when sending a body) `content-type`;
   * those win over anything passed here.
   */
  readonly headers?: Record<string, string>;
}

const DEFAULT_BASE_URL = 'https://ai.aldo.tech';
const DEFAULT_USER_AGENT = `@aldo-ai/sdk/${'__VERSION__'}`;

export class Aldo {
  readonly agents: AgentsResource;
  readonly runs: RunsResource;
  readonly datasets: DatasetsResource;
  readonly projects: ProjectsResource;

  constructor(cfg: AldoConfig) {
    if (typeof cfg.apiKey !== 'string' || cfg.apiKey.length === 0) {
      throw new Error(
        '@aldo-ai/sdk: `apiKey` is required. Mint one at https://ai.aldo.tech/settings/api-keys',
      );
    }
    const httpCfg: HttpClientConfig = {
      apiKey: cfg.apiKey,
      baseUrl: cfg.baseUrl ?? DEFAULT_BASE_URL,
      headers: { 'user-agent': DEFAULT_USER_AGENT, ...cfg.headers },
    };
    if (cfg.timeoutMs !== undefined) (httpCfg as { timeoutMs?: number }).timeoutMs = cfg.timeoutMs;
    if (cfg.fetch !== undefined) (httpCfg as { fetch?: typeof fetch }).fetch = cfg.fetch;
    const http = new HttpClient(httpCfg);
    this.agents = new AgentsResource(http);
    this.runs = new RunsResource(http);
    this.datasets = new DatasetsResource(http);
    this.projects = new ProjectsResource(http);
  }
}
