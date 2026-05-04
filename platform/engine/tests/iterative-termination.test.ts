/**
 * MISSING_PIECES §9 / Phase B — unit tests for the pure termination
 * matchers. These are independent of the IterativeAgentRun loop —
 * the matchers only DECIDE; the loop emits and short-circuits.
 *
 * Coverage:
 *   - text-includes (positive, negative, empty text)
 *   - tool-result with exit_code only / contains only / both (AND)
 *   - tool-result with name mismatch
 *   - budget-exhausted (under cap, equal, over)
 *   - first-match wins when multiple conditions could fire
 */

import type { IterationTerminationCondition, ToolResultPart, UsageRecord } from '@aldo-ai/types';
import { describe, expect, it } from 'vitest';
import {
  type CycleOutcome,
  firstMatchingTermination,
} from '../src/iterative-termination.js';

const usage = (usd = 0): UsageRecord => ({
  provider: 'mock',
  model: 'm',
  tokensIn: 1,
  tokensOut: 1,
  usd,
  at: '2026-05-04T00:00:00Z',
});

const cycle = (over: Partial<CycleOutcome> = {}): CycleOutcome => ({
  text: '',
  toolResults: [],
  usage: usage(0),
  ...over,
});

const ctx = (cumulativeUsd: number, budgetUsdMax: number) => ({
  cumulativeUsd,
  budgetUsdMax,
});

describe('firstMatchingTermination — text-includes', () => {
  const conds: IterationTerminationCondition[] = [{ kind: 'text-includes', text: 'DONE' }];

  it('fires when the exact substring is present', () => {
    const d = firstMatchingTermination(conds, cycle({ text: 'OK DONE' }), ctx(0, 1));
    expect(d?.reason).toBe('text-includes');
    expect(d?.detail).toEqual({ trigger: 'DONE' });
  });

  it('does not fire on substring mismatch', () => {
    const d = firstMatchingTermination(conds, cycle({ text: 'incomplete' }), ctx(0, 1));
    expect(d).toBeNull();
  });

  it('does not fire on empty cycle text', () => {
    const d = firstMatchingTermination(conds, cycle({ text: '' }), ctx(0, 1));
    expect(d).toBeNull();
  });

  it('is case-sensitive', () => {
    const d = firstMatchingTermination(conds, cycle({ text: 'done' }), ctx(0, 1));
    expect(d).toBeNull();
  });
});

