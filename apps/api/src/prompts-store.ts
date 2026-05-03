/**
 * Postgres-backed store for `prompts` and `prompt_versions` (migration 024).
 *
 * Tenant-scoped reads and writes. New versions are always created
 * (the store NEVER mutates an existing prompt_versions row in place);
 * the `latest_version` cursor on the parent `prompts` row is bumped
 * inside the same logical step.
 *
 * LLM-agnostic: every prompt version carries an abstract capability
 * class string; the gateway resolves the concrete model at /test
 * time. Nothing in this module references a provider name.
 */

import { randomUUID } from 'node:crypto';
import type {
  PromptDiffResponse,
  PromptVariablesSchema,
  PromptVersion as PromptVersionWire,
  Prompt as PromptWire,
} from '@aldo-ai/api-contract';
import type { SqlClient } from '@aldo-ai/storage';

// ─────────────────────────────────────────── DB row shapes

interface PromptDbRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly project_id: string | null;
  readonly name: string;
  readonly description: string;
  readonly latest_version: number;
  readonly created_by: string;
  readonly archived_at: Date | string | null;
  readonly created_at: Date | string;
  readonly updated_at: Date | string;
  /** Joined-in capability class from the latest version (NULL when no versions yet). */
  readonly model_capability?: string | null;
  readonly [k: string]: unknown;
}

interface PromptVersionDbRow {
  readonly id: string;
  readonly prompt_id: string;
  readonly version: number;
  readonly body: string;
  readonly variables_schema: unknown;
  readonly model_capability: string;
  readonly parent_version_id: string | null;
  readonly notes: string;
  readonly created_by: string;
  readonly created_at: Date | string;
  readonly [k: string]: unknown;
}

// ─────────────────────────────────────────── In-process types (richer than wire)

export interface PromptRow {
  readonly id: string;
  readonly tenantId: string;
  readonly projectId: string | null;
  readonly name: string;
  readonly description: string;
  readonly latestVersion: number;
  readonly modelCapability: string;
  readonly createdBy: string;
  readonly archivedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface PromptVersionRow {
  readonly id: string;
  readonly promptId: string;
  readonly version: number;
  readonly body: string;
  readonly variablesSchema: PromptVariablesSchema;
  readonly modelCapability: string;
  readonly parentVersionId: string | null;
  readonly notes: string;
  readonly createdBy: string;
  readonly createdAt: string;
}

// ─────────────────────────────────────────── Errors

export class PromptNameConflictError extends Error {
  constructor(name: string) {
    super(`prompt name already exists in this project: ${name}`);
    this.name = 'PromptNameConflictError';
  }
}

export class MissingVariableError extends Error {
  readonly missing: readonly string[];
  constructor(missing: readonly string[]) {
    super(`missing required variable(s): ${missing.join(', ')}`);
    this.name = 'MissingVariableError';
    this.missing = missing;
  }
}

// ─────────────────────────────────────────── Helpers

function toIso(v: Date | string): string {
  return v instanceof Date ? v.toISOString() : v;
}

function toIsoOrNull(v: Date | string | null): string | null {
  if (v === null) return null;
  return toIso(v);
}

function parseVariablesSchema(v: unknown): PromptVariablesSchema {
  let parsed: unknown = v;
  if (typeof v === 'string') {
    try {
      parsed = JSON.parse(v);
    } catch {
      parsed = { variables: [] };
    }
  }
  if (parsed === null || typeof parsed !== 'object') return { variables: [] };
  const obj = parsed as { variables?: unknown };
  if (!Array.isArray(obj.variables)) return { variables: [] };
  // Narrow each variable to the wire shape, dropping anything that
  // doesn't match. Defensive: the schema is JSONB free-shape so a
  // hand-crafted INSERT could ship a malformed entry we should never
  // surface to clients.
  const variables = obj.variables.flatMap((entry) => {
    if (entry === null || typeof entry !== 'object') return [];
    const e = entry as {
      name?: unknown;
      type?: unknown;
      description?: unknown;
      required?: unknown;
    };
    if (typeof e.name !== 'string' || e.name.length === 0) return [];
    const type =
      e.type === 'string' ||
      e.type === 'number' ||
      e.type === 'boolean' ||
      e.type === 'object' ||
      e.type === 'array'
        ? e.type
        : ('string' as const);
    const out: {
      name: string;
      type: 'string' | 'number' | 'boolean' | 'object' | 'array';
      description?: string;
      required: boolean;
    } = {
      name: e.name,
      type,
      required: e.required === undefined ? true : Boolean(e.required),
    };
    if (typeof e.description === 'string') out.description = e.description;
    return [out];
  });
  return { variables };
}

function toPromptRow(r: PromptDbRow): PromptRow {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    projectId: r.project_id,
    name: r.name,
    description: r.description,
    latestVersion: Number(r.latest_version),
    modelCapability: r.model_capability ?? 'reasoning-medium',
    createdBy: r.created_by,
    archivedAt: toIsoOrNull(r.archived_at),
    createdAt: toIso(r.created_at),
    updatedAt: toIso(r.updated_at),
  };
}

