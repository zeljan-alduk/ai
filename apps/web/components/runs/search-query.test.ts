/**
 * Wave-13 — pinned tests for the URL <-> RunSearchQuery serialiser.
 *
 * These tests are the contract: a saved view stored on the API
 * round-trips through the URL deterministically, and structurally
 * equal queries always stringify identically.
 */

import { describe, expect, it } from 'vitest';
import {
  isEmptyQuery,
  parseRunSearchQuery,
  serializeRunSearchQuery,
  toSavedViewQuery,
} from './search-query';

describe('parseRunSearchQuery', () => {
  it('returns an empty object for empty input', () => {
    expect(parseRunSearchQuery(new URLSearchParams())).toEqual({});
  });

  it('parses a single-token search', () => {
    const q = parseRunSearchQuery(new URLSearchParams('q=needle'));
    expect(q.q).toBe('needle');
  });

  it('parses comma-separated multi-value keys', () => {
    const q = parseRunSearchQuery(new URLSearchParams('status=running,failed'));
    expect(q.status).toEqual(['running', 'failed']);
  });

  it('parses repeated multi-value keys', () => {
    const params = new URLSearchParams();
    params.append('status', 'running');
    params.append('status', 'failed');
    const q = parseRunSearchQuery(params);
    expect(q.status).toEqual(['running', 'failed']);
  });

  it('drops empty multi-value tokens', () => {
    const q = parseRunSearchQuery(new URLSearchParams('agent=,reviewer,, '));
    expect(q.agent).toEqual(['reviewer']);
  });

  it('parses numeric ranges', () => {
    const q = parseRunSearchQuery(
      new URLSearchParams('cost_gte=0.01&cost_lte=2&duration_gte=100&duration_lte=5000'),
    );
    expect(q.cost_gte).toBe(0.01);
    expect(q.cost_lte).toBe(2);
    expect(q.duration_gte).toBe(100);
    expect(q.duration_lte).toBe(5000);
  });

  it('parses booleans as true/false/1/0', () => {
    const q = parseRunSearchQuery(
      new URLSearchParams('has_children=true&has_failed_event=0&include_archived=1'),
    );
    expect(q.has_children).toBe(true);
    expect(q.has_failed_event).toBe(false);
    expect(q.include_archived).toBe(true);
  });
});

describe('serializeRunSearchQuery', () => {
  it('emits a deterministic string for structurally equal queries', () => {
    const a = serializeRunSearchQuery({
      q: 'foo',
      status: ['failed', 'cancelled'],
      cost_gte: 0.5,
    }).toString();
    const b = serializeRunSearchQuery({
      q: 'foo',
      status: ['failed', 'cancelled'],
      cost_gte: 0.5,
    }).toString();
    expect(a).toBe(b);
  });

  it('round-trips parse → serialize → parse', () => {
    const url =
      'q=hello&status=running,failed&agent=reviewer&cost_gte=0.01&duration_lte=5000&has_children=true&view=v_123';
    const parsed = parseRunSearchQuery(new URLSearchParams(url));
    const serialized = serializeRunSearchQuery(parsed);
    const reparsed = parseRunSearchQuery(serialized);
    expect(reparsed).toEqual(parsed);
  });

  it('omits empty arrays + undefined fields', () => {
    const out = serializeRunSearchQuery({ status: [], q: '' }).toString();
    expect(out).toBe('');
  });
});

describe('toSavedViewQuery', () => {
  it('strips cursor + view from the saved payload', () => {
    const out = toSavedViewQuery({
      q: 'foo',
      status: ['running'],
      cursor: 'eyJhdCI6IjIwMjYifQ',
      view: 'v_abc',
    });
    expect(out).toEqual({ q: 'foo', status: ['running'] });
    expect((out as { cursor?: string }).cursor).toBeUndefined();
    expect((out as { view?: string }).view).toBeUndefined();
  });
});

describe('isEmptyQuery', () => {
  it('treats undefined-only payloads as empty', () => {
    expect(isEmptyQuery({})).toBe(true);
    expect(isEmptyQuery({ status: [] })).toBe(true);
    expect(isEmptyQuery({ q: '' })).toBe(true);
  });

  it('treats any active filter as non-empty', () => {
    expect(isEmptyQuery({ q: 'x' })).toBe(false);
    expect(isEmptyQuery({ status: ['running'] })).toBe(false);
    expect(isEmptyQuery({ has_children: true })).toBe(false);
  });

  it('view + cursor alone do NOT count as filters (they are surface state)', () => {
    expect(isEmptyQuery({ view: 'v_abc' })).toBe(true);
    expect(isEmptyQuery({ cursor: 'opaque' })).toBe(true);
  });
});
