import { randomUUID } from 'node:crypto';
import type { CheckpointId, RunId } from '@aldo-ai/types';
import type { Checkpoint, Checkpointer } from './index.js';

/**
 * In-memory Checkpointer. Enough for tests and v0 single-process runs.
 * TODO(v1): Postgres-backed implementation lives in platform/observability.
 */
export class InMemoryCheckpointer implements Checkpointer {
  private readonly byId = new Map<CheckpointId, Checkpoint>();
  private readonly byRun = new Map<RunId, CheckpointId[]>();

  async save(cp: Omit<Checkpoint, 'id' | 'at'>): Promise<CheckpointId> {
    const id = randomUUID() as CheckpointId;
    const full: Checkpoint = { ...cp, id, at: new Date().toISOString() };
    this.byId.set(id, full);
    const list = this.byRun.get(cp.runId) ?? [];
    list.push(id);
    this.byRun.set(cp.runId, list);
    return id;
  }

  async load(id: CheckpointId): Promise<Checkpoint | null> {
    return this.byId.get(id) ?? null;
  }

  async listByRun(runId: RunId): Promise<readonly Checkpoint[]> {
    const ids = this.byRun.get(runId) ?? [];
    const out: Checkpoint[] = [];
    for (const id of ids) {
      const cp = this.byId.get(id);
      if (cp) out.push(cp);
    }
    return out;
  }
}
