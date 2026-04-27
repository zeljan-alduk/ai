/**
 * Postgres-backed store for `datasets` and `dataset_examples` (migration 014).
 *
 * Tenant-scoped reads and writes. Examples carry an in-memory dedup-on-write
 * helper: `(input, expected)` is hashed via SHA-1 and the bulk-insert path
 * skips rows whose hash already exists for the dataset.
 *
 * LLM-agnostic — nothing here references a model provider.
 */

import { createHash, randomUUID } from 'node:crypto';
import type { SqlClient } from '@aldo-ai/storage';

// ─────────────────────────────────────────── Datasets

export interface DatasetRow {
  readonly id: string;
  readonly tenantId: string;
  readonly userId: string;
  readonly name: string;
  readonly description: string;
  readonly schema: { columns: { name: string; type: string; description?: string }[] };
  readonly tags: string[];
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly exampleCount: number;
}

export interface InsertDatasetInput {
  readonly tenantId: string;
  readonly userId: string;
  readonly name: string;
  readonly description?: string;
  readonly schema?: { columns: { name: string; type: string; description?: string }[] };
  readonly tags?: readonly string[];
}

export interface UpdateDatasetPatch {
  readonly name?: string;
  readonly description?: string;
  readonly schema?: { columns: { name: string; type: string; description?: string }[] };
  readonly tags?: readonly string[];
}

export async function insertDataset(db: SqlClient, input: InsertDatasetInput): Promise<DatasetRow> {
  const id = `ds_${randomUUID()}`;
  await db.query(
    `INSERT INTO datasets (id, tenant_id, user_id, name, description, schema, tags)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)`,
    [
      id,
      input.tenantId,
      input.userId,
      input.name,
      input.description ?? '',
      JSON.stringify(input.schema ?? { columns: [] }),
      input.tags ?? [],
    ],
  );
  const row = await getDatasetById(db, { id, tenantId: input.tenantId });
  if (row === null) throw new Error('dataset insert vanished');
  return row;
}

export async function listDatasetsForTenant(
  db: SqlClient,
  args: { tenantId: string },
): Promise<readonly DatasetRow[]> {
  const res = await db.query<DatasetDbRow>(
    `SELECT d.id, d.tenant_id, d.user_id, d.name, d.description, d.schema, d.tags,
            d.created_at, d.updated_at,
            (SELECT COUNT(*) FROM dataset_examples e WHERE e.dataset_id = d.id) AS example_count
       FROM datasets d
       WHERE d.tenant_id = $1
       ORDER BY d.updated_at DESC`,
    [args.tenantId],
  );
  return res.rows.map(toDatasetRow);
}

export async function getDatasetById(
  db: SqlClient,
  args: { id: string; tenantId: string },
): Promise<DatasetRow | null> {
  const res = await db.query<DatasetDbRow>(
    `SELECT d.id, d.tenant_id, d.user_id, d.name, d.description, d.schema, d.tags,
            d.created_at, d.updated_at,
            (SELECT COUNT(*) FROM dataset_examples e WHERE e.dataset_id = d.id) AS example_count
       FROM datasets d
       WHERE d.id = $1 AND d.tenant_id = $2`,
    [args.id, args.tenantId],
  );
  const r = res.rows[0];
  return r === undefined ? null : toDatasetRow(r);
}

export async function getDatasetByName(
  db: SqlClient,
  args: { name: string; tenantId: string },
): Promise<DatasetRow | null> {
  const res = await db.query<DatasetDbRow>(
    `SELECT d.id, d.tenant_id, d.user_id, d.name, d.description, d.schema, d.tags,
            d.created_at, d.updated_at,
            (SELECT COUNT(*) FROM dataset_examples e WHERE e.dataset_id = d.id) AS example_count
       FROM datasets d
       WHERE d.name = $1 AND d.tenant_id = $2
       LIMIT 1`,
    [args.name, args.tenantId],
  );
  const r = res.rows[0];
  return r === undefined ? null : toDatasetRow(r);
}

export async function updateDataset(
  db: SqlClient,
  args: { id: string; tenantId: string; patch: UpdateDatasetPatch },
): Promise<DatasetRow | null> {
  const sets: string[] = [];
  const params: unknown[] = [];
  if (args.patch.name !== undefined) {
    params.push(args.patch.name);
    sets.push(`name = $${params.length}`);
  }
  if (args.patch.description !== undefined) {
    params.push(args.patch.description);
    sets.push(`description = $${params.length}`);
  }
  if (args.patch.schema !== undefined) {
    params.push(JSON.stringify(args.patch.schema));
    sets.push(`schema = $${params.length}::jsonb`);
  }
  if (args.patch.tags !== undefined) {
    params.push([...args.patch.tags]);
    sets.push(`tags = $${params.length}`);
  }
  if (sets.length === 0) return getDatasetById(db, { id: args.id, tenantId: args.tenantId });
  sets.push('updated_at = now()');
  params.push(args.id);
  const idIdx = params.length;
  params.push(args.tenantId);
  const tIdx = params.length;
  await db.query(
    `UPDATE datasets SET ${sets.join(', ')} WHERE id = $${idIdx} AND tenant_id = $${tIdx}`,
    params,
  );
  return getDatasetById(db, { id: args.id, tenantId: args.tenantId });
}

