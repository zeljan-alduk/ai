import { describe, expect, it } from 'vitest';
import type { RunTreeNode } from '../src/api/client.js';
import { flattenTree, renderTraceHtml } from '../src/webview/trace.js';

const sample: RunTreeNode = {
  id: 'run_root',
  agentName: 'planner',
  status: 'succeeded',
  startedAt: '2026-04-26T10:00:00Z',
  durationMs: 100,
  children: [
    {
      id: 'run_child1',
      agentName: 'reviewer',
      status: 'succeeded',
      startedAt: '2026-04-26T10:00:00.020Z',
      durationMs: 50,
      children: [],
    },
    {
      id: 'run_child2',
      agentName: 'critic',
      status: 'failed',
      startedAt: '2026-04-26T10:00:00.080Z',
      durationMs: 15,
      children: [],
    },
  ],
};

describe('flattenTree', () => {
  it('produces one row per node with correct depth', () => {
    const rows = flattenTree(sample);
    expect(rows).toHaveLength(3);
    expect(rows[0]?.depth).toBe(0);
    expect(rows[1]?.depth).toBe(1);
    expect(rows[2]?.depth).toBe(1);
  });

  it('computes startMs relative to the root', () => {
    const rows = flattenTree(sample);
    expect(rows[0]?.startMs).toBe(0);
    expect(rows[1]?.startMs).toBe(20);
    expect(rows[2]?.startMs).toBe(80);
  });
});

describe('renderTraceHtml', () => {
  it('embeds the run id and a CSP header', () => {
    const html = renderTraceHtml('run_xyz', sample);
    expect(html).toContain('run_xyz');
    expect(html).toContain('Content-Security-Policy');
    expect(html).toContain('<svg');
  });

  it('renders one row group per span', () => {
    const html = renderTraceHtml('run_xyz', sample);
    const rowMatches = html.match(/class="row"/g) ?? [];
    expect(rowMatches.length).toBe(3);
  });
});
