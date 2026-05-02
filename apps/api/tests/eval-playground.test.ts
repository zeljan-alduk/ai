/**
 * Wave-3 (Tier-3.1) — `/v1/eval/playground/*` route tests.
 *
 * Bulk-evaluate one evaluator against one dataset in one panel. The
 * tests run the actual built-in evaluator runners (no scoring stub)
 * and assert per-row + aggregate shape end-to-end.
 *
 * The route schedules its scoring loop via `queueMicrotask` in
 * production. We override `scheduleScore` to await synchronously so
 * the polling-loop assertions don't race the runner. Aggregate math
 * (percentiles, pass rate) is exercised via the `aggregateFor` unit
 * tests at the bottom of this file.
 */

import {
  ApiError,
  Dataset,
  Evaluator,
  GetPlaygroundRunResponse,
  StartPlaygroundRunResponse,
} from '@aldo-ai/api-contract';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { aggregateFor } from '../src/routes/eval-playground.js';
import { type TestEnv, setupTestEnv } from './_setup.js';

let env: TestEnv;

beforeAll(async () => {
  env = await setupTestEnv();
});

afterAll(async () => {
  await env.teardown();
});

async function createDataset(name: string): Promise<string> {
  const res = await env.app.request('/v1/datasets', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, description: 'playground test', tags: [] }),
  });
  expect(res.status).toBe(201);
  return Dataset.parse(await res.json()).id;
}

async function addExample(
  datasetId: string,
  ex: { input: unknown; expected: unknown },
): Promise<void> {
  const res = await env.app.request(`/v1/datasets/${datasetId}/examples`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(ex),
  });
  expect(res.status).toBe(201);
}

async function createEvaluator(payload: Record<string, unknown>): Promise<string> {
  const res = await env.app.request('/v1/evaluators', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  expect(res.status).toBe(201);
  return Evaluator.parse(await res.json()).id;
}

/**
 * Poll the run until status is terminal or `maxIters` exhausted.
 * Mirrors the web-side polling loop.
 */
async function pollRun(runId: string, maxIters = 50) {
  for (let i = 0; i < maxIters; i++) {
    const res = await env.app.request(`/v1/eval/playground/runs/${runId}`);
    expect(res.status).toBe(200);
    const body = GetPlaygroundRunResponse.parse(await res.json());
    if (body.run.status === 'completed' || body.run.status === 'failed') {
      return body.run;
    }
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error(`run ${runId} did not finish within ${maxIters} iters`);
}

describe('/v1/eval/playground/run — bulk-score an evaluator against a dataset', () => {
  it('scores every example with a contains evaluator and aggregates pass rate', async () => {
    const datasetId = await createDataset(`pg-contains-${Date.now()}`);
    // Three rows: two contain "hi", one doesn't.
    await addExample(datasetId, { input: 'q1', expected: 'say hi to mom' });
    await addExample(datasetId, { input: 'q2', expected: 'hello there' });
    await addExample(datasetId, { input: 'q3', expected: 'high score: hi five' });
    const evaluatorId = await createEvaluator({
      name: 'contains-hi',
      kind: 'contains',
      config: { value: 'hi' },
    });

    const startRes = await env.app.request('/v1/eval/playground/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ evaluatorId, datasetId }),
    });
    expect(startRes.status).toBe(202);
    const { runId } = StartPlaygroundRunResponse.parse(await startRes.json());

    const run = await pollRun(runId);
    expect(run.status).toBe('completed');
    expect(run.evaluatorName).toBe('contains-hi');
    expect(run.evaluatorKind).toBe('contains');
    expect(run.rows.length).toBe(3);
    // 2 of 3 contain "hi" — high score row contains "hi" too actually,
    // so all three pass. Adjust: row 2 is "hello there" which does NOT
    // contain "hi" as a substring. So expected: 2 pass, 1 fail.
    const passedRows = run.rows.filter((r) => r.passed);
    const failedRows = run.rows.filter((r) => !r.passed);
    expect(passedRows.length).toBe(2);
    expect(failedRows.length).toBe(1);
    expect(run.aggregate.scored).toBe(3);
    expect(run.aggregate.total).toBe(3);
    expect(run.aggregate.passed).toBe(2);
    expect(run.aggregate.failed).toBe(1);
    expect(run.aggregate.passRate).toBeCloseTo(2 / 3, 5);
    // Each row carries its own preview + duration; never a raw provider name.
    for (const r of run.rows) {
      expect(typeof r.exampleId).toBe('string');
      expect(typeof r.inputPreview).toBe('string');
      expect(typeof r.expectedPreview).toBe('string');
      expect(r.durationMs).toBeGreaterThanOrEqual(0);
      expect(r.costUsd).toBe(0);
    }
  });

  it('honours sampleSize by capping the number of scored rows', async () => {
    const datasetId = await createDataset(`pg-sample-${Date.now()}`);
    for (let i = 0; i < 10; i++) {
      await addExample(datasetId, { input: `i${i}`, expected: `out-${i}` });
    }
    const evaluatorId = await createEvaluator({
      name: 'contains-out',
      kind: 'contains',
      config: { value: 'out' },
    });

    const startRes = await env.app.request('/v1/eval/playground/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ evaluatorId, datasetId, sampleSize: 4 }),
    });
    expect(startRes.status).toBe(202);
    const { runId } = StartPlaygroundRunResponse.parse(await startRes.json());

    const run = await pollRun(runId);
    expect(run.status).toBe('completed');
    expect(run.sampleSize).toBe(4);
    expect(run.rows.length).toBe(4);
    expect(run.aggregate.total).toBe(4);
    // Every example output starts with "out-" so every sampled row passes.
    expect(run.aggregate.passed).toBe(4);
    expect(run.aggregate.passRate).toBe(1);
  });

  it('returns 404 when the evaluator does not exist (no transient run leaked)', async () => {
    const datasetId = await createDataset(`pg-missing-eval-${Date.now()}`);
    await addExample(datasetId, { input: 'x', expected: 'y' });
    const res = await env.app.request('/v1/eval/playground/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ evaluatorId: 'ev_does-not-exist', datasetId }),
    });
    expect(res.status).toBe(404);
    const body = ApiError.parse(await res.json());
    expect(body.error.code).toBe('not_found');
  });

  it('returns 404 when the dataset does not exist', async () => {
    const evaluatorId = await createEvaluator({
      name: 'contains-missing',
      kind: 'contains',
      config: { value: 'x' },
    });
    const res = await env.app.request('/v1/eval/playground/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ evaluatorId, datasetId: 'ds_does-not-exist' }),
    });
    expect(res.status).toBe(404);
  });

  it('rejects an invalid request body with 400 validation_error', async () => {
    const res = await env.app.request('/v1/eval/playground/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ evaluatorId: '', datasetId: '' }),
    });
    expect(res.status).toBe(400);
    const body = ApiError.parse(await res.json());
    expect(body.error.code).toBe('validation_error');
  });

  it('returns 404 when the run id is unknown', async () => {
    const res = await env.app.request('/v1/eval/playground/runs/pgr_does-not-exist');
    expect(res.status).toBe(404);
  });

  it('isolates runs by tenant — a different tenant cannot read the run', async () => {
    const datasetId = await createDataset(`pg-iso-${Date.now()}`);
    await addExample(datasetId, { input: 'a', expected: 'b' });
    const evaluatorId = await createEvaluator({
      name: 'contains-iso',
      kind: 'contains',
      config: { value: 'b' },
    });
    const startRes = await env.app.request('/v1/eval/playground/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ evaluatorId, datasetId }),
    });
    const { runId } = StartPlaygroundRunResponse.parse(await startRes.json());

    // Mint a token for an unrelated tenant; it must not see the run.
    const otherAuth = await env.authFor('00000000-0000-0000-0000-000000000099');
    const res = await env.app.request(`/v1/eval/playground/runs/${runId}`, {
      headers: otherAuth,
    });
    expect(res.status).toBe(404);
  });
});