function toVersionRow(r: PromptVersionDbRow): PromptVersionRow {
  return {
    id: r.id,
    promptId: r.prompt_id,
    version: Number(r.version),
    body: r.body,
    variablesSchema: parseVariablesSchema(r.variables_schema),
    modelCapability: r.model_capability,
    parentVersionId: r.parent_version_id,
    notes: r.notes,
    createdBy: r.created_by,
    createdAt: toIso(r.created_at),
  };
}

export function promptToWire(r: PromptRow): PromptWire {
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    projectId: r.projectId,
    latestVersion: r.latestVersion,
    modelCapability: r.modelCapability,
    createdBy: r.createdBy,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

export function versionToWire(r: PromptVersionRow): PromptVersionWire {
  return {
    id: r.id,
    promptId: r.promptId,
    version: r.version,
    body: r.body,
    variablesSchema: r.variablesSchema,
    modelCapability: r.modelCapability,
    parentVersionId: r.parentVersionId,
    notes: r.notes,
    createdBy: r.createdBy,
    createdAt: r.createdAt,
  };
}

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: string }).code === '23505'
  );
}

// ─────────────────────────────────────────── List / read

const SELECT_PROMPT_COLS = `
  p.id, p.tenant_id, p.project_id, p.name, p.description, p.latest_version,
  p.created_by, p.archived_at, p.created_at, p.updated_at,
  (SELECT v.model_capability FROM prompt_versions v
     WHERE v.prompt_id = p.id ORDER BY v.version DESC LIMIT 1) AS model_capability
`;

export async function listPromptsForTenant(
  db: SqlClient,
  args: { tenantId: string; projectId?: string | null },
): Promise<readonly PromptRow[]> {
  const params: unknown[] = [args.tenantId];
  let where = 'p.tenant_id = $1 AND p.archived_at IS NULL';
  if (args.projectId !== undefined && args.projectId !== null) {
    params.push(args.projectId);
    where += ` AND p.project_id = $${params.length}`;
  }
  const res = await db.query<PromptDbRow>(
    `SELECT ${SELECT_PROMPT_COLS}
       FROM prompts p
       WHERE ${where}
       ORDER BY p.updated_at DESC`,
    params,
  );
  return res.rows.map(toPromptRow);
}

export async function getPromptById(
  db: SqlClient,
  args: { id: string; tenantId: string },
): Promise<PromptRow | null> {
  const res = await db.query<PromptDbRow>(
    `SELECT ${SELECT_PROMPT_COLS}
       FROM prompts p
       WHERE p.id = $1 AND p.tenant_id = $2 AND p.archived_at IS NULL`,
    [args.id, args.tenantId],
  );
  const row = res.rows[0];
  return row === undefined ? null : toPromptRow(row);
}

export async function getPromptByName(
  db: SqlClient,
  args: { tenantId: string; projectId: string | null; name: string },
): Promise<PromptRow | null> {
  const params: unknown[] = [args.tenantId, args.name];
  let projectClause: string;
  if (args.projectId === null) {
    projectClause = 'p.project_id IS NULL';
  } else {
    params.push(args.projectId);
    projectClause = `p.project_id = $${params.length}`;
  }
  const res = await db.query<PromptDbRow>(
    `SELECT ${SELECT_PROMPT_COLS}
       FROM prompts p
       WHERE p.tenant_id = $1 AND p.name = $2 AND ${projectClause}
         AND p.archived_at IS NULL
       LIMIT 1`,
    params,
  );
  const row = res.rows[0];
  return row === undefined ? null : toPromptRow(row);
}

export async function listVersionsForPrompt(
  db: SqlClient,
  args: { promptId: string },
): Promise<readonly PromptVersionRow[]> {
  const res = await db.query<PromptVersionDbRow>(
    `SELECT id, prompt_id, version, body, variables_schema, model_capability,
            parent_version_id, notes, created_by, created_at
       FROM prompt_versions
       WHERE prompt_id = $1
       ORDER BY version DESC`,
    [args.promptId],
  );
  return res.rows.map(toVersionRow);
}

