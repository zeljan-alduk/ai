/**
 * Postgres-backed sweep + suite store for the eval HTTP surface.
 *
 * The wire-level types come from `@aldo-ai/api-contract` (`EvalSuite`,
 * `Sweep`, `SweepCellResult`); we go through `@aldo-ai/storage`'s
 * `SqlClient` so the store works against pglite (tests), node-postgres,
 * and Neon HTTP without changes.
 *
 * This module is also where we pin the in-flight `@aldo-ai/eval` engine
 * surface — `SweepStore`, `SweepRunner`, `PromotionGate`, and the suite
 * loader — as local interface declarations marked with TODO(integrate).
 * Engineer A's package can drop the same names in and the route module
 * will pick them up at compile time without route changes.
 *
 * Tables (003_eval.sql):
 *  - eval_suites(name, version, yaml, agent_name, case_count, created_at)
 *  - sweeps(id, suite_name, suite_version, agent_name, agent_version,
 *           models JSONB, status, started_at, ended_at)
 *  - sweep_cells(id, sweep_id, case_id, model, passed, score, output,
 *                detail_jsonb, cost_usd, duration_ms)
 */

import { EvalSuite as EvalSuiteSchema } from '@aldo-ai/api-contract';
import type { EvalSuite, Sweep, SweepCellResult, SweepStatus } from '@aldo-ai/api-contract';
import type { SqlClient } from '@aldo-ai/storage';
import YAML from 'yaml';

// ---------------------------------------------------------------------------
// Engine surface — names chosen to match Engineer A's in-flight @aldo-ai/eval.
// ---------------------------------------------------------------------------

// TODO(integrate): replace these local types with imports from
// `@aldo-ai/eval` once Engineer A's package ships:
//   import type {
//     SweepStore,
//     SweepRunner,
//     PromotionGate,
//     loadSuiteFromYaml,
//   } from '@aldo-ai/eval';
//
// The shapes below are the contract this package assumes. Engineer A:
// please match these names exactly so the swap is mechanical.

/** Persistence interface that `@aldo-ai/eval`'s runner writes through. */
export interface SweepStore {
  /** Insert / overwrite a registered suite. */
  putSuite(suite: EvalSuite, yamlText: string): Promise<void>;
  /** List every registered suite (latest version per name). */
  listSuites(): Promise<readonly EvalSuiteSummary[]>;
  /** Fetch the latest version of a suite by name; null if unknown. */
  getSuiteLatest(name: string): Promise<EvalSuite | null>;
  /** Fetch a specific version; null if unknown. */
  getSuiteVersion(name: string, version: string): Promise<EvalSuite | null>;

  /** Insert a new sweep row in `queued` status. */
  putSweep(input: NewSweepInput): Promise<void>;
  /** Update status / endedAt for a sweep. */
  updateSweepStatus(id: string, status: SweepStatus, endedAt: string | null): Promise<void>;
  /** Persist all cells for a sweep (atomic per call). */
  putCells(sweepId: string, cells: readonly SweepCellResult[]): Promise<void>;
  /** Read a sweep + its cells; null if unknown. */
  getSweep(id: string): Promise<Sweep | null>;
  /** List sweeps with optional filters; cursor-paged by started_at desc. */
  listSweeps(opts: ListSweepsOptions): Promise<ListSweepsResult>;
}

export interface EvalSuiteSummary {
  readonly name: string;
  readonly version: string;
  readonly description: string;
  readonly agent: string;
  readonly caseCount: number;
}

export interface NewSweepInput {
  readonly id: string;
  readonly suiteName: string;
  readonly suiteVersion: string;
  readonly agentName: string;
  readonly agentVersion: string;
  readonly models: readonly string[];
  readonly status: SweepStatus;
  readonly startedAt: string;
}

export interface ListSweepsOptions {
  readonly agent?: string | undefined;
  readonly status?: SweepStatus | undefined;
  readonly limit: number;
  readonly cursor?: { readonly at: string; readonly id: string } | undefined;
}

export interface ListSweepsResult {
  readonly sweeps: readonly SweepListRow[];
  readonly nextCursor: string | null;
  readonly hasMore: boolean;
}