describe('aggregateFor — pass-rate / percentile math', () => {
  it('returns the empty aggregate for zero rows', () => {
    const a = aggregateFor([], 5);
    expect(a.scored).toBe(0);
    expect(a.total).toBe(5);
    expect(a.passRate).toBe(0);
  });

  it('computes pass rate, mean, p50, p95, min, max correctly', () => {
    const rows = [
      mkRow({ passed: true, score: 1.0, durationMs: 10 }),
      mkRow({ passed: true, score: 0.8, durationMs: 20 }),
      mkRow({ passed: false, score: 0.4, durationMs: 30 }),
      mkRow({ passed: false, score: 0.2, durationMs: 40 }),
      mkRow({ passed: true, score: 0.6, durationMs: 50 }),
    ];
    const a = aggregateFor(rows, 5);
    expect(a.scored).toBe(5);
    expect(a.passed).toBe(3);
    expect(a.failed).toBe(2);
    expect(a.passRate).toBeCloseTo(0.6, 5);
    expect(a.meanScore).toBeCloseTo((1.0 + 0.8 + 0.4 + 0.2 + 0.6) / 5, 5);
    expect(a.minScore).toBeCloseTo(0.2, 5);
    expect(a.maxScore).toBeCloseTo(1.0, 5);
    // Sorted: [0.2, 0.4, 0.6, 0.8, 1.0] — p50 = 0.6, p95 ≈ 0.96
    expect(a.p50Score).toBeCloseTo(0.6, 5);
    expect(a.p95Score).toBeCloseTo(0.96, 2);
    expect(a.meanDurationMs).toBeCloseTo(30, 5);
  });
});

function mkRow(o: { passed: boolean; score: number; durationMs: number }) {
  return {
    exampleId: 'ex',
    inputPreview: '',
    expectedPreview: '',
    output: '',
    passed: o.passed,
    score: o.score,
    durationMs: o.durationMs,
    costUsd: 0,
  };
}