export async function getVersion(
  db: SqlClient,
  args: { promptId: string; version: number },
): Promise<PromptVersionRow | null> {
  const res = await db.query<PromptVersionDbRow>(
    `SELECT id, prompt_id, version, body, variables_schema, model_capability,
            parent_version_id, notes, created_by, created_at
       FROM prompt_versions
       WHERE prompt_id = $1 AND version = $2`,
    [args.promptId, args.version],
  );
  const row = res.rows[0];
  return row === undefined ? null : toVersionRow(row);
}

export async function getLatestVersion(
  db: SqlClient,
  args: { promptId: string },
): Promise<PromptVersionRow | null> {
  const res = await db.query<PromptVersionDbRow>(
    `SELECT id, prompt_id, version, body, variables_schema, model_capability,
            parent_version_id, notes, created_by, created_at
       FROM prompt_versions
       WHERE prompt_id = $1
       ORDER BY version DESC
       LIMIT 1`,
    [args.promptId],
  );
  const row = res.rows[0];
  return row === undefined ? null : toVersionRow(row);
}

// ─────────────────────────────────────────── Create / update

export interface InsertPromptInput {
  readonly tenantId: string;
  readonly projectId: string | null;
  readonly name: string;
  readonly description: string;
  readonly createdBy: string;
  readonly body: string;
  readonly variablesSchema: PromptVariablesSchema;
  readonly modelCapability: string;
  readonly notes: string;
}

export async function insertPromptWithInitialVersion(
  db: SqlClient,
  input: InsertPromptInput,
): Promise<{ prompt: PromptRow; version: PromptVersionRow }> {
  const promptId = `pmt_${randomUUID()}`;
  try {
    await db.query(
      `INSERT INTO prompts (id, tenant_id, project_id, name, description, latest_version, created_by)
       VALUES ($1, $2, $3, $4, $5, 1, $6)`,
      [promptId, input.tenantId, input.projectId, input.name, input.description, input.createdBy],
    );
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new PromptNameConflictError(input.name);
    }
    throw err;
  }
  const versionId = `pmtv_${randomUUID()}`;
  await db.query(
    `INSERT INTO prompt_versions (id, prompt_id, version, body, variables_schema,
                                  model_capability, parent_version_id, notes, created_by)
     VALUES ($1, $2, 1, $3, $4::jsonb, $5, NULL, $6, $7)`,
    [
      versionId,
      promptId,
      input.body,
      JSON.stringify(input.variablesSchema),
      input.modelCapability,
      input.notes,
      input.createdBy,
    ],
  );
  const prompt = await getPromptById(db, { id: promptId, tenantId: input.tenantId });
  const version = await getVersion(db, { promptId, version: 1 });
  if (prompt === null || version === null) {
    throw new Error('insert prompt: row vanished after insert');
  }
  return { prompt, version };
}

export interface UpdatePromptPatch {
  readonly name?: string;
  readonly description?: string;
  readonly projectId?: string | null;
}

export async function updatePromptMeta(
  db: SqlClient,
  args: { id: string; tenantId: string; patch: UpdatePromptPatch },
): Promise<PromptRow | null> {
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
  if (args.patch.projectId !== undefined) {
    params.push(args.patch.projectId);
    sets.push(`project_id = $${params.length}`);
  }
  if (sets.length === 0) return getPromptById(db, { id: args.id, tenantId: args.tenantId });
  sets.push('updated_at = now()');
  params.push(args.id);
  const idIdx = params.length;
  params.push(args.tenantId);
  const tIdx = params.length;
  try {
    await db.query(
      `UPDATE prompts SET ${sets.join(', ')}
        WHERE id = $${idIdx} AND tenant_id = $${tIdx} AND archived_at IS NULL`,
      params,
    );
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new PromptNameConflictError(args.patch.name ?? '');
    }
    throw err;
  }
  return getPromptById(db, { id: args.id, tenantId: args.tenantId });
}

export async function softDeletePrompt(
  db: SqlClient,
  args: { id: string; tenantId: string },
): Promise<boolean> {
  const res = await db.query(
    `UPDATE prompts SET archived_at = now(), updated_at = now()
       WHERE id = $1 AND tenant_id = $2 AND archived_at IS NULL`,
    [args.id, args.tenantId],
  );
  const count = (res as unknown as { rowCount?: number }).rowCount;
  if (typeof count === 'number') return count > 0;
  // pglite doesn't always populate rowCount; fall back to a re-read.
  const after = await db.query<{ archived_at: Date | string | null }>(
    'SELECT archived_at FROM prompts WHERE id = $1 AND tenant_id = $2',
    [args.id, args.tenantId],
  );
  return after.rows[0]?.archived_at !== null && after.rows[0]?.archived_at !== undefined;
}