export async function deleteDataset(
  db: SqlClient,
  args: { id: string; tenantId: string },
): Promise<boolean> {
  const res = await db.query('DELETE FROM datasets WHERE id = $1 AND tenant_id = $2', [
    args.id,
    args.tenantId,
  ]);
  // Some pglite/pg drivers populate `rowCount`, but normalise across both.
  const count = (res as unknown as { rowCount?: number }).rowCount;
  if (typeof count === 'number') return count > 0;
  return true;
}

// ─────────────────────────────────────────── Examples

export interface DatasetExampleRow {
  readonly id: string;
  readonly datasetId: string;
  readonly input: unknown;
  readonly expected: unknown;
  readonly metadata: Record<string, unknown>;
  readonly label: string | null;
  readonly split: string;
  readonly createdAt: string;
}

export interface InsertExampleInput {
  readonly datasetId: string;
  readonly input: unknown;
  readonly expected?: unknown;
  readonly metadata?: Record<string, unknown>;
  readonly label?: string | null;
  readonly split?: string;
}

export async function insertExample(
  db: SqlClient,
  input: InsertExampleInput,
): Promise<DatasetExampleRow> {
  const id = `ex_${randomUUID()}`;
  await db.query(
    `INSERT INTO dataset_examples (id, dataset_id, input, expected, metadata, label, split)
     VALUES ($1, $2, $3::jsonb, $4::jsonb, $5::jsonb, $6, $7)`,
    [
      id,
      input.datasetId,
      JSON.stringify(input.input ?? null),
      input.expected === undefined ? null : JSON.stringify(input.expected),
      JSON.stringify(input.metadata ?? {}),
      input.label ?? null,
      input.split ?? 'all',
    ],
  );
  const row = await getExampleById(db, { id, datasetId: input.datasetId });
  if (row === null) throw new Error('example insert vanished');
  return row;
}

export interface BulkInsertResult {
  readonly inserted: number;
  readonly skipped: number;
  readonly errors: { index: number; message: string }[];
  readonly rows: DatasetExampleRow[];
}

/**
 * Insert many examples, deduplicating against existing rows by SHA-1
 * of `(input, expected)`. Errors are returned per-index without aborting
 * the import.
 */
export async function bulkInsertExamples(
  db: SqlClient,
  args: { datasetId: string; examples: readonly InsertExampleInput[] },
): Promise<BulkInsertResult> {
  // Read existing hashes for the dataset so we can skip duplicates without
  // adding a unique-constraint to the table (input/expected are JSONB and
  // free-shape, so we hash in-process).
  const existing = await db.query<{ input: unknown; expected: unknown }>(
    'SELECT input, expected FROM dataset_examples WHERE dataset_id = $1',
    [args.datasetId],
  );
  const seen = new Set<string>();
  for (const r of existing.rows) seen.add(hashPair(r.input, r.expected));

  const result: BulkInsertResult = { inserted: 0, skipped: 0, errors: [], rows: [] };
  let i = 0;
  for (const ex of args.examples) {
    const idx = i++;
    try {
      const h = hashPair(ex.input, ex.expected);
      if (seen.has(h)) {
        (result as { skipped: number }).skipped += 1;
        continue;
      }
      seen.add(h);
      const row = await insertExample(db, ex);
      result.rows.push(row);
      (result as { inserted: number }).inserted += 1;
    } catch (e) {
      result.errors.push({ index: idx, message: e instanceof Error ? e.message : String(e) });
    }
  }
  return result;
}

export async function listExamples(
  db: SqlClient,
  args: {
    datasetId: string;
    split?: string | undefined;
    limit: number;
    cursor?: string | undefined;
  },
): Promise<{ rows: DatasetExampleRow[]; nextCursor: string | null }> {
  const params: unknown[] = [args.datasetId];
  const where: string[] = ['dataset_id = $1'];
  if (args.split !== undefined) {
    params.push(args.split);
    where.push(`split = $${params.length}`);
  }
  if (args.cursor !== undefined && args.cursor.length > 0) {
    params.push(args.cursor);
    where.push(`id > $${params.length}`);
  }
  params.push(args.limit + 1);
  const limitIdx = params.length;
  const res = await db.query<ExampleDbRow>(
    `SELECT id, dataset_id, input, expected, metadata, label, split, created_at
       FROM dataset_examples
       WHERE ${where.join(' AND ')}
       ORDER BY id ASC
       LIMIT $${limitIdx}`,
    params,
  );
  const rows = res.rows.slice(0, args.limit).map(toExampleRow);
  const hasMore = res.rows.length > args.limit;
  const last = rows[rows.length - 1];
  const nextCursor = hasMore && last !== undefined ? last.id : null;
  return { rows, nextCursor };
}

