import type { PlaygroundFrame } from '@aldo-ai/api-contract';
import { describe, expect, it } from 'vitest';
import { allTerminal, applyFrame, emptyColumns, totalUsd } from './playground-state.js';

const frame = (
  modelId: string,
  type: PlaygroundFrame['type'],
  payload: unknown,
): PlaygroundFrame => ({
  modelId,
  type,
  payload,
});

describe('applyFrame', () => {
  it('start -> streaming column with provider + locality stamped', () => {
    const next = applyFrame(
      emptyColumns(),
      frame('m1', 'start', {
        modelId: 'm1',
        provider: 'opaque-cloud',
        locality: 'cloud',
        capabilityClass: 'reasoning-medium',
      }),
    );
    const col = next.get('m1');
    expect(col?.status).toBe('streaming');
    expect(col?.provider).toBe('opaque-cloud');
    expect(col?.locality).toBe('cloud');
    expect(col?.capabilityClass).toBe('reasoning-medium');
  });

  it('delta -> appends text without overwriting prior chunks', () => {
    let cols = emptyColumns();
    cols = applyFrame(
      cols,
      frame('m1', 'start', {
        modelId: 'm1',
        provider: 'p',
        locality: 'cloud',
        capabilityClass: 'c',
      }),
    );
    cols = applyFrame(cols, frame('m1', 'delta', { text: 'Hello, ' }));
    cols = applyFrame(cols, frame('m1', 'delta', { text: 'world' }));
    expect(cols.get('m1')?.text).toBe('Hello, world');
    expect(cols.get('m1')?.status).toBe('streaming');
  });

  it('usage -> stamps token + cost numbers, leaves status alone', () => {
    let cols = emptyColumns();
    cols = applyFrame(cols, frame('m1', 'start', {}));
    cols = applyFrame(
      cols,
      frame('m1', 'usage', {
        tokensIn: 12,
        tokensOut: 34,
        usd: 0.0042,
        latencyMs: 1200,
      }),
    );
    const col = cols.get('m1');
    expect(col?.tokensIn).toBe(12);
    expect(col?.tokensOut).toBe(34);
    expect(col?.usd).toBeCloseTo(0.0042, 6);
    expect(col?.latencyMs).toBe(1200);
  });

  it('done -> column.status = done', () => {
    let cols = emptyColumns();
    cols = applyFrame(cols, frame('m1', 'start', {}));
    cols = applyFrame(cols, frame('m1', 'done', {}));
    expect(cols.get('m1')?.status).toBe('done');
  });

  it('error -> column.status = error and error is set', () => {
    let cols = emptyColumns();
    cols = applyFrame(cols, frame('m1', 'error', { code: 'stream_failed', message: 'oops' }));
    const col = cols.get('m1');
    expect(col?.status).toBe('error');
    expect(col?.error).toBe('oops');
  });
});

describe('totalUsd + allTerminal', () => {
  it('totalUsd sums across columns', () => {
    let cols = emptyColumns();
    cols = applyFrame(
      cols,
      frame('a', 'usage', { tokensIn: 0, tokensOut: 0, usd: 0.01, latencyMs: 0 }),
    );
    cols = applyFrame(
      cols,
      frame('b', 'usage', { tokensIn: 0, tokensOut: 0, usd: 0.02, latencyMs: 0 }),
    );
    expect(totalUsd(cols)).toBeCloseTo(0.03, 6);
  });

  it('allTerminal flips to true once every column is done or error', () => {
    let cols = emptyColumns();
    cols = applyFrame(cols, frame('a', 'start', {}));
    cols = applyFrame(cols, frame('b', 'start', {}));
    expect(allTerminal(cols)).toBe(false);
    cols = applyFrame(cols, frame('a', 'done', {}));
    expect(allTerminal(cols)).toBe(false);
    cols = applyFrame(cols, frame('b', 'error', { code: 'x', message: 'y' }));
    expect(allTerminal(cols)).toBe(true);
  });
});
