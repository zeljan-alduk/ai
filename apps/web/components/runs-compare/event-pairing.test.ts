import type { RunEvent } from '@aldo-ai/api-contract';
import { describe, expect, it } from 'vitest';
import { pairEvents, pairedSpans } from './event-pairing.js';

const e = (id: string, type: RunEvent['type'], at: string): RunEvent => ({
  id,
  type,
  at,
  payload: {},
});

describe('pairEvents', () => {
  it('pairs by index when both arrays are equal length', () => {
    const a = [
      e('a1', 'run.started', '2026-04-26T10:00:00.000Z'),
      e('a2', 'message', '2026-04-26T10:00:01.000Z'),
    ];
    const b = [
      e('b1', 'run.started', '2026-04-26T11:00:00.000Z'),
      e('b2', 'message', '2026-04-26T11:00:01.000Z'),
    ];
    const pairs = pairEvents(a, b);
    expect(pairs).toHaveLength(2);
    expect(pairs[0]?.typesMatch).toBe(true);
    expect(pairs[1]?.typesMatch).toBe(true);
  });

  it('emits ghost rows where one side is shorter', () => {
    const a = [e('a1', 'run.started', '2026-04-26T10:00:00.000Z')];
    const b = [
      e('b1', 'run.started', '2026-04-26T11:00:00.000Z'),
      e('b2', 'message', '2026-04-26T11:00:01.000Z'),
      e('b3', 'run.completed', '2026-04-26T11:00:02.000Z'),
    ];
    const pairs = pairEvents(a, b);
    expect(pairs).toHaveLength(3);
    expect(pairs[0]?.a?.id).toBe('a1');
    expect(pairs[0]?.b?.id).toBe('b1');
    expect(pairs[1]?.a).toBeNull();
    expect(pairs[1]?.b?.id).toBe('b2');
    expect(pairs[2]?.a).toBeNull();
    expect(pairs[2]?.b?.id).toBe('b3');
    expect(pairs[1]?.typesMatch).toBe(false);
  });

  it('marks typesMatch=false when types differ at the same index', () => {
    const a = [e('a1', 'message', '2026-04-26T10:00:00.000Z')];
    const b = [e('b1', 'tool_call', '2026-04-26T11:00:00.000Z')];
    const pairs = pairEvents(a, b);
    expect(pairs[0]?.typesMatch).toBe(false);
  });
});

describe('pairedSpans', () => {
  it('normalises offsets against the longer of the two run spans', () => {
    const pairs = pairEvents(
      [
        e('a1', 'run.started', '2026-04-26T10:00:00.000Z'),
        e('a2', 'message', '2026-04-26T10:00:05.000Z'),
      ],
      [
        e('b1', 'run.started', '2026-04-26T11:00:00.000Z'),
        e('b2', 'message', '2026-04-26T11:00:10.000Z'),
      ],
    );
    const spans = pairedSpans(
      pairs,
      '2026-04-26T10:00:00.000Z',
      '2026-04-26T11:00:00.000Z',
      '2026-04-26T10:00:05.000Z',
      '2026-04-26T11:00:10.000Z',
    );
    // Run a is 5s, run b is 10s; totalMs is the larger.
    expect(spans[0]?.totalMs).toBe(10_000);
    // Event a2 is at 5s into run a.
    expect(spans[1]?.a?.startMs).toBe(5_000);
    // Event b2 is at 10s into run b.
    expect(spans[1]?.b?.startMs).toBe(10_000);
  });
});