export interface SweepListRow {
  readonly id: string;
  readonly suiteName: string;
  readonly suiteVersion: string;
  readonly agentName: string;
  readonly agentVersion: string;
  readonly status: SweepStatus;
  readonly startedAt: string;
  readonly endedAt: string | null;
  readonly modelCount: number;
  readonly caseCount: number;
}

/** Cross-model runner — engineer A owns the implementation. */
export interface SweepRunner {
  /**
   * Execute `suite` against every entry in `models`. Returns the per-cell
   * results. The runner is responsible for invoking the gateway, scoring
   * via the suite's `expect` shapes, and stamping cost/duration.
   */
  run(suite: EvalSuite, models: readonly string[]): Promise<readonly SweepCellResult[]>;
}

/** Gate that resolves an agent's declared eval suites and runs them. */
export interface PromotionGate {
  /**
   * Run every suite the agent's `eval_gate` declares against `models`.
   * Returns one report per suite. Empty `models` means use the gate's
   * declared default models.
   */
  check(agentSpec: unknown, models: readonly string[]): Promise<readonly PromotionGateReport[]>;
}

export interface PromotionGateReport {
  readonly suiteName: string;
  readonly suiteVersion: string;
  readonly sweepId: string;
  readonly passed: boolean;
}

/** Suite YAML -> schema. Engineer A owns the implementation. */
export type LoadSuiteFromYaml = (yamlText: string) => EvalSuite;

// ---------------------------------------------------------------------------
// Postgres implementation of SweepStore
// ---------------------------------------------------------------------------

export class PostgresSweepStore implements SweepStore {
  constructor(private readonly db: SqlClient) {}

  // ---- suites -------------------------------------------------------------

  async putSuite(suite: EvalSuite, yamlText: string): Promise<void> {
    await this.db.query(
      `INSERT INTO eval_suites (name, version, yaml, agent_name, case_count)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (name, version) DO UPDATE
         SET yaml = EXCLUDED.yaml,
             agent_name = EXCLUDED.agent_name,
             case_count = EXCLUDED.case_count`,
      [suite.name, suite.version, yamlText, suite.agent, suite.cases.length],
    );
  }

  async listSuites(): Promise<readonly EvalSuiteSummary[]> {
    const sql = `
      SELECT s.name, s.version, s.agent_name, s.case_count, s.yaml
        FROM eval_suites s
        JOIN LATERAL (
          SELECT version FROM eval_suites
           WHERE name = s.name
           ORDER BY created_at DESC, version DESC
           LIMIT 1
        ) latest ON latest.version = s.version
       ORDER BY s.name ASC
    `;
    const res = await this.db.query<{
      name: string;
      version: string;
      agent_name: string;
      case_count: number | string;
      yaml: string;
    }>(sql);
    return res.rows.map((r) => ({
      name: r.name,
      version: r.version,
      description: extractYamlDescription(r.yaml),
      agent: r.agent_name,
      caseCount: Number(r.case_count),
    }));
  }

  async getSuiteLatest(name: string): Promise<EvalSuite | null> {
    const res = await this.db.query<{ yaml: string }>(
      `SELECT yaml FROM eval_suites
        WHERE name = $1
        ORDER BY created_at DESC, version DESC
        LIMIT 1`,
      [name],
    );
    const row = res.rows[0];
    if (row === undefined) return null;
    return parseYamlSuite(row.yaml);
  }

  async getSuiteVersion(name: string, version: string): Promise<EvalSuite | null> {
    const res = await this.db.query<{ yaml: string }>(
      'SELECT yaml FROM eval_suites WHERE name = $1 AND version = $2',
      [name, version],
    );
    const row = res.rows[0];
    if (row === undefined) return null;
    return parseYamlSuite(row.yaml);
  }

  // ---- sweeps -------------------------------------------------------------

  async putSweep(input: NewSweepInput): Promise<void> {
    await this.db.query(
      `INSERT INTO sweeps (
         id, suite_name, suite_version, agent_name, agent_version,
         models, status, started_at, ended_at
       ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, NULL)`,
      [
        input.id,
        input.suiteName,
        input.suiteVersion,
        input.agentName,
        input.agentVersion,
        JSON.stringify([...input.models]),
        input.status,
        input.startedAt,
      ],
    );
  }

