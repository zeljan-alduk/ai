/**
 * Wave-16 — pure-logic tests for the failure-clusters tab.
 */

import { describe, expect, it } from 'vitest';
import {
  type ClusterLike,
  sortClusters,
  totalClusteredFailures,
  trimTopTerms,
  truncateSamples,
} from './clusters';

const CLUSTERS: ClusterLike[] = [
  {
    id: 'c1',
    label: 'invalid JSON',
    count: 5,
    examplesSample: [],
    topTerms: ['json', 'parse', 'syntax', 'unexpected', 'token'],
  },
  {
    id: 'c2',
    label: 'timeout',
    count: 9,
    examplesSample: [],
    topTerms: ['timeout', 'retry', 'connection'],
  },
  {
    id: 'c3',
    label: 'extra commas',
    count: 5,
    examplesSample: [],
    topTerms: undefined,
  },
];

describe('sortClusters', () => {
  it('orders by count desc and ties go to label asc', () => {
    const r = sortClusters(CLUSTERS);
    expect(r.map((c) => c.id)).toEqual(['c2', 'c3', 'c1']);
  });
  it('does not mutate the input', () => {
    const before = CLUSTERS.slice();
    sortClusters(CLUSTERS);
    expect(CLUSTERS).toEqual(before);
  });
});

describe('truncateSamples', () => {
  it('returns the original list when below the cap', () => {
    expect(truncateSamples([1, 2, 3], 5)).toEqual({ head: [1, 2, 3], hidden: 0 });
  });
  it('clips and reports the hidden count', () => {
    const r = truncateSamples([1, 2, 3, 4, 5, 6], 3);
    expect(r.head).toEqual([1, 2, 3]);
    expect(r.hidden).toBe(3);
  });
});

describe('trimTopTerms', () => {
  it('caps the term list', () => {
    expect(trimTopTerms(['a', 'b', 'c', 'd', 'e'], 3)).toEqual(['a', 'b', 'c']);
  });
});

describe('totalClusteredFailures', () => {
  it('sums cluster counts', () => {
    expect(totalClusteredFailures(CLUSTERS)).toBe(19);
  });
  it('returns 0 for an empty list', () => {
    expect(totalClusteredFailures([])).toBe(0);
  });
});
