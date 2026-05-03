/**
 * Unit + snapshot tests for the N-way comparison row builders.
 *
 * The render layer is a thin map over the `ComparisonRow[]` shape, so
 * pinning the table here gives us a regression net for the diff-
 * highlight logic without spinning up jsdom.
 */

import type { RunDetail, RunEvent, UsageRow } from '@aldo-ai/api-contract';
import { describe, expect, it } from 'vitest';
import {
  type ComparisonColumn,
  buildComparisonTable,
  detectForkLineage,
  medianOf,
  parseCompareQuery,
  terminationReason,
} from './n-way-rows.js';

function ev(
  type: RunEvent['type'] | 'run.terminated_by',
  at: string,
  payload: unknown = {},
  id = `e-${Math.random().toString(36).slice(2, 8)}`,
): RunEvent {
  return { id, type: type as RunEvent['type'], at, payload };
}

function usage(
  provider: string,
  model: string,
  tokensIn: number,
  tokensOut: number,
  usd: number,
): UsageRow {
  return { provider, model, tokensIn, tokensOut, usd, at: '2026-05-03T10:00:00.000Z' };
}

function run(overrides: Partial<RunDetail> & { id: string }): RunDetail {
  return {
    id: overrides.id,
    agentName: overrides.agentName ?? 'demo-agent',
    agentVersion: overrides.agentVersion ?? '0.1.0',
    parentRunId: overrides.parentRunId ?? null,
    status: overrides.status ?? 'completed',
    startedAt: overrides.startedAt ?? '2026-05-03T10:00:00.000Z',
    endedAt: overrides.endedAt ?? '2026-05-03T10:00:05.000Z',
    durationMs: overrides.durationMs ?? 5_000,
    totalUsd: overrides.totalUsd ?? 0.001,
    lastProvider: overrides.lastProvider ?? 'openai',
    lastModel: overrides.lastModel ?? 'gpt-4o-mini',
    hasChildren: overrides.hasChildren,
    tags: overrides.tags,
    archivedAt: overrides.archivedAt,
    projectId: overrides.projectId,
    events: overrides.events ?? [
      ev('run.started', '2026-05-03T10:00:00.000Z'),
      ev('message', '2026-05-03T10:00:04.000Z', 'hello world'),
      ev('run.completed', '2026-05-03T10:00:05.000Z'),
    ],
    usage: overrides.usage ?? [usage('openai', 'gpt-4o-mini', 100, 50, 0.001)],
  };
}

function runColumn(r: RunDetail): ComparisonColumn {
  return { kind: 'run', id: r.id, run: r };
}

function notFoundColumn(id: string, reason = 'not authorized'): ComparisonColumn {
  return { kind: 'not-found', id, reason };
}

/* --------------------------------- median -------------------------------- */

describe('medianOf', () => {
  it('returns the single element on length-1 arrays', () => {
    expect(medianOf([5])).toBe(5);
  });
  it('returns the middle element on odd-length arrays', () => {
    expect(medianOf([3, 1, 2])).toBe(2);
  });
  it('averages the two middle elements on even-length arrays', () => {
    expect(medianOf([1, 2, 3, 4])).toBe(2.5);
  });
});

/* -------------------------- parseCompareQuery ---------------------------- */

describe('parseCompareQuery', () => {
  it('prefers `ids` over the legacy `a`/`b` pair', () => {
    expect(parseCompareQuery({ ids: 'r1,r2,r3', a: 'old-a', b: 'old-b' })).toEqual([
      'r1',
      'r2',
      'r3',
    ]);
  });
  it('falls back to `a` + `b` when `ids` is absent', () => {
    expect(parseCompareQuery({ a: 'r1', b: 'r2' })).toEqual(['r1', 'r2']);
  });
  it('handles a single id', () => {
    expect(parseCompareQuery({ ids: 'lonely' })).toEqual(['lonely']);
    expect(parseCompareQuery({ a: 'lonely' })).toEqual(['lonely']);
  });
  it('returns an empty list when nothing is present', () => {
    expect(parseCompareQuery({})).toEqual([]);
  });
  it('caps at MAX_RUNS=6 + dedupes', () => {
    expect(parseCompareQuery({ ids: 'a,b,b,c,d,e,f,g,h' })).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
  });
});

