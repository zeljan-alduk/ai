import type { HttpClient } from '../http.js';
import type { AgentSummary, ListAgentsResponse } from '../types.js';

export class AgentsResource {
  constructor(private readonly http: HttpClient) {}

  async list(): Promise<ReadonlyArray<AgentSummary>> {
    const res = await this.http.request<ListAgentsResponse>('/v1/agents');
    return res.agents;
  }

  async get(name: string): Promise<unknown> {
    return this.http.request(`/v1/agents/${encodeURIComponent(name)}`);
  }
}
