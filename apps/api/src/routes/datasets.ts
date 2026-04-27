/**
 * `/v1/datasets` — Wave-16 datasets API.
 *
 * Tenant-scoped, user-owned named collections of input/expected
 * examples. Backs the dataset-driven eval suite path and the manual
 * labelling surface (web UI is wave 16B's job; CLI is a follow-up).
 *
 * Endpoints:
 *   GET    /v1/datasets                              list (tenant-scoped)
 *   POST   /v1/datasets                              create
 *   GET    /v1/datasets/:id                          read
 *   PATCH  /v1/datasets/:id                          update meta + schema
 *   DELETE /v1/datasets/:id                          delete (cascade examples)
 *   GET    /v1/datasets/:id/examples?split=&limit=&cursor=
 *   POST   /v1/datasets/:id/examples                 single insert
 *   POST   /v1/datasets/:id/examples/bulk            JSON or text/csv (10MB cap)
 *   PATCH  /v1/datasets/:id/examples/:exampleId     inline edit + label
 *   DELETE /v1/datasets/:id/examples/:exampleId
 *
 * Bulk-import is JSON OR `text/csv`; deduplication is enforced inside
 * `bulkInsertExamples` (SHA-1 of canonicalised `(input, expected)`).
 *
 * RBAC: writes require `member`-or-above; reads are open to anyone in
 * the tenant.
 *
 * LLM-agnostic: the dataset's `schema` is documentation-only. Examples
 * carry free-shape JSONB inputs/expected. No provider strings appear
 * anywhere on this surface.
 */

import {
  BulkCreateDatasetExamplesRequest,
  BulkCreateDatasetExamplesResponse,
  CreateDatasetExampleRequest,
  CreateDatasetRequest,
  Dataset,
  DatasetExample,
  ListDatasetExamplesResponse,
  ListDatasetsResponse,
  UpdateDatasetExampleRequest,
  UpdateDatasetRequest,
} from '@aldo-ai/api-contract';
import { Hono } from 'hono';
import { z } from 'zod';
import { getAuth, requireRole } from '../auth/middleware.js';
import {
  type DatasetExampleRow,
  type DatasetRow,
  bulkInsertExamples,
  deleteDataset,
  deleteExample,
  getDatasetById,
  getExampleById,
  insertDataset,
  insertExample,
  listDatasetsForTenant,
  listExamples,
  updateDataset,
  updateExample,
} from '../datasets/store.js';
import type { Deps } from '../deps.js';
import { HttpError, notFound, validationError } from '../middleware/error.js';

const DatasetIdParam = z.object({ id: z.string().min(1) });
const ExampleIdParam = z.object({ id: z.string().min(1), exampleId: z.string().min(1) });

