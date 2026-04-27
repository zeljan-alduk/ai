/**
 * SweepStore — pluggable persistence for sweep runs.
 *
 * The default `InMemorySweepStore` keeps everything in a Map; the API
 * package will inject a Postgres-backed implementation in a follow-up.
 * Keeping this as a single async interface means swapping backends is a
 * one-line wire change at the bootstrap layer.
 *
 * Methods are intentionally narrow:
 *   - create()  records the initial Sweep envelope (status: running)
 *   - update()  overwrites the stored row with the latest state, called
 *               once on completion (and again on failure)
 *   - get()     fetches a Sweep by id (read path used by API + CLI)
 *   - list()    enumerates sweep ids; useful for `aldo runs ls`
 *
 * The runner does NOT stream cell-by-cell updates into the store today —
 * that's a TODO for the API package once it has WebSocket fan-out.
 */

import type { Sweep } from '@aldo-ai/api-contract';

export interface SweepStore {
  create(sweep: Sweep): Promise<void>;
  update(sweep: Sweep): Promise<void>;
  get(id: string): Promise<Sweep | null>;
  list(): Promise<readonly Sweep[]>;
}

export class InMemorySweepStore implements SweepStore {
  private readonly byId = new Map<string, Sweep>();

  async create(sweep: Sweep): Promise<void> {
    if (this.byId.has(sweep.id)) {
      throw new Error(`sweep already exists: ${sweep.id}`);
    }
    this.byId.set(sweep.id, sweep);
  }

  async update(sweep: Sweep): Promise<void> {
    if (!this.byId.has(sweep.id)) {
      throw new Error(`sweep not found: ${sweep.id}`);
    }
    this.byId.set(sweep.id, sweep);
  }

  async get(id: string): Promise<Sweep | null> {
    return this.byId.get(id) ?? null;
  }

  async list(): Promise<readonly Sweep[]> {
    return [...this.byId.values()];
  }
}
