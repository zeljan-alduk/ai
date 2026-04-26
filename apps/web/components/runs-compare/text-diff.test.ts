import { describe, expect, it } from 'vitest';
import { computeTextDiff, eventsToText } from './text-diff.js';

describe('computeTextDiff', () => {
  it('returns one unchanged segment when both sides are identical', () => {
    const segs = computeTextDiff('hello world', 'hello world');
    expect(segs.length).toBe(1);
    expect(segs[0]?.kind).toBe('unchanged');
  });

  it('emits added + removed segments when strings diverge', () => {
    const segs = computeTextDiff('the quick brown fox', 'the slow brown fox');
    const kinds = segs.map((s) => s.kind);
    expect(kinds).toContain('added');
    expect(kinds).toContain('removed');
    expect(segs.some((s) => s.kind === 'unchanged' && s.value.includes('brown'))).toBe(true);
  });
});

describe('eventsToText', () => {
  it('serialises events into a stable [type] payload-json blob', () => {
    const text = eventsToText([
      { type: 'run.started', payload: { foo: 1 } },
      { type: 'message', payload: 'hi' },
    ]);
    expect(text).toContain('[run.started]');
    expect(text).toContain('"foo":1');
    expect(text).toContain('[message] hi');
  });

  it('handles null and undefined payloads cleanly', () => {
    const text = eventsToText([
      { type: 'checkpoint', payload: null },
      { type: 'run.completed', payload: undefined },
    ]);
    expect(text).toBe('[checkpoint]\n[run.completed]');
  });
});