const ListExamplesQuery = z.object({
  split: z.string().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

/** Hard cap on bulk-import body size, per the wave-16 brief. */
const BULK_BODY_LIMIT_BYTES = 10 * 1024 * 1024;

export function datasetsRoutes(deps: Deps): Hono {
  const app = new Hono();

  // ------------------------------------------------------------------ list
  app.get('/v1/datasets', async (c) => {
    const auth = getAuth(c);
    const rows = await listDatasetsForTenant(deps.db, { tenantId: auth.tenantId });
    const body = ListDatasetsResponse.parse({
      datasets: rows.map(toDatasetWire),
    });
    return c.json(body);
  });

  // ----------------------------------------------------------------- create
  app.post('/v1/datasets', async (c) => {
    requireRole(c, 'member');
    const json = await readJsonBody(c);
    const parsed = CreateDatasetRequest.safeParse(json);
    if (!parsed.success) {
      throw validationError('invalid create-dataset request', parsed.error.issues);
    }
    const auth = getAuth(c);
    const row = await insertDataset(deps.db, {
      tenantId: auth.tenantId,
      userId: auth.userId,
      name: parsed.data.name,
      description: parsed.data.description,
      ...(parsed.data.schema !== undefined ? { schema: normaliseSchema(parsed.data.schema) } : {}),
      tags: parsed.data.tags,
    });
    return c.json(Dataset.parse(toDatasetWire(row)), 201);
  });

  // ------------------------------------------------------------------- read
  app.get('/v1/datasets/:id', async (c) => {
    const idParsed = DatasetIdParam.safeParse({ id: c.req.param('id') });
    if (!idParsed.success) throw validationError('invalid dataset id', idParsed.error.issues);
    const auth = getAuth(c);
    const row = await getDatasetById(deps.db, { id: idParsed.data.id, tenantId: auth.tenantId });
    if (row === null) throw notFound(`dataset not found: ${idParsed.data.id}`);
    return c.json(Dataset.parse(toDatasetWire(row)));
  });

  // ---------------------------------------------------------------- update
  app.patch('/v1/datasets/:id', async (c) => {
    requireRole(c, 'member');
    const idParsed = DatasetIdParam.safeParse({ id: c.req.param('id') });
    if (!idParsed.success) throw validationError('invalid dataset id', idParsed.error.issues);
    const json = await readJsonBody(c);
    const parsed = UpdateDatasetRequest.safeParse(json);
    if (!parsed.success) {
      throw validationError('invalid update-dataset request', parsed.error.issues);
    }
    const auth = getAuth(c);
    const updated = await updateDataset(deps.db, {
      id: idParsed.data.id,
      tenantId: auth.tenantId,
      patch: {
        ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
        ...(parsed.data.description !== undefined ? { description: parsed.data.description } : {}),
        ...(parsed.data.schema !== undefined
          ? { schema: normaliseSchema(parsed.data.schema) }
          : {}),
        ...(parsed.data.tags !== undefined ? { tags: parsed.data.tags } : {}),
      },
    });
    if (updated === null) throw notFound(`dataset not found: ${idParsed.data.id}`);
    return c.json(Dataset.parse(toDatasetWire(updated)));
  });

  // ---------------------------------------------------------------- delete
  app.delete('/v1/datasets/:id', async (c) => {
    requireRole(c, 'member');
    const idParsed = DatasetIdParam.safeParse({ id: c.req.param('id') });
    if (!idParsed.success) throw validationError('invalid dataset id', idParsed.error.issues);
    const auth = getAuth(c);
    const removed = await deleteDataset(deps.db, {
      id: idParsed.data.id,
      tenantId: auth.tenantId,
    });
    if (!removed) throw notFound(`dataset not found: ${idParsed.data.id}`);
    return new Response(null, { status: 204 });
  });

  // -------------------------------------------------------- list examples
  app.get('/v1/datasets/:id/examples', async (c) => {
    const idParsed = DatasetIdParam.safeParse({ id: c.req.param('id') });
    if (!idParsed.success) throw validationError('invalid dataset id', idParsed.error.issues);
    const url = new URL(c.req.url);
    const queryParsed = ListExamplesQuery.safeParse({
      split: url.searchParams.get('split') ?? undefined,
      cursor: url.searchParams.get('cursor') ?? undefined,
      limit: url.searchParams.get('limit') ?? undefined,
    });
    if (!queryParsed.success) {
      throw validationError('invalid list-examples query', queryParsed.error.issues);
    }
    const auth = getAuth(c);
    // Tenant gate: ensure the dataset exists in this tenant before
    // exposing rows. Otherwise a guess at an id from another tenant
    // would silently return empty rather than a clean 404.
    const ds = await getDatasetById(deps.db, { id: idParsed.data.id, tenantId: auth.tenantId });
    if (ds === null) throw notFound(`dataset not found: ${idParsed.data.id}`);
    const result = await listExamples(deps.db, {
      datasetId: idParsed.data.id,
      ...(queryParsed.data.split !== undefined ? { split: queryParsed.data.split } : {}),
      ...(queryParsed.data.cursor !== undefined ? { cursor: queryParsed.data.cursor } : {}),
      limit: queryParsed.data.limit,
    });
    const body = ListDatasetExamplesResponse.parse({
      examples: result.rows.map(toExampleWire),
      nextCursor: result.nextCursor,
    });
    return c.json(body);
  });

  // ----------------------------------------------------- create example
  app.post('/v1/datasets/:id/examples', async (c) => {
    requireRole(c, 'member');
    const idParsed = DatasetIdParam.safeParse({ id: c.req.param('id') });
    if (!idParsed.success) throw validationError('invalid dataset id', idParsed.error.issues);
    const json = await readJsonBody(c);
    const parsed = CreateDatasetExampleRequest.safeParse(json);
    if (!parsed.success) {
      throw validationError('invalid create-example request', parsed.error.issues);
    }
    const auth = getAuth(c);
    const ds = await getDatasetById(deps.db, { id: idParsed.data.id, tenantId: auth.tenantId });
    if (ds === null) throw notFound(`dataset not found: ${idParsed.data.id}`);
    const row = await insertExample(deps.db, {
      datasetId: idParsed.data.id,
      input: parsed.data.input,
      ...(parsed.data.expected !== undefined ? { expected: parsed.data.expected } : {}),
      ...(parsed.data.metadata !== undefined ? { metadata: parsed.data.metadata } : {}),
      ...(parsed.data.label !== undefined ? { label: parsed.data.label } : {}),
      ...(parsed.data.split !== undefined ? { split: parsed.data.split } : {}),
    });
    return c.json(DatasetExample.parse(toExampleWire(row)), 201);
  });

  // ------------------------------------------------------- bulk examples
  app.post('/v1/datasets/:id/examples/bulk', async (c) => {
    requireRole(c, 'member');
    const idParsed = DatasetIdParam.safeParse({ id: c.req.param('id') });
    if (!idParsed.success) throw validationError('invalid dataset id', idParsed.error.issues);
    const auth = getAuth(c);
    const ds = await getDatasetById(deps.db, { id: idParsed.data.id, tenantId: auth.tenantId });
    if (ds === null) throw notFound(`dataset not found: ${idParsed.data.id}`);

    // Read raw body once; enforce the 10MB cap before any parsing so a
    // hostile client cannot trick us into materialising arbitrarily
    // large structures.
    const text = await c.req.raw.text();
    if (text.length > BULK_BODY_LIMIT_BYTES) {
      throw new HttpError(
        413,
        'payload_too_large',
        `bulk-import body exceeds the ${BULK_BODY_LIMIT_BYTES}-byte limit`,
      );
    }

    const ct = (c.req.header('content-type') ?? '').toLowerCase();
    interface BulkRow {
      readonly input: unknown;
      readonly expected?: unknown;
      readonly metadata?: Record<string, unknown>;
      readonly label?: string;
      readonly split?: string;
    }
    let examples: readonly BulkRow[];
    if (ct.includes('text/csv') || ct.includes('application/csv')) {
      try {
        examples = parseCsvExamples(text);
      } catch (e) {
        throw validationError('invalid CSV body', e instanceof Error ? e.message : String(e));
      }
    } else {
      let parsedJson: unknown;
      try {
        parsedJson = text.length === 0 ? {} : JSON.parse(text);
      } catch {
        throw validationError('invalid JSON body');
      }
      const parsed = BulkCreateDatasetExamplesRequest.safeParse(parsedJson);
      if (!parsed.success) {
        throw validationError('invalid bulk request', parsed.error.issues);
      }
      // The Zod schema marks `input` as `unknown` (so even `undefined`
      // JSON literals parse). Normalise to the store's `input: unknown`
      // contract — a missing field becomes `null`.
      examples = parsed.data.examples.map((ex): BulkRow => {
        const out: BulkRow = { input: ex.input ?? null };
        if (ex.expected !== undefined) (out as { expected?: unknown }).expected = ex.expected;
        if (ex.metadata !== undefined)
          (out as { metadata?: Record<string, unknown> }).metadata = ex.metadata;
        if (ex.label !== undefined) (out as { label?: string }).label = ex.label;
        if (ex.split !== undefined) (out as { split?: string }).split = ex.split;
        return out;
      });
    }

    const result = await bulkInsertExamples(deps.db, {
      datasetId: idParsed.data.id,
      examples: examples.map((ex) => ({
        datasetId: idParsed.data.id,
        input: ex.input,
        ...(ex.expected !== undefined ? { expected: ex.expected } : {}),
        ...(ex.metadata !== undefined ? { metadata: ex.metadata } : {}),
        ...(ex.label !== undefined ? { label: ex.label } : {}),
        ...(ex.split !== undefined ? { split: ex.split } : {}),
      })),
    });
    const body = BulkCreateDatasetExamplesResponse.parse({
      inserted: result.inserted,
      skipped: result.skipped,
      errors: result.errors,
    });
    return c.json(body);
  });

  // -------------------------------------------------- update example
  app.patch('/v1/datasets/:id/examples/:exampleId', async (c) => {
    requireRole(c, 'member');
    const idParsed = ExampleIdParam.safeParse({
      id: c.req.param('id'),
      exampleId: c.req.param('exampleId'),
    });
    if (!idParsed.success) throw validationError('invalid example id', idParsed.error.issues);
    const json = await readJsonBody(c);
    const parsed = UpdateDatasetExampleRequest.safeParse(json);
    if (!parsed.success) {
      throw validationError('invalid update-example request', parsed.error.issues);
    }
    const auth = getAuth(c);
    const ds = await getDatasetById(deps.db, { id: idParsed.data.id, tenantId: auth.tenantId });
    if (ds === null) throw notFound(`dataset not found: ${idParsed.data.id}`);
    const updated = await updateExample(deps.db, {
      id: idParsed.data.exampleId,
      datasetId: idParsed.data.id,
      patch: {
        ...(parsed.data.input !== undefined ? { input: parsed.data.input } : {}),
        ...(parsed.data.expected !== undefined ? { expected: parsed.data.expected } : {}),
        ...(parsed.data.metadata !== undefined ? { metadata: parsed.data.metadata } : {}),
        ...(parsed.data.label !== undefined ? { label: parsed.data.label } : {}),
        ...(parsed.data.split !== undefined ? { split: parsed.data.split } : {}),
      },
    });
    if (updated === null) throw notFound(`example not found: ${idParsed.data.exampleId}`);
    return c.json(DatasetExample.parse(toExampleWire(updated)));
  });

  // -------------------------------------------------- delete example
  app.delete('/v1/datasets/:id/examples/:exampleId', async (c) => {
    requireRole(c, 'member');
    const idParsed = ExampleIdParam.safeParse({
      id: c.req.param('id'),
      exampleId: c.req.param('exampleId'),
    });
    if (!idParsed.success) throw validationError('invalid example id', idParsed.error.issues);
    const auth = getAuth(c);
    const ds = await getDatasetById(deps.db, { id: idParsed.data.id, tenantId: auth.tenantId });
    if (ds === null) throw notFound(`dataset not found: ${idParsed.data.id}`);
    const removed = await deleteExample(deps.db, {
      id: idParsed.data.exampleId,
      datasetId: idParsed.data.id,
    });
    if (!removed) throw notFound(`example not found: ${idParsed.data.exampleId}`);
    return new Response(null, { status: 204 });
  });

  return app;
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

/**
 * Normalise the wire-side dataset schema to the store's expected shape.
 * Drops `description: undefined` values (the store uses
 * `exactOptionalPropertyTypes: true`).
 */
function normaliseSchema(s: {
  columns: { name: string; type: string; description?: string | undefined }[];
}): { columns: { name: string; type: string; description?: string }[] } {
  return {
    columns: s.columns.map((c) =>
      c.description !== undefined
        ? { name: c.name, type: c.type, description: c.description }
        : { name: c.name, type: c.type },
    ),
  };
}

function toDatasetWire(r: DatasetRow): z.infer<typeof Dataset> {
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    schema: {
      columns: r.schema.columns.map((c) => ({
        name: c.name,
        type:
          c.type === 'string' ||
          c.type === 'number' ||
          c.type === 'boolean' ||
          c.type === 'object' ||
          c.type === 'array'
            ? c.type
            : 'string',
        ...(c.description !== undefined ? { description: c.description } : {}),
      })),
    },
    tags: [...r.tags],
    exampleCount: r.exampleCount,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

function toExampleWire(r: DatasetExampleRow): z.infer<typeof DatasetExample> {
  return {
    id: r.id,
    datasetId: r.datasetId,
    input: r.input,
    expected: r.expected ?? null,
    metadata: r.metadata,
    label: r.label,
    split: r.split,
    createdAt: r.createdAt,
  };
}

async function readJsonBody(c: { req: { raw: Request } }): Promise<unknown> {
  const text = await c.req.raw.text();
  if (text.length === 0) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw validationError('invalid JSON body');
  }
}

/**
 * Minimal CSV parser: header row followed by `input`, `expected`,
 * `label`, `split` columns (all optional except `input`). Quoted
 * fields with embedded commas are honoured. We deliberately keep this
 * tiny so we don't pull in a CSV dep — datasets-from-CSV is an
 * import convenience, not a load-bearing path.
 */
function parseCsvExamples(text: string): {
  readonly input: unknown;
  readonly expected?: unknown;
  readonly label?: string;
  readonly split?: string;
}[] {
  const rows = parseCsv(text);
  if (rows.length === 0) return [];
  const header = rows[0]?.map((s) => s.trim().toLowerCase()) ?? [];
  const idxInput = header.indexOf('input');
  if (idxInput < 0) {
    throw new Error('CSV must include an `input` column');
  }
  const idxExpected = header.indexOf('expected');
  const idxLabel = header.indexOf('label');
  const idxSplit = header.indexOf('split');
  const out: {
    input: unknown;
    expected?: unknown;
    label?: string;
    split?: string;
  }[] = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (row === undefined || row.length === 0 || (row.length === 1 && row[0] === '')) continue;
    const inputCell = row[idxInput] ?? '';
    const item: { input: unknown; expected?: unknown; label?: string; split?: string } = {
      input: inputCell,
    };
    if (idxExpected >= 0) {
      const v = row[idxExpected];
      if (v !== undefined && v.length > 0) item.expected = v;
    }
    if (idxLabel >= 0) {
      const v = row[idxLabel];
      if (v !== undefined && v.length > 0) item.label = v;
    }
    if (idxSplit >= 0) {
      const v = row[idxSplit];
      if (v !== undefined && v.length > 0) item.split = v;
    }
    out.push(item);
  }
  return out;
}

/**
 * Lightweight RFC-4180-ish CSV parser. Handles double-quoted fields,
 * escaped quotes (""), and CRLF line endings. Not a general-purpose
 * implementation; sufficient for the import use-case where the
 * authoring tool (Excel / Sheets export) is well-behaved.
 */
function parseCsv(text: string): string[][] {
  const out: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      cell += ch;
      i += 1;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (ch === ',') {
      row.push(cell);
      cell = '';
      i += 1;
      continue;
    }
    if (ch === '\n' || ch === '\r') {
      // Coalesce CRLF
      if (ch === '\r' && text[i + 1] === '\n') i += 1;
      row.push(cell);
      cell = '';
      out.push(row);
      row = [];
      i += 1;
      continue;
    }
    cell += ch;
    i += 1;
  }
  // Flush trailing cell / row
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    out.push(row);
  }
  return out;
}
