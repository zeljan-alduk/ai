import type { HttpClient } from '../http.js';
import type { CreateProjectRequest, Project } from '../types.js';

export class ProjectsResource {
  constructor(private readonly http: HttpClient) {}

  async list(opts: { includeArchived?: boolean } = {}): Promise<ReadonlyArray<Project>> {
    const query: Record<string, string> = {};
    if (opts.includeArchived === true) query.archived = '1';
    const res = await this.http.request<{ projects: ReadonlyArray<Project> }>('/v1/projects', {
      query,
    });
    return res.projects;
  }

  async get(slug: string): Promise<{ project: Project }> {
    return this.http.request(`/v1/projects/${encodeURIComponent(slug)}`);
  }

  async create(req: CreateProjectRequest): Promise<{ project: Project }> {
    return this.http.request('/v1/projects', { method: 'POST', body: req });
  }

  async archive(slug: string): Promise<{ project: Project }> {
    return this.http.request(`/v1/projects/${encodeURIComponent(slug)}`, {
      method: 'PATCH',
      body: { archived: true },
    });
  }

  async unarchive(slug: string): Promise<{ project: Project }> {
    return this.http.request(`/v1/projects/${encodeURIComponent(slug)}`, {
      method: 'PATCH',
      body: { archived: false },
    });
  }
}
