import type { CheckpointId, RunId, TraceId } from '@aldo-ai/types';
import { describe, expect, it } from 'vitest';
import { InMemoryReplayStore, decodeBundle, encodeBundle, replay } from '../src/replay.js';

const runId = 'run_test_1' as RunId;
const traceId = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6' as TraceId;

describe('InMemoryReplayStore', () => {
  it('records checkpoints and exports a bundle', async () => {
    const store = new InMemoryReplayStore();
    store.bind(runId, traceId);
    store.record(runId, {
      id: 'cp_1' as CheckpointId,
      at: '2026-04-24T00:00:00Z',
      payload: { kind: 'message', role: 'user', text: 'hi' },
    });
    store.record(runId, {
      id: 'cp_2' as CheckpointId,
      at: '2026-04-24T00:00:01Z',
      payload: { kind: 'tool_call', name: 'search', args: { q: 'x' } },
    });

    const bundle = await store.export(runId);
    expect(bundle.runId).toBe(runId);
    expect(bundle.traceId).toBe(traceId);
    expect(bundle.checkpoints).toHaveLength(2);
    expect(bundle.checkpoints[0]?.id).toBe('cp_1');
    expect(bundle.checkpoints[1]?.id).toBe('cp_2');
  });

  it('returns an empty bundle for unknown run', async () => {
    const store = new InMemoryReplayStore();
    const bundle = await store.export('run_missing' as RunId);
    expect(bundle.checkpoints).toHaveLength(0);
  });

  it('clear removes a run', async () => {
    const store = new InMemoryReplayStore();
    store.record(runId, { id: 'cp' as CheckpointId, at: 'now', payload: {} });
    store.clear(runId);
    const bundle = await store.export(runId);
    expect(bundle.checkpoints).toHaveLength(0);
  });
});

describe('encodeBundle / decodeBundle round-trip', () => {
  it('preserves all fields through JSON', async () => {
    const store = new InMemoryReplayStore();
    store.bind(runId, traceId);
    store.record(runId, {
      id: 'cp_1' as CheckpointId,
      at: '2026-04-24T00:00:00Z',
      payload: { nested: { x: 1, y: [true, 'two', 3] } },
    });
    store.record(runId, {
      id: 'cp_2' as CheckpointId,
      at: '2026-04-24T00:00:01Z',
      payload: null,
    });

    const bundle = await store.export(runId);
    const encoded = encodeBundle(bundle);
    const decoded = decodeBundle(encoded);

    expect(decoded.runId).toBe(bundle.runId);
    expect(decoded.traceId).toBe(bundle.traceId);
    expect(decoded.checkpoints).toHaveLength(2);
    expect(decoded.checkpoints[0]?.payload).toEqual({
      nested: { x: 1, y: [true, 'two', 3] },
    });
    expect(decoded.checkpoints[1]?.payload).toBeNull();
  });

  it('rejects unsupported versions', () => {
    const bad = JSON.stringify({ version: 999, runId: 'x', traceId: 'y', checkpoints: [] });
    expect(() => decodeBundle(bad)).toThrow(/unsupported version/);
  });

  it('rejects malformed input', () => {
    expect(() => decodeBundle('null')).toThrow();
    expect(() => decodeBundle('{}')).toThrow();
  });
});

describe('replay module-level handle', () => {
  it('record/bind/export use the shared store', async () => {
    const runId2 = 'run_global_1' as RunId;
    replay.bind(runId2, traceId);
    replay.record(runId2, {
      id: 'cp_g1' as CheckpointId,
      at: '2026-04-24T00:00:00Z',
      payload: { ok: true },
    });
    const bundle = await replay.export(runId2);
    expect(bundle.checkpoints).toHaveLength(1);
    expect(bundle.checkpoints[0]?.id).toBe('cp_g1');
    replay.clear(runId2);
  });

  it('createStore returns an isolated instance', async () => {
    const a = replay.createStore();
    const b = replay.createStore();
    const rid = 'run_iso' as RunId;
    a.record(rid, { id: 'cp' as CheckpointId, at: 't', payload: 1 });
    const ba = await a.export(rid);
    const bb = await b.export(rid);
    expect(ba.checkpoints).toHaveLength(1);
    expect(bb.checkpoints).toHaveLength(0);
  });
});