export interface InsertVersionInput {
  readonly promptId: string;
  readonly tenantId: string;
  readonly body: string;
  readonly variablesSchema: PromptVariablesSchema;
  readonly modelCapability: string;
  readonly notes: string;
  readonly createdBy: string;
  readonly parentVersionId: string | null;
}

/**
 * Create a new version. Bumps `prompts.latest_version` and inserts a
 * fresh `prompt_versions` row in the same logical operation.
 *
 * Concurrency: two writers racing on the same prompt would both read
 * the same `latest_version`, both compute `next = latest + 1`, and the
 * second INSERT would hit the UNIQUE (prompt_id, version) constraint.
 * We catch the unique-violation and retry once with a fresh read; if
 * the second attempt also collides, we surface the error (real
 * starvation is vanishingly unlikely on a per-prompt write rate).
 */
export async function insertVersion(
  db: SqlClient,
  input: InsertVersionInput,
): Promise<{ prompt: PromptRow; version: PromptVersionRow }> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const prompt = await getPromptById(db, { id: input.promptId, tenantId: input.tenantId });
    if (prompt === null) {
      throw new Error(`prompt not found: ${input.promptId}`);
    }
    const next = prompt.latestVersion + 1;
    const versionId = `pmtv_${randomUUID()}`;
    try {
      await db.query(
        `INSERT INTO prompt_versions (id, prompt_id, version, body, variables_schema,
                                      model_capability, parent_version_id, notes, created_by)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9)`,
        [
          versionId,
          input.promptId,
          next,
          input.body,
          JSON.stringify(input.variablesSchema),
          input.modelCapability,
          input.parentVersionId,
          input.notes,
          input.createdBy,
        ],
      );
    } catch (err) {
      if (isUniqueViolation(err) && attempt === 0) continue;
      throw err;
    }
    await db.query(
      `UPDATE prompts SET latest_version = $1, updated_at = now()
        WHERE id = $2 AND tenant_id = $3`,
      [next, input.promptId, input.tenantId],
    );
    const updated = await getPromptById(db, { id: input.promptId, tenantId: input.tenantId });
    const version = await getVersion(db, { promptId: input.promptId, version: next });
    if (updated === null || version === null) {
      throw new Error('insert version: row vanished after insert');
    }
    return { prompt: updated, version };
  }
  throw new Error('insert version: failed to allocate a fresh version number after 2 attempts');
}

// ─────────────────────────────────────────── Variable substitution + diff

const VARIABLE_RE = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g;

/**
 * Extract every `{{name}}` placeholder in a body. Order-preserving,
 * de-duplicated. Used by the editor to auto-build a variable schema
 * and by the /test endpoint to know which keys it MUST receive.
 */
export function extractVariableNames(body: string): readonly string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  // Reset lastIndex defensively — the regex is module-scoped and
  // `g`-flagged, so consecutive callers would otherwise inherit state.
  VARIABLE_RE.lastIndex = 0;
  let match: RegExpExecArray | null = VARIABLE_RE.exec(body);
  while (match !== null) {
    const name = match[1];
    if (name !== undefined && !seen.has(name)) {
      seen.add(name);
      out.push(name);
    }
    match = VARIABLE_RE.exec(body);
  }
  return out;
}

/**
 * Substitute `{{name}}` placeholders against a variables map.
 *
 * Throws `MissingVariableError` if any required variable (per the
 * passed-in schema; OR by membership in the body when no schema entry
 * exists) is missing from the map. Non-string values are stringified
 * via JSON.stringify; primitive values use String() so callers don't
 * see surprise quoting.
 */
export function substituteVariables(
  body: string,
  variables: Record<string, unknown>,
  schema: PromptVariablesSchema,
): string {
  const present = extractVariableNames(body);
  const requiredFromSchema = new Set(schema.variables.filter((v) => v.required).map((v) => v.name));
  // A variable is "required at substitution time" if either (a) the
  // schema marks it required, or (b) it's referenced in the body and
  // doesn't appear in the schema with required:false.
  const required = new Set<string>(requiredFromSchema);
  const optional = new Set(schema.variables.filter((v) => !v.required).map((v) => v.name));
  for (const name of present) {
    if (!optional.has(name)) required.add(name);
  }
  const missing: string[] = [];
  for (const name of required) {
    const v = variables[name];
    if (v === undefined || v === null) missing.push(name);
  }
  if (missing.length > 0) throw new MissingVariableError(missing);
  VARIABLE_RE.lastIndex = 0;
  return body.replace(VARIABLE_RE, (_, name: string) => {
    const v = variables[name];
    if (v === undefined || v === null) return '';
    if (typeof v === 'string') return v;
    if (typeof v === 'number' || typeof v === 'boolean') return String(v);
    try {
      return JSON.stringify(v);
    } catch {
      return String(v);
    }
  });
}

