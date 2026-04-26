/**
 * Composite-diagram layout tests.
 *
 * Layout positions are pure functions of the strategy; pin them so a
 * regression in the renderer surfaces here, not visually.
 */

import type { CompositeWire } from '@aldo-ai/api-contract';
import { describe, expect, it } from 'vitest';
import { type NodePosition, computeLayout } from './composite-diagram';

const SUP = 'tech-lead';

function sub(agent: string, as?: string): CompositeWire['subagents'][number] {
  return as ? { agent, as } : { agent };
}

function findNode(
  nodes: ReadonlyArray<NodePosition>,
  predicate: (n: NodePosition) => boolean,
): NodePosition {
  const n = nodes.find(predicate);
  if (!n) throw new Error('expected to find a matching node');
  return n;
}

function nth<T>(arr: ReadonlyArray<T>, idx: number): T {
  const v = arr[idx];
  if (v === undefined) throw new Error(`expected element at index ${idx}`);
  return v;
}

describe('computeLayout — sequential', () => {
  it('places supervisor at x=0 and chains subagents horizontally', () => {
    const composite: CompositeWire = {
      strategy: 'sequential',
      subagents: [sub('a'), sub('b'), sub('c')],
    };
    const layout = computeLayout({ supervisorName: SUP, composite });
    expect(layout.nodes).toHaveLength(4); // supervisor + 3 subs
    const sup = findNode(layout.nodes, (n) => n.kind === 'supervisor');
    expect(sup.x).toBe(0);
    expect(sup.y).toBe(0);
    const subs = layout.nodes.filter((n) => n.kind === 'subagent');
    expect(nth(subs, 0).x).toBeLessThan(nth(subs, 1).x);
    expect(nth(subs, 1).x).toBeLessThan(nth(subs, 2).x);
    // Edges: sup -> a -> b -> c (3 edges).
    expect(layout.edges).toHaveLength(3);
    expect(nth(layout.edges, 0).from).toBe('__sup__');
    expect(nth(layout.edges, 2).to).toBe('sub-2');
  });
});

describe('computeLayout — parallel', () => {
  it('fans out to siblings in a column and adds a join node', () => {
    const composite: CompositeWire = {
      strategy: 'parallel',
      subagents: [sub('a'), sub('b'), sub('c')],
    };
    const layout = computeLayout({ supervisorName: SUP, composite });
    const sup = findNode(layout.nodes, (n) => n.kind === 'supervisor');
    const subs = layout.nodes.filter((n) => n.kind === 'subagent');
    const join = findNode(layout.nodes, (n) => n.kind === 'join');
    // siblings stack vertically at the same x.
    expect(new Set(subs.map((s) => s.x)).size).toBe(1);
    expect(nth(subs, 0).y).toBeLessThan(nth(subs, 1).y);
    expect(nth(subs, 1).y).toBeLessThan(nth(subs, 2).y);
    // join sits to the right of the siblings.
    expect(join.x).toBeGreaterThan(nth(subs, 0).x);
    expect(sup.x).toBeLessThan(nth(subs, 0).x);
    // Each sib has a fan-in edge to join, and a fan-out edge from sup.
    const supEdges = layout.edges.filter((e) => e.from === '__sup__');
    const joinEdges = layout.edges.filter((e) => e.to === '__join__');
    expect(supEdges).toHaveLength(3);
    expect(joinEdges).toHaveLength(3);
  });
});

describe('computeLayout — debate', () => {
  it('replaces the join with an aggregator node carrying its agent name', () => {
    const composite: CompositeWire = {
      strategy: 'debate',
      subagents: [sub('a'), sub('b')],
      aggregator: 'judge',
    };
    const layout = computeLayout({
      supervisorName: SUP,
      composite,
      knownAgents: new Set(['a', 'b', 'judge']),
    });
    const agg = findNode(layout.nodes, (n) => n.kind === 'aggregator');
    expect(agg.agentName).toBe('judge');
    expect(agg.missing).toBe(false);
    // Same fan-in shape as parallel.
    const aggIn = layout.edges.filter((e) => e.to === '__agg__');
    expect(aggIn).toHaveLength(2);
  });

  it('flags the aggregator as missing when it is not in the registry', () => {
    const composite: CompositeWire = {
      strategy: 'debate',
      subagents: [sub('a')],
      aggregator: 'ghost',
    };
    const layout = computeLayout({
      supervisorName: SUP,
      composite,
      knownAgents: new Set(['a']),
    });
    const agg = findNode(layout.nodes, (n) => n.kind === 'aggregator');
    expect(agg.missing).toBe(true);
  });
});

describe('computeLayout — iterative', () => {
  it('emits a self-loop edge with the maxRounds + terminate label', () => {
    const composite: CompositeWire = {
      strategy: 'iterative',
      subagents: [sub('refiner', 'r')],
      iteration: { maxRounds: 5, terminate: 'outputs.r.done' },
    };
    const layout = computeLayout({ supervisorName: SUP, composite });
    expect(layout.nodes).toHaveLength(2);
    const loop = layout.edges.find((e) => e.selfLoop);
    expect(loop).toBeDefined();
    expect(loop?.label).toContain('5');
    expect(loop?.label).toContain('outputs.r.done');
  });
});

describe('computeLayout — missing subagents', () => {
  it('flags subagents that are not in the registry', () => {
    const composite: CompositeWire = {
      strategy: 'sequential',
      subagents: [sub('exists'), sub('missing')],
    };
    const layout = computeLayout({
      supervisorName: SUP,
      composite,
      knownAgents: new Set(['exists']),
    });
    const subs = layout.nodes.filter((n) => n.kind === 'subagent');
    const exists = findNode(subs, (s) => s.agentName === 'exists');
    const missing = findNode(subs, (s) => s.agentName === 'missing');
    expect(exists.missing).toBe(false);
    expect(missing.missing).toBe(true);
  });
});