export async function getExampleById(
  db: SqlClient,
  args: { id: string; datasetId: string },
): Promise<DatasetExampleRow | null> {
  const res = await db.query<ExampleDbRow>(
    `SELECT id, dataset_id, input, expected, metadata, label, split, created_at
       FROM dataset_examples
       WHERE id = $1 AND dataset_id = $2`,
    [args.id, args.datasetId],
  );
  const r = res.rows[0];
  return r === undefined ? null : toExampleRow(r);
}

export async function updateExample(
  db: SqlClient,
  args: {
    id: string;
    datasetId: string;
    patch: {
      input?: unknown;
      expected?: unknown;
      metadata?: Record<string, unknown>;
      label?: string | null;
      split?: string;
    };
  },
): Promise<DatasetExampleRow | null> {
  const sets: string[] = [];
  const params: unknown[] = [];
  if (args.patch.input !== undefined) {
    params.push(JSON.stringify(args.patch.input));
    sets.push(`input = $${params.length}::jsonb`);
  }
  if (args.patch.expected !== undefined) {
    params.push(args.patch.expected === null ? null : JSON.stringify(args.patch.expected));
    sets.push(`expected = $${params.length}::jsonb`);
  }
  if (args.patch.metadata !== undefined) {
    params.push(JSON.stringify(args.patch.metadata));
    sets.push(`metadata = $${params.length}::jsonb`);
  }
  if (args.patch.label !== undefined) {
    params.push(args.patch.label);
    sets.push(`label = $${params.length}`);
  }
  if (args.patch.split !== undefined) {
    params.push(args.patch.split);
    sets.push(`split = $${params.length}`);
  }
  if (sets.length === 0) return getExampleById(db, { id: args.id, datasetId: args.datasetId });
  params.push(args.id);
  const idIdx = params.length;
  params.push(args.datasetId);
  const dIdx = params.length;
  await db.query(
    `UPDATE dataset_examples SET ${sets.join(', ')} WHERE id = $${idIdx} AND dataset_id = $${dIdx}`,
    params,
  );
  return getExampleById(db, { id: args.id, datasetId: args.datasetId });
}

export async function deleteExample(
  db: SqlClient,
  args: { id: string; datasetId: string },
): Promise<boolean> {
  const res = await db.query('DELETE FROM dataset_examples WHERE id = $1 AND dataset_id = $2', [
    args.id,
    args.datasetId,
  ]);
  const count = (res as unknown as { rowCount?: number }).rowCount;
  if (typeof count === 'number') return count > 0;
  return true;
}

// ─────────────────────────────────────────── helpers

interface DatasetDbRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly user_id: string;
  readonly name: string;
  readonly description: string;
  readonly schema: unknown;
  readonly tags: unknown;
  readonly created_at: string | Date;
  readonly updated_at: string | Date;
  readonly example_count: number | string;
  readonly [k: string]: unknown;
}

interface ExampleDbRow {
  readonly id: string;
  readonly dataset_id: string;
  readonly input: unknown;
  readonly expected: unknown;
  readonly metadata: unknown;
  readonly label: string | null;
  readonly split: string;
  readonly created_at: string | Date;
  readonly [k: string]: unknown;
}

function toDatasetRow(r: DatasetDbRow): DatasetRow {
  const schema = parseJsonObject(r.schema, { columns: [] });
  const cols = Array.isArray((schema as { columns?: unknown }).columns)
    ? ((schema as { columns: unknown[] }).columns as { name: string; type: string }[])
    : [];
  const tags = Array.isArray(r.tags) ? (r.tags as string[]) : [];
  return {
    id: r.id,
    tenantId: r.tenant_id,
    userId: r.user_id,
    name: r.name,
    description: r.description,
    schema: { columns: cols },
    tags,
    createdAt: toIso(r.created_at),
    updatedAt: toIso(r.updated_at),
    exampleCount: Number(r.example_count),
  };
}

function toExampleRow(r: ExampleDbRow): DatasetExampleRow {
  return {
    id: r.id,
    datasetId: r.dataset_id,
    input: parseJson(r.input),
    expected: parseJson(r.expected),
    metadata: parseJsonObject(r.metadata, {}) as Record<string, unknown>,
    label: r.label,
    split: r.split,
    createdAt: toIso(r.created_at),
  };
}

function parseJson(v: unknown): unknown {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') {
    try {
      return JSON.parse(v);
    } catch {
      return v;
    }
  }
  return v;
}

function parseJsonObject<T extends object>(v: unknown, fallback: T): unknown {
  const parsed = parseJson(v);
  return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
    ? parsed
    : fallback;
}

function toIso(v: unknown): string {
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'string') {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? v : d.toISOString();
  }
  return new Date(0).toISOString();
}

function hashPair(input: unknown, expected: unknown): string {
  const canonical = JSON.stringify({
    input: canonicalize(input ?? null),
    expected: canonicalize(expected ?? null),
  });
  return createHash('sha1').update(canonical).digest('hex');
}

/**
 * Stable JSON serialisation: object keys are sorted so two examples with
 * the same data but different key order produce the same hash.
 */
function canonicalize(v: unknown): unknown {
  if (v === null || v === undefined) return null;
  if (Array.isArray(v)) return v.map(canonicalize);
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(o).sort()) out[k] = canonicalize(o[k]);
    return out;
  }
  return v;
}
