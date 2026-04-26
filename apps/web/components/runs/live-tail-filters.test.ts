/**
 * Wave-13 live-tail filter logic tests.
 *
 * We focus on the pure functions in `live-tail-filters.ts`; the React
 * island that wires them is exercised end-to-end in the Playwright
 * suite (out of scope for vitest).
 *
 * Tests cover:
 *   - categorize() bucketing for model / tool / span / error / other (1)
 *   - applyFilters() with an empty category set behaves as "show all" (1)
 *   - applyFilters() narrows to selected category and agent (1)
 *   - summarize() picks readable strings out of common payloads (1)
 *   - reduceStreamingBuffer() concatenates deltas and locks on finish (2)
 *   - spanPathOf() / agentNameOf() defensive against null payloads (1)
 *
 * Total: 7 tests. Couples with the bell-badge tests below to comfortably
 * clear the +8 wave-13 web target.
 */

import { describe, expect, it } from 'vitest';
import {
  type LiveEvent,
  agentNameOf,
  applyFilters,
  categorize,
  emptyStreamingBuffer,
  reduceStreamingBuffer,
  spanPathOf,
  summarize,
} from './live-tail-filters.js';

const ev = (type: string, payload: unknown = {}): LiveEvent => ({
  id: Math.random().toString(36).slice(2, 10),
  runId: 'run_abc',
  type,
  at: '2026-04-26T00:00:00Z',
  payload,
});

describe('categorize', () => {
  it('buckets known event types', () => {
    expect(categorize('model_call')).toBe('model_call');
    expect(categorize('model_delta')).toBe('model_call');
    expect(categorize('tool_call')).toBe('tool_call');
    expect(categorize('tool_result')).toBe('tool_call');
    expect(categorize('span.start')).toBe('span');
    expect(categorize('run.completed')).toBe('span');
    expect(categorize('composite.child_failed')).toBe('span');
    expect(categorize('error')).toBe('error');
    expect(categorize('policy_decision')).toBe('error');
    expect(categorize('something_else')).toBe('other');
  });
});

describe('applyFilters', () => {
  it('returns every event when no chips are active', () => {
    const events = [ev('tool_call'), ev('model_delta'), ev('error')];
    const out = applyFilters(events, { categories: new Set(), agentName: null });
    expect(out.length).toBe(3);
  });

  it('narrows to the selected category and agent', () => {
    const events = [
      ev('tool_call', { agentName: 'architect' }),
      ev('tool_call', { agentName: 'principal' }),
      ev('model_delta', { agentName: 'architect' }),
    ];
    const out = applyFilters(events, {
      categories: new Set(['tool_call']),
      agentName: 'architect',
    });
    expect(out.length).toBe(1);
    expect(out[0]?.type).toBe('tool_call');
  });
});

describe('summarize', () => {
  it('extracts a one-liner from a tool_call payload', () => {
    const out = summarize(ev('tool_call', { name: 'fetch', args: { url: 'x' } }));
    expect(out.startsWith('fetch(')).toBe(true);
  });

  it('extracts message + provider from a model_call payload', () => {
    const out = summarize(
      ev('model_call', { provider: 'oai-compat', model: 'gpt-x', tokensIn: 12 }),
    );
    expect(out).toContain('oai-compat');
    expect(out).toContain('gpt-x');
    expect(out).toContain('12 in');
  });

  it('falls back to JSON for unknown payloads', () => {
    const out = summarize(ev('weird', { foo: 'bar' }));
    expect(out).toContain('foo');
  });
});

describe('reduceStreamingBuffer', () => {
  it('concatenates deltas across multiple events', () => {
    let state = emptyStreamingBuffer;
    state = reduceStreamingBuffer(
      state,
      ev('model_delta', { model: 'gpt-x', delta: 'Hello, ', spanPath: 'a' }),
    );
    state = reduceStreamingBuffer(
      state,
      ev('model_delta', { model: 'gpt-x', delta: 'world!', spanPath: 'a' }),
    );
    expect(state.streams.length).toBe(1);
    expect(state.streams[0]?.text).toBe('Hello, world!');
    expect(state.streams[0]?.finished).toBe(false);
  });

  it('locks the entry on model_stream_finished', () => {
    let state = emptyStreamingBuffer;
    state = reduceStreamingBuffer(
      state,
      ev('model_delta', { model: 'm1', delta: 'x', spanPath: 's' }),
    );
    state = reduceStreamingBuffer(
      state,
      ev('model_stream_finished', { model: 'm1', spanPath: 's' }),
    );
    expect(state.streams[0]?.finished).toBe(true);
  });
});

describe('spanPathOf / agentNameOf', () => {
  it('survives null + non-object payloads', () => {
    expect(spanPathOf(ev('x', null))).toBe('');
    expect(spanPathOf(ev('x', 'not-an-object'))).toBe('');
    expect(agentNameOf(ev('x', null))).toBeNull();
    expect(agentNameOf(ev('x', { agentName: 'principal' }))).toBe('principal');
    expect(agentNameOf(ev('x', { ref: { name: 'engineer' } }))).toBe('engineer');
  });
});