/**
 * Compute a line-by-line diff between two version bodies.
 *
 * Implementation: classic Myers-style LCS over lines. For prompt-sized
 * bodies (typically <2k lines) the O(n*m) memory cost is fine and the
 * implementation stays auditable. We deliberately avoid pulling in a
 * diff library — the wire shape is "lines + kind" which any naive
 * algorithm produces.
 */
export function diffPromptBodies(
  fromBody: string,
  toBody: string,
  fromVersion: number,
  toVersion: number,
): PromptDiffResponse {
  const a = fromBody.split('\n');
  const b = toBody.split('\n');
  // LCS table of lengths.
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i]![j] = (dp[i - 1]![j - 1] ?? 0) + 1;
      } else {
        dp[i]![j] = Math.max(dp[i - 1]![j] ?? 0, dp[i]![j - 1] ?? 0);
      }
    }
  }
  // Walk back to produce the line list.
  const out: { kind: 'added' | 'removed' | 'unchanged'; text: string }[] = [];
  let i = m;
  let j = n;
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) {
      out.push({ kind: 'unchanged', text: a[i - 1] ?? '' });
      i -= 1;
      j -= 1;
    } else if ((dp[i - 1]![j] ?? 0) >= (dp[i]![j - 1] ?? 0)) {
      out.push({ kind: 'removed', text: a[i - 1] ?? '' });
      i -= 1;
    } else {
      out.push({ kind: 'added', text: b[j - 1] ?? '' });
      j -= 1;
    }
  }
  while (i > 0) {
    out.push({ kind: 'removed', text: a[i - 1] ?? '' });
    i -= 1;
  }
  while (j > 0) {
    out.push({ kind: 'added', text: b[j - 1] ?? '' });
    j -= 1;
  }
  out.reverse();
  let added = 0;
  let removed = 0;
  let unchanged = 0;
  for (const l of out) {
    if (l.kind === 'added') added += 1;
    else if (l.kind === 'removed') removed += 1;
    else unchanged += 1;
  }
  return {
    fromVersion,
    toVersion,
    lines: out,
    stats: { added, removed, unchanged },
  };
}

// ─────────────────────────────────────────── "Used by" — agents referencing this prompt

export interface AgentReference {
  readonly agentName: string;
  readonly version: string;
  readonly promptVersion: number;
}

/**
 * Scan registered_agents in the tenant for spec_yaml documents that
 * reference this prompt id. We string-match on the prompt id rather
 * than parse YAML — much cheaper, and false-positives are
 * vanishingly unlikely (the prompt id format `pmt_<uuid>` is
 * effectively unique across the spec corpus).
 *
 * We also try to extract the referenced version by looking for the
 * adjacent `version:` line. When the YAML doesn't have a numeric
 * version (e.g. the spec uses `version: latest` syntactically), we
 * fall back to 0 so the consumer can detect "unknown".
 */
export async function listAgentsReferencingPrompt(
  db: SqlClient,
  args: { tenantId: string; promptId: string },
): Promise<readonly AgentReference[]> {
  const res = await db.query<{ name: string; version: string; spec_yaml: string }>(
    `SELECT name, version, spec_yaml FROM registered_agents
       WHERE tenant_id = $1 AND spec_yaml LIKE $2`,
    [args.tenantId, `%${args.promptId}%`],
  );
  const out: AgentReference[] = [];
  for (const row of res.rows) {
    const promptVersion = extractPromptVersion(row.spec_yaml, args.promptId);
    out.push({ agentName: row.name, version: row.version, promptVersion });
  }
  return out;
}

function extractPromptVersion(yaml: string, promptId: string): number {
  // Look for a window around the prompt id reference; the conventional
  // shape is:
  //   prompt_ref:
  //     id: pmt_xxx
  //     version: 3
  // We tolerate either order of `id` / `version` and either snake or
  // camel case. Ranges around the id reference are searched up to 200
  // characters in either direction.
  const idIdx = yaml.indexOf(promptId);
  if (idIdx < 0) return 0;
  const start = Math.max(0, idIdx - 200);
  const end = Math.min(yaml.length, idIdx + 200);
  const window = yaml.slice(start, end);
  const m = window.match(/version:\s*(\d+)/);
  if (m === null) return 0;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 ? n : 0;
}