/* ------------------------- terminationReason ----------------------------- */

describe('terminationReason', () => {
  it('returns the payload reason when the event is present', () => {
    const reason = terminationReason([
      ev('run.terminated_by', '2026-05-03T10:00:04.500Z', {
        reason: 'maxTurns',
        detail: { turns: 10 },
      }),
    ]);
    expect(reason).toBe('maxTurns');
  });
  it('returns null when the event is absent', () => {
    expect(terminationReason([ev('run.completed', '2026-05-03T10:00:05.000Z')])).toBeNull();
  });
});

/* -------------------- diff highlighting (median deviation) --------------- */

describe('buildComparisonTable — diff highlighting', () => {
  it('tags the median cost as baseline and outliers as divergent', () => {
    const cols = [
      runColumn(run({ id: 'cheap', totalUsd: 0.001 })),
      runColumn(run({ id: 'mid', totalUsd: 0.005 })),
      runColumn(run({ id: 'expensive', totalUsd: 0.025 })),
    ];
    const { rows } = buildComparisonTable(cols);
    const cost = rows.find((r) => r.key === 'totalUsd');
    expect(cost).toBeDefined();
    if (!cost) return;
    expect(cost.cells[0]?.tag).toBe('divergent'); // 0.001 ≠ median(0.005)
    expect(cost.cells[1]?.tag).toBe('baseline'); // 0.005 == median
    expect(cost.cells[2]?.tag).toBe('divergent'); // 0.025 ≠ median
    expect(cost.cells[0]?.value).toBe('$0.0010'); // cheapest, no badge
    expect(cost.cells[1]?.value).toContain('+400% vs cheapest');
    expect(cost.cells[2]?.value).toContain('+2400% vs cheapest');
    expect(cost.hasDiff).toBe(true);
  });

  it('does not highlight rows where every value is identical', () => {
    const cols = [
      runColumn(run({ id: 'r1', totalUsd: 0.005 })),
      runColumn(run({ id: 'r2', totalUsd: 0.005 })),
      runColumn(run({ id: 'r3', totalUsd: 0.005 })),
    ];
    const { rows } = buildComparisonTable(cols);
    const cost = rows.find((r) => r.key === 'totalUsd');
    if (!cost) throw new Error('cost row missing');
    expect(cost.hasDiff).toBe(false);
    // every cell == median, so all baseline
    expect(cost.cells.every((c) => c.tag === 'baseline')).toBe(true);
  });

  it('uses the majority vote for the model row', () => {
    const cols = [
      runColumn(run({ id: 'r1', lastModel: 'gpt-4o' })),
      runColumn(run({ id: 'r2', lastModel: 'gpt-4o' })),
      runColumn(run({ id: 'r3', lastModel: 'claude-3-5-sonnet' })),
    ];
    const { rows } = buildComparisonTable(cols);
    const model = rows.find((r) => r.key === 'lastModel');
    if (!model) throw new Error('model row missing');
    expect(model.cells[0]?.tag).toBe('baseline');
    expect(model.cells[1]?.tag).toBe('baseline');
    expect(model.cells[2]?.tag).toBe('divergent');
    expect(model.hasDiff).toBe(true);
  });

  it('renders not-found columns gracefully', () => {
    const cols = [runColumn(run({ id: 'r1' })), notFoundColumn('missing-id', 'not authorized')];
    const { rows } = buildComparisonTable(cols);
    const status = rows.find((r) => r.key === 'status');
    if (!status) throw new Error('status row missing');
    expect(status.cells[1]?.value).toBe('not found');
    expect(status.cells[1]?.tag).toBe('none');
  });
});

/* ------------------------------- fork lineage ---------------------------- */

