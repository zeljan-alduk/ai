/**
 * Wave-13 — pinned tests for the bulk-selection state machine.
 */

import { describe, expect, it } from 'vitest';
import {
  EMPTY_SELECTION,
  type ExportableRun,
  exportToCsv,
  exportToJson,
  modeForVisible,
  selectionReducer,
} from './bulk-selection';

const sampleRun = (overrides: Partial<ExportableRun> = {}): ExportableRun => ({
  id: overrides.id ?? 'run_1',
  agentName: overrides.agentName ?? 'reviewer',
  agentVersion: overrides.agentVersion ?? '1.0.0',
  status: overrides.status ?? 'completed',
  startedAt: overrides.startedAt ?? '2026-04-25T10:00:00.000Z',
  endedAt: overrides.endedAt ?? '2026-04-25T10:00:30.000Z',
  durationMs: overrides.durationMs ?? 30_000,
  totalUsd: overrides.totalUsd ?? 0.01,
  lastProvider: overrides.lastProvider ?? 'opaque-cloud',
  lastModel: overrides.lastModel ?? 'opaque-large',
  ...(overrides.tags !== undefined ? { tags: overrides.tags } : {}),
});

describe('selectionReducer', () => {
  it('toggle adds an unselected id and removes a selected one', () => {
    const a = selectionReducer(EMPTY_SELECTION, { type: 'toggle', id: 'r1' });
    expect([...a.selected]).toEqual(['r1']);
    const b = selectionReducer(a, { type: 'toggle', id: 'r1' });
    expect([...b.selected]).toEqual([]);
  });

  it('select / deselect are idempotent', () => {
    const once = selectionReducer(EMPTY_SELECTION, { type: 'select', id: 'r1' });
    const twice = selectionReducer(once, { type: 'select', id: 'r1' });
    expect(once).toBe(twice); // identity preserved on no-op

    const cleared = selectionReducer(twice, { type: 'deselect', id: 'r1' });
    expect([...cleared.selected]).toEqual([]);
    const clearedAgain = selectionReducer(cleared, { type: 'deselect', id: 'r1' });
    expect(cleared).toBe(clearedAgain);
  });

  it('select-all / deselect-all batch over a snapshot', () => {
    const after = selectionReducer(EMPTY_SELECTION, {
      type: 'select-all',
      ids: ['r1', 'r2', 'r3'],
    });
    expect(after.selected.size).toBe(3);
    const cleared = selectionReducer(after, {
      type: 'deselect-all',
      ids: ['r1', 'r2'],
    });
    expect([...cleared.selected]).toEqual(['r3']);
  });

  it('clear empties the selection', () => {
    const after = selectionReducer(EMPTY_SELECTION, {
      type: 'select-all',
      ids: ['r1', 'r2'],
    });
    const cleared = selectionReducer(after, { type: 'clear' });
    expect(cleared.selected.size).toBe(0);
  });
});

describe('modeForVisible', () => {
  it('returns none on an empty snapshot', () => {
    expect(modeForVisible(EMPTY_SELECTION, [])).toBe('none');
  });

  it('returns none when nothing in the snapshot is selected', () => {
    const sel = selectionReducer(EMPTY_SELECTION, { type: 'select', id: 'rA' });
    expect(modeForVisible(sel, ['rB', 'rC'])).toBe('none');
  });

  it('returns all when every visible row is selected', () => {
    const sel = selectionReducer(EMPTY_SELECTION, {
      type: 'select-all',
      ids: ['r1', 'r2'],
    });
    expect(modeForVisible(sel, ['r1', 'r2'])).toBe('all');
  });

  it('returns some otherwise', () => {
    const sel = selectionReducer(EMPTY_SELECTION, { type: 'select', id: 'r1' });
    expect(modeForVisible(sel, ['r1', 'r2'])).toBe('some');
  });
});

describe('exportToCsv', () => {
  it('emits a header + one data row, escaping quotes', () => {
    const csv = exportToCsv([
      sampleRun({
        id: 'run_a',
        agentName: 'rev,iewer', // intentional comma to exercise escaping
        tags: ['flaky', 'p1'],
      }),
    ]);
    const [header, row, trailing] = csv.split('\r\n');
    expect(header?.split(',')).toContain('agent_name');
    expect(row).toContain('"rev,iewer"');
    // tags pipe-joined
    expect(row).toContain('flaky|p1');
    // CSV ends with a trailing CRLF (so the last row has a line term).
    expect(trailing).toBe('');
  });
});

describe('exportToJson', () => {
  it('produces valid JSON with the run records', () => {
    const json = exportToJson([sampleRun({ id: 'run_a' })]);
    const parsed = JSON.parse(json) as ExportableRun[];
    expect(parsed[0]?.id).toBe('run_a');
  });
});
