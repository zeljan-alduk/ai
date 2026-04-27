/**
 * Sparkline render tests — confirm the empty fallback and the dot
 * count cap (max 10).
 */

import type { RunStatus } from '@aldo-ai/api-contract';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { RunStatusSparkline } from './run-status-sparkline';

function html(statuses: RunStatus[]): string {
  return renderToStaticMarkup(<RunStatusSparkline statuses={statuses} />);
}

describe('RunStatusSparkline', () => {
  it('renders the empty marker for an empty array', () => {
    const out = html([]);
    expect(out).toContain('—');
  });

  it('renders one circle per status, up to ten', () => {
    const all: RunStatus[] = ['completed', 'failed', 'running', 'queued', 'cancelled'];
    const out = html(all);
    const matches = out.match(/<circle/g);
    expect(matches?.length).toBe(5);
  });

  it('caps at 10 dots even when more are passed', () => {
    const long: RunStatus[] = Array.from({ length: 25 }, (_, i) =>
      i % 2 === 0 ? 'completed' : 'failed',
    );
    const out = html(long);
    const matches = out.match(/<circle/g);
    expect(matches?.length).toBe(10);
  });

  it('keeps the last 10 (caller passes oldest-first)', () => {
    // Build a sequence where only the last 10 are emerald.
    const long: RunStatus[] = [
      ...Array.from({ length: 5 }, () => 'failed' as RunStatus),
      ...Array.from({ length: 10 }, () => 'completed' as RunStatus),
    ];
    const out = html(long);
    // Failed is red (#ef4444); we should see ZERO of them when capped to 10.
    expect(out).not.toContain('#ef4444');
    // Completed is emerald (#10b981); we should see 10.
    const greens = out.match(/#10b981/g);
    expect(greens?.length).toBe(10);
  });
});