  async updateSweepStatus(id: string, status: SweepStatus, endedAt: string | null): Promise<void> {
    await this.db.query('UPDATE sweeps SET status = $1, ended_at = $2 WHERE id = $3', [
      status,
      endedAt,
      id,
    ]);
  }

  async putCells(sweepId: string, cells: readonly SweepCellResult[]): Promise<void> {
    let i = 0;
    for (const cell of cells) {
      i += 1;
      const detail = cell.detail === undefined ? null : JSON.stringify(cell.detail);
      await this.db.query(
        `INSERT INTO sweep_cells (
           id, sweep_id, case_id, model, passed, score, output,
           detail_jsonb, cost_usd, duration_ms
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10)`,
        [
          `${sweepId}-c-${i}`,
          sweepId,
          cell.caseId,
          cell.model,
          cell.passed,
          cell.score,
          cell.output,
          detail,
          cell.costUsd,
          cell.durationMs,
        ],
      );
    }
  }

  async getSweep(id: string): Promise<Sweep | null> {
    const head = await this.db.query<SweepHeadRow>(
      `SELECT id, suite_name, suite_version, agent_name, agent_version,
              models, status, started_at, ended_at
         FROM sweeps WHERE id = $1`,
      [id],
    );
    const row = head.rows[0];
    if (row === undefined) return null;

    const cellsRes = await this.db.query<SweepCellRow>(
      `SELECT case_id, model, passed, score, output, detail_jsonb,
              cost_usd, duration_ms
         FROM sweep_cells WHERE sweep_id = $1
         ORDER BY id ASC`,
      [id],
    );
    const cells: SweepCellResult[] = cellsRes.rows.map(rowToCell);
    const models = parseModels(row.models);
    return rowToSweep(row, models, cells);
  }

  async listSweeps(opts: ListSweepsOptions): Promise<ListSweepsResult> {
    const params: unknown[] = [];
    const where: string[] = [];

    if (opts.agent !== undefined) {
      params.push(opts.agent);
      where.push(`s.agent_name = $${params.length}`);
    }
    if (opts.status !== undefined) {
      params.push(opts.status);
      where.push(`s.status = $${params.length}`);
    }
    if (opts.cursor !== undefined) {
      params.push(opts.cursor.at);
      const atIdx = params.length;
      params.push(opts.cursor.id);
      const idIdx = params.length;
      where.push(`(s.started_at, s.id) < ($${atIdx}::timestamptz, $${idIdx})`);
    }

    params.push(opts.limit + 1);
    const limitIdx = params.length;

    const sql = `
      SELECT s.id, s.suite_name, s.suite_version, s.agent_name, s.agent_version,
             s.models, s.status, s.started_at, s.ended_at,
             (SELECT COUNT(*) FROM sweep_cells c WHERE c.sweep_id = s.id) AS cell_count
        FROM sweeps s
        ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY s.started_at DESC, s.id DESC
        LIMIT $${limitIdx}
    `;
    const res = await this.db.query<SweepHeadRow & { cell_count: string | number }>(sql, params);
    const rows = res.rows.slice(0, opts.limit);
    const hasMore = res.rows.length > opts.limit;
    const last = rows[rows.length - 1];
    const nextCursor =
      hasMore && last !== undefined
        ? encodeSweepCursor({ at: toIso(last.started_at), id: last.id })
        : null;

    const sweeps: SweepListRow[] = rows.map((r) => {
      const models = parseModels(r.models);
      const cellCount = Number(r.cell_count);
      const caseCount = models.length === 0 ? cellCount : Math.floor(cellCount / models.length);
      return {
        id: r.id,
        suiteName: r.suite_name,
        suiteVersion: r.suite_version,
        agentName: r.agent_name,
        agentVersion: r.agent_version,
        status: r.status as SweepStatus,
        startedAt: toIso(r.started_at),
        endedAt: toIsoOrNull(r.ended_at),
        modelCount: models.length,
        caseCount,
      };
    });

    return { sweeps, nextCursor, hasMore };
  }
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

interface SweepHeadRow {
  readonly id: string;
  readonly suite_name: string;
  readonly suite_version: string;
  readonly agent_name: string;
  readonly agent_version: string;
  readonly models: unknown;
  readonly status: string;
  readonly started_at: string | Date;
  readonly ended_at: string | Date | null;
  readonly [k: string]: unknown;
}

interface SweepCellRow {
  readonly case_id: string;
  readonly model: string;
  readonly passed: boolean;
  readonly score: number | string;
  readonly output: string;
  readonly detail_jsonb: unknown;
  readonly cost_usd: number | string;
  readonly duration_ms: number | string;
  readonly [k: string]: unknown;
}

function rowToCell(r: SweepCellRow): SweepCellResult {
  const detail =
    r.detail_jsonb === null || r.detail_jsonb === undefined
      ? undefined
      : typeof r.detail_jsonb === 'string'
        ? (JSON.parse(r.detail_jsonb) as unknown)
        : r.detail_jsonb;
  return {
    caseId: r.case_id,
    model: r.model,
    passed: r.passed,
    score: Number(r.score),
    output: r.output,
    ...(detail !== undefined ? { detail } : {}),
    costUsd: Number(r.cost_usd),
    durationMs: Number(r.duration_ms),
  };
}

function rowToSweep(
  r: SweepHeadRow,
  models: readonly string[],
  cells: readonly SweepCellResult[],
): Sweep {
  const byModel: Record<string, { passed: number; total: number; usd: number }> = {};
  for (const m of models) byModel[m] = { passed: 0, total: 0, usd: 0 };
  for (const c of cells) {
    let bucket = byModel[c.model];
    if (bucket === undefined) {
      bucket = { passed: 0, total: 0, usd: 0 };
      byModel[c.model] = bucket;
    }
    bucket.total += 1;
    if (c.passed) bucket.passed += 1;
    bucket.usd += c.costUsd;
  }
  return {
    id: r.id,
    suiteName: r.suite_name,
    suiteVersion: r.suite_version,
    agentName: r.agent_name,
    agentVersion: r.agent_version,
    models: [...models],
    status: r.status as SweepStatus,
    startedAt: toIso(r.started_at),
    endedAt: toIsoOrNull(r.ended_at),
    byModel,
    cells: [...cells],
  };
}

function parseModels(raw: unknown): readonly string[] {
  const value = typeof raw === 'string' ? (JSON.parse(raw) as unknown) : raw;
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === 'string');
}

