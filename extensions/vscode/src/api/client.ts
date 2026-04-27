// Thin fetch client for the ALDO AI API. LLM-agnostic — the extension
// never calls a model provider directly; it only ever talks to /v1/*
// endpoints, which route through the platform gateway. Privacy tiers
// are enforced server-side, so sending an input through this client
// can't accidentally leak to a cloud model.
//
// We use the global `fetch` (Node 22+) so we don't take a runtime dep
// on node-fetch / undici. Bearer auth — the user pastes a JWT or API
// key from /settings/api-keys.

export interface ApiClientOptions {
  baseUrl: string;
  token: string;
  /** Optional override for testing. */
  fetchImpl?: typeof fetch;
}

export interface AgentSummary {
  name: string;
  version?: string;
  description?: string;
  privacyTier?: string;
}

export interface RunSummary {
  id: string;
  agentName: string;
  agentVersion?: string;
  status: string;
  startedAt?: string;
}

export interface ModelSummary {
  id: string;
  capabilityClass?: string;
  provider?: string;
  privacyTier?: string;
}

export interface RunTreeNode {
  id: string;
  agentName: string;
  status: string;
  startedAt?: string;
  durationMs?: number;
  children: RunTreeNode[];
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export class ApiClient {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: ApiClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '');
    this.token = opts.token;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers);
    headers.set('authorization', `Bearer ${this.token}`);
    headers.set('accept', 'application/json');
    if (init.body && !headers.has('content-type')) {
      headers.set('content-type', 'application/json');
    }
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      ...init,
      headers,
    });
    if (!res.ok) {
      let code = 'http_error';
      let message = res.statusText;
      try {
        const body = (await res.json()) as { code?: string; message?: string };
        if (body.code) code = body.code;
        if (body.message) message = body.message;
      } catch {
        // body not JSON — fall through with statusText
      }
      throw new ApiError(res.status, code, message);
    }
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  // ---- agents ----

  async listAgents(): Promise<AgentSummary[]> {
    const body = await this.request<{ agents: AgentSummary[] }>('/v1/agents');
    return body.agents ?? [];
  }

  // ---- runs ----

  async listRuns(limit = 20): Promise<RunSummary[]> {
    const body = await this.request<{ runs: RunSummary[] }>(
      `/v1/runs?limit=${encodeURIComponent(String(limit))}`,
    );
    return body.runs ?? [];
  }

  async createRun(agentName: string, input: string): Promise<RunSummary> {
    const body = await this.request<{ run: RunSummary }>('/v1/runs', {
      method: 'POST',
      body: JSON.stringify({ agentName, input }),
    });
    return body.run;
  }

  async getRunTree(runId: string): Promise<RunTreeNode> {
    const body = await this.request<{ tree: RunTreeNode }>(
      `/v1/runs/${encodeURIComponent(runId)}/tree`,
    );
    return body.tree;
  }

  // ---- models ----

  async listModels(): Promise<ModelSummary[]> {
    const body = await this.request<{ models: ModelSummary[] }>('/v1/models');
    return body.models ?? [];
  }

  // ---- playground (one-off prompt) ----
  // Returns the raw response so the quick-prompt command can render
  // whatever the platform happens to surface (text, JSON, etc.).
  async playgroundRun(payload: {
    agentName: string;
    input: string;
  }): Promise<unknown> {
    return await this.request<unknown>('/v1/playground/run', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }
}