describe('firstMatchingTermination — tool-result', () => {
  const mkResult = (
    over: Partial<ToolResultPart & { tool?: string }>,
  ): ToolResultPart => {
    const base: ToolResultPart & { tool?: string } = {
      type: 'tool_result',
      callId: 'c1',
      result: {},
      ...over,
    };
    return base as ToolResultPart;
  };

  it('fires when tool name + exitCode both match', () => {
    const conds: IterationTerminationCondition[] = [
      { kind: 'tool-result', tool: 'shell.exec', match: { exitCode: 0 } },
    ];
    const d = firstMatchingTermination(
      conds,
      cycle({
        toolResults: [
          mkResult({ tool: 'shell.exec', result: { exitCode: 0, stdout: 'OK' } }),
        ],
      }),
      ctx(0, 1),
    );
    expect(d?.reason).toBe('tool-result');
  });

  it('does NOT fire when tool name mismatches', () => {
    const conds: IterationTerminationCondition[] = [
      { kind: 'tool-result', tool: 'shell.exec', match: { exitCode: 0 } },
    ];
    const d = firstMatchingTermination(
      conds,
      cycle({
        toolResults: [mkResult({ tool: 'fs.read', result: { exitCode: 0 } })],
      }),
      ctx(0, 1),
    );
    expect(d).toBeNull();
  });

  it('does NOT fire when exitCode mismatches', () => {
    const conds: IterationTerminationCondition[] = [
      { kind: 'tool-result', tool: 'shell.exec', match: { exitCode: 0 } },
    ];
    const d = firstMatchingTermination(
      conds,
      cycle({
        toolResults: [mkResult({ tool: 'shell.exec', result: { exitCode: 1 } })],
      }),
      ctx(0, 1),
    );
    expect(d).toBeNull();
  });

  it('contains-only match against stringified payload', () => {
    const conds: IterationTerminationCondition[] = [
      { kind: 'tool-result', tool: 'shell.exec', match: { contains: 'typecheck OK' } },
    ];
    const d = firstMatchingTermination(
      conds,
      cycle({
        toolResults: [
          mkResult({ tool: 'shell.exec', result: { exitCode: 0, stdout: 'typecheck OK\n' } }),
        ],
      }),
      ctx(0, 1),
    );
    expect(d?.reason).toBe('tool-result');
  });

  it('exitCode + contains AND both must match', () => {
    const conds: IterationTerminationCondition[] = [
      {
        kind: 'tool-result',
        tool: 'shell.exec',
        match: { exitCode: 0, contains: 'OK' },
      },
    ];
    const dGood = firstMatchingTermination(
      conds,
      cycle({
        toolResults: [
          mkResult({ tool: 'shell.exec', result: { exitCode: 0, stdout: 'OK' } }),
        ],
      }),
      ctx(0, 1),
    );
    expect(dGood?.reason).toBe('tool-result');

    const dExitOnly = firstMatchingTermination(
      conds,
      cycle({
        toolResults: [
          mkResult({ tool: 'shell.exec', result: { exitCode: 0, stdout: 'fail' } }),
        ],
      }),
      ctx(0, 1),
    );
    expect(dExitOnly).toBeNull();

    const dContainsOnly = firstMatchingTermination(
      conds,
      cycle({
        toolResults: [
          mkResult({ tool: 'shell.exec', result: { exitCode: 1, stdout: 'OK' } }),
        ],
      }),
      ctx(0, 1),
    );
    expect(dContainsOnly).toBeNull();
  });

  it('walks every result in the cycle until one matches', () => {
    const conds: IterationTerminationCondition[] = [
      { kind: 'tool-result', tool: 'shell.exec', match: { exitCode: 0 } },
    ];
    const d = firstMatchingTermination(
      conds,
      cycle({
        toolResults: [
          mkResult({ callId: 'a', tool: 'shell.exec', result: { exitCode: 1 } }),
          mkResult({ callId: 'b', tool: 'shell.exec', result: { exitCode: 0 } }),
        ],
      }),
      ctx(0, 1),
    );
    expect(d?.reason).toBe('tool-result');
    expect(d?.detail['callId']).toBe('b');
  });
});

describe('firstMatchingTermination — budget-exhausted', () => {
  const conds: IterationTerminationCondition[] = [{ kind: 'budget-exhausted' }];

  it('fires when cumulative USD reaches the cap', () => {
    const d = firstMatchingTermination(conds, cycle(), ctx(1.0, 1.0));
    expect(d?.reason).toBe('budget-exhausted');
  });

  it('fires when cumulative USD exceeds the cap', () => {
    const d = firstMatchingTermination(conds, cycle(), ctx(1.5, 1.0));
    expect(d?.reason).toBe('budget-exhausted');
    expect(d?.detail).toEqual({ usd: 1.5, cap: 1.0 });
  });

  it('does not fire when cumulative USD is below the cap', () => {
    const d = firstMatchingTermination(conds, cycle(), ctx(0.5, 1.0));
    expect(d).toBeNull();
  });

  it('does not fire when budgetUsdMax is 0 (uncapped sentinel)', () => {
    const d = firstMatchingTermination(conds, cycle(), ctx(99, 0));
    expect(d).toBeNull();
  });
});

describe('firstMatchingTermination — first match wins', () => {
  it('returns the FIRST condition in spec order even when later ones would also match', () => {
    const conds: IterationTerminationCondition[] = [
      { kind: 'budget-exhausted' },
      { kind: 'text-includes', text: 'DONE' },
    ];
    const d = firstMatchingTermination(
      conds,
      cycle({ text: 'all DONE' }),
      ctx(2.0, 1.0), // budget would also fire
    );
    expect(d?.reason).toBe('budget-exhausted');
  });
});
