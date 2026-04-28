import type { HttpClient } from '../http.js';
import type { CreateDatasetExampleRequest, Dataset, DatasetExample } from '../types.js';

export class DatasetsResource {
  constructor(private readonly http: HttpClient) {}

  async list(query: { tag?: string; q?: string } = {}): Promise<ReadonlyArray<Dataset>> {
    const res = await this.http.request<{ datasets: ReadonlyArray<Dataset> }>('/v1/datasets', {
      query,
    });
    return res.datasets;
  }

  async get(id: string): Promise<{ dataset: Dataset }> {
    return this.http.request(`/v1/datasets/${encodeURIComponent(id)}`);
  }

  /**
   * Append a single example to a dataset. Mirrors the "Save as eval row"
   * UI flow — pre-fill `metadata.runId` for provenance.
   */
  async createExample(
    datasetId: string,
    req: CreateDatasetExampleRequest,
  ): Promise<{ example: DatasetExample }> {
    return this.http.request(`/v1/datasets/${encodeURIComponent(datasetId)}/examples`, {
      method: 'POST',
      body: req,
    });
  }
}
