import type { HttpClient } from '../http.js';
import type {
  CreateRunRequest,
  CreateRunResponse,
  ListRunsQuery,
  ListRunsResponse,
  RunDetail,
} from '../types.js';

export class RunsResource {
  constructor(private readonly http: HttpClient) {}

  async list(query: ListRunsQuery = {}): Promise<ListRunsResponse> {
    return this.http.request('/v1/runs', { query: query as Record<string, string | number> });
  }

  async get(id: string): Promise<{ run: RunDetail }> {
    return this.http.request(`/v1/runs/${encodeURIComponent(id)}`);
  }

  async create(req: CreateRunRequest): Promise<CreateRunResponse> {
    return this.http.request('/v1/runs', { method: 'POST', body: req });
  }

  /**
   * Side-by-side comparison of two runs (event-by-event, output, cost).
   * Same payload as the `/runs/compare?a=&b=` UI page.
   */
  async compare(a: string, b: string): Promise<unknown> {
    return this.http.request('/v1/runs/compare', { query: { a, b } });
  }
}