function toIso(v: unknown): string {
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'string') {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? v : d.toISOString();
  }
  return new Date(0).toISOString();
}

function toIsoOrNull(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  return toIso(v);
}

export function encodeSweepCursor(c: { at: string; id: string }): string {
  return Buffer.from(JSON.stringify(c), 'utf8').toString('base64url');
}

export function decodeSweepCursor(s: string): { at: string; id: string } | null {
  try {
    const json = Buffer.from(s, 'base64url').toString('utf8');
    const parsed = JSON.parse(json) as unknown;
    if (
      parsed === null ||
      typeof parsed !== 'object' ||
      typeof (parsed as { at: unknown }).at !== 'string' ||
      typeof (parsed as { id: unknown }).id !== 'string'
    ) {
      return null;
    }
    const o = parsed as { at: string; id: string };
    return { at: o.at, id: o.id };
  } catch {
    return null;
  }
}

// --- minimal YAML helpers (just enough for v0; engineer A's
//     `loadSuiteFromYaml` is the authoritative parser once it ships) ---

function parseYamlSuite(yamlText: string): EvalSuite {
  // The full parse + validation lives in @aldo-ai/eval. Until that ships
  // we use the `yaml` package (already a dependency of @aldo-ai/api) and
  // run the result through the contract's Zod schema for safety.
  const raw = YAML.parse(yamlText) as unknown;
  return EvalSuiteSchema.parse(raw);
}

function extractYamlDescription(yamlText: string): string {
  // Cheap pre-parse description extraction so listSuites doesn't have to
  // re-validate every row. Falls back to '' if absent / unparsable.
  try {
    const raw = YAML.parse(yamlText) as unknown;
    if (raw !== null && typeof raw === 'object') {
      const d = (raw as { description?: unknown }).description;
      if (typeof d === 'string') return d;
    }
  } catch {
    // ignore
  }
  return '';
}
