/**
 * Postgres-backed store for the `failure_clusters` table (migration 014).
 *
 * Per-sweep buckets of failed cells produced by the
 * `@aldo-ai/eval` `clusterFailures` library. We replace ALL cluster rows
 * for a sweep on each cluster invocation so re-running clustering against
 * fresh cells deletes the previous result deterministically.
 *
 * LLM-agnostic — clustering is pure JS, no model calls.
 */

import { randomUUID } from 'node:crypto';
import type { FailureClusterDraft } from '@aldo-ai/eval';
import type { SqlClient } from '@aldo-ai/storage';

export interface FailureClusterRow {
  readonly id: string;
  readonly sweepId: string;
  readonly label: string;
  readonly count: number;
  readonly examplesSample: { caseId: string; model: string; output: string }[];
  readonly topTerms: string[];
  readonly createdAt: string;
}

export async function replaceFailureClusters(
  db: SqlClient,
  args: { sweepId: string; clusters: readonly FailureClusterDraft[] },
): Promise<readonly FailureClusterRow[]> {
  await db.query('DELETE FROM failure_clusters WHERE sweep_id = $1', [args.sweepId]);
  const out: FailureClusterRow[] = [];
  for (const draft of args.clusters) {
    const id = `fc_${randomUUID()}`;
    const sample = draft.examplesSample.map((s) => ({
      caseId: s.caseId,
      model: s.model,
      output: s.output,
    }));
    await db.query(
      `INSERT INTO failure_clusters (id, sweep_id, label, count, examples_sample)
       VALUES ($1, $2, $3, $4, $5::jsonb)`,
      [
        id,
        args.sweepId,
        draft.label,
        draft.count,
        JSON.stringify({ examples: sample, topTerms: [...draft.topTerms] }),
      ],
    );
    out.push({
      id,
      sweepId: args.sweepId,
      label: draft.label,
      count: draft.count,
      examplesSample: sample,
      topTerms: [...draft.topTerms],
      createdAt: new Date().toISOString(),
    });
  }
  return out;
}

export async function listFailureClusters(
  db: SqlClient,
  args: { sweepId: string },
): Promise<readonly FailureClusterRow[]> {
  const res = await db.query<{
    id: string;
    sweep_id: string;
    label: string;
    count: number | string;
    examples_sample: unknown;
    created_at: string | Date;
  }>(
    `SELECT id, sweep_id, label, count, examples_sample, created_at
       FROM failure_clusters WHERE sweep_id = $1
       ORDER BY count DESC, label ASC`,
    [args.sweepId],
  );
  return res.rows.map((r) => {
    const blob = parseObj(r.examples_sample);
    const examples = Array.isArray((blob as { examples?: unknown }).examples)
      ? ((blob as { examples: { caseId: string; model: string; output: string }[] }).examples ?? [])
      : [];
    const topTerms = Array.isArray((blob as { topTerms?: unknown }).topTerms)
      ? ((blob as { topTerms: string[] }).topTerms ?? [])
      : [];
    return {
      id: r.id,
      sweepId: r.sweep_id,
      label: r.label,
      count: Number(r.count),
      examplesSample: examples,
      topTerms,
      createdAt: toIso(r.created_at),
    };
  });
}

function parseObj(v: unknown): unknown {
  if (v === null || v === undefined) return {};
  if (typeof v === 'string') {
    try {
      return JSON.parse(v);
    } catch {
      return {};
    }
  }
  return v;
}

function toIso(v: unknown): string {
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'string') {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? v : d.toISOString();
  }
  return new Date(0).toISOString();
}