describe('detectForkLineage', () => {
  it('detects a single B-from-A fork', () => {
    const a = run({ id: 'A' });
    const b = run({ id: 'B', parentRunId: 'A' });
    const edges = detectForkLineage([runColumn(a), runColumn(b)]);
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({
      childId: 'B',
      parentId: 'A',
      childIndex: 1,
      parentIndex: 0,
    });
  });
  it('detects multi-fork chains in N-way sets', () => {
    const a = run({ id: 'A' });
    const b = run({ id: 'B', parentRunId: 'A' });
    const c = run({ id: 'C', parentRunId: 'B' });
    const edges = detectForkLineage([runColumn(a), runColumn(b), runColumn(c)]);
    expect(edges).toHaveLength(2);
  });
  it('ignores parents not in the comparison set', () => {
    const a = run({ id: 'A', parentRunId: 'something-else' });
    const edges = detectForkLineage([runColumn(a)]);
    expect(edges).toEqual([]);
  });
});

/* -------------------------- snapshot tests ------------------------------- */

describe('buildComparisonTable — snapshots', () => {
  // Snapshots are stripped to "tag + label + values" — deliberately
  // omitting the verbose `cells[].title`/event payloads so the
  // snapshot pins the user-visible output without churning on
  // cosmetic copy edits.
  function summarize(table: ReturnType<typeof buildComparisonTable>) {
    return {
      columnIds: table.columns.map((c) => c.id),
      rows: table.rows.map((r) => ({
        key: r.key,
        label: r.label,
        kind: r.kind,
        hasDiff: r.hasDiff,
        isMetric: r.isMetric,
        cells: r.cells.map((c) => ({ value: c.value, tag: c.tag })),
      })),
      stackBars: table.stackBars.map((p) => ({
        label: p.label,
        raw: p.raw,
      })),
    };
  }

  it('snapshot — 2 runs', () => {
    const table = buildComparisonTable([
      runColumn(
        run({
          id: 'snap-r1',
          totalUsd: 0.0021,
          durationMs: 4000,
          lastModel: 'gpt-4o',
          usage: [usage('openai', 'gpt-4o', 200, 100, 0.0021)],
          events: [
            ev('run.started', '2026-05-03T10:00:00.000Z'),
            ev('tool_call', '2026-05-03T10:00:01.000Z'),
            ev('tool_result', '2026-05-03T10:00:02.000Z'),
            ev('message', '2026-05-03T10:00:03.000Z', 'A says hi'),
            ev('run.completed', '2026-05-03T10:00:04.000Z'),
          ],
        }),
      ),
      runColumn(
        run({
          id: 'snap-r2',
          totalUsd: 0.0042,
          durationMs: 6000,
          lastModel: 'claude-3-5-sonnet',
          usage: [usage('anthropic', 'claude-3-5-sonnet', 200, 200, 0.0042)],
          events: [
            ev('run.started', '2026-05-03T10:00:00.000Z'),
            ev('message', '2026-05-03T10:00:05.000Z', 'B says hi'),
            ev('run.completed', '2026-05-03T10:00:06.000Z'),
          ],
        }),
      ),
    ]);
    expect(summarize(table)).toMatchSnapshot();
  });

  it('snapshot — 3 runs', () => {
    const table = buildComparisonTable([
      runColumn(run({ id: 'snap3-a', totalUsd: 0.001, durationMs: 3000 })),
      runColumn(run({ id: 'snap3-b', totalUsd: 0.005, durationMs: 5000 })),
      runColumn(run({ id: 'snap3-c', totalUsd: 0.01, durationMs: 8000 })),
    ]);
    expect(summarize(table)).toMatchSnapshot();
  });

  it('snapshot — 4 runs (one not-found)', () => {
    const table = buildComparisonTable([
      runColumn(run({ id: 'snap4-a', totalUsd: 0.001 })),
      runColumn(run({ id: 'snap4-b', totalUsd: 0.002 })),
      runColumn(run({ id: 'snap4-c', totalUsd: 0.003 })),
      notFoundColumn('snap4-missing', 'not found'),
    ]);
    expect(summarize(table)).toMatchSnapshot();
  });
});
