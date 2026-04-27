/**
 * Wave-14 — dashboards CRUD + widget-data aggregation tests.
 *
 * Coverage:
 *   - CRUD x6: create + list + read + patch + delete + cross-tenant isolation
 *   - Aggregation x6: timeseries-cost, pie-models, bar-agents, kpi-runs-24h,
 *     kpi-cost-mtd, heatmap layout
 */

import {
  Dashboard,
  type HeatmapData,
  type KpiData,
  ListDashboardsResponse,
  type PieData,
  type TimeseriesData,
} from '@aldo-ai/api-contract';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type TestEnv, seedRun, setupTestEnv } from './_setup.js';

const TENANT_OTHER = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';

let env: TestEnv;

beforeAll(async () => {
  env = await setupTestEnv();
});

afterAll(async () => {
  await env.teardown();
});

describe('Dashboards CRUD', () => {
  it('round-trips create + list + read + patch + delete', async () => {
    // Empty state — note default seed inserts none for the test tenant
    // (signup flow seeds; the test harness wires a synth membership
    // without going through signup).
    const before = await env.app.request('/v1/dashboards');
    expect(before.status).toBe(200);
    const beforeBody = ListDashboardsResponse.parse(await before.json());
    const baselineCount = beforeBody.dashboards.length;

    // Create
    const create = await env.app.request('/v1/dashboards', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'My Cost',
        description: 'Top spend agents',
        isShared: false,
        layout: [
          {
            id: 'kpi1',
            kind: 'kpi-cost-mtd',
            title: 'MTD',
            query: { period: '30d' },
            layout: { col: 0, row: 0, w: 4, h: 2 },
          },
        ],
      }),
    });
    expect(create.status).toBe(201);
    const createBody = Dashboard.parse(await create.json());
    expect(createBody.name).toBe('My Cost');
    expect(createBody.ownedByMe).toBe(true);
    expect(createBody.layout.length).toBe(1);

    // List shows it
    const list = await env.app.request('/v1/dashboards');
    const listBody = ListDashboardsResponse.parse(await list.json());
    expect(listBody.dashboards.length).toBe(baselineCount + 1);

    // Read by id
    const read = await env.app.request(`/v1/dashboards/${encodeURIComponent(createBody.id)}`);
    expect(read.status).toBe(200);
    expect(Dashboard.parse(await read.json()).id).toBe(createBody.id);

    // Patch (rename + flip share)
    const patch = await env.app.request(`/v1/dashboards/${encodeURIComponent(createBody.id)}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Cost', isShared: true }),
    });
    expect(patch.status).toBe(200);
    const patchBody = Dashboard.parse(await patch.json());
    expect(patchBody.name).toBe('Cost');
    expect(patchBody.isShared).toBe(true);

    // Delete
    const del = await env.app.request(`/v1/dashboards/${encodeURIComponent(createBody.id)}`, {
      method: 'DELETE',
    });
    expect(del.status).toBe(204);

    // Gone
    const gone = await env.app.request(`/v1/dashboards/${encodeURIComponent(createBody.id)}`);
    expect(gone.status).toBe(404);
  });

  it('rejects layout with overflow off the 12-col grid', async () => {
    const res = await env.app.request('/v1/dashboards', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'bad',
        layout: [
          {
            id: 'w1',
            kind: 'kpi-cost-mtd',
            title: 'MTD',
            query: { period: '30d' },
            layout: { col: 10, row: 0, w: 6, h: 2 }, // 10 + 6 = 16 > 12
          },
        ],
      }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects per-kind query that fails its schema', async () => {
    const res = await env.app.request('/v1/dashboards', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'bad',
        layout: [
          {
            id: 'w1',
            kind: 'bar-agents',
            title: 'top',
            query: { period: '7d', topN: 99999 }, // > 50 max
            layout: { col: 0, row: 0, w: 6, h: 2 },
          },
        ],
      }),
    });
    expect(res.status).toBe(400);
  });

  it('cross-tenant isolation — tenant B never sees tenant A dashboards', async () => {
    const aRes = await env.app.request('/v1/dashboards', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'A only', isShared: true, layout: [] }),
    });
    expect(aRes.status).toBe(201);
    const aBody = Dashboard.parse(await aRes.json());

    const otherAuth = await env.authFor(TENANT_OTHER);
    const bList = await env.app.request('/v1/dashboards', { headers: otherAuth });
    const bBody = ListDashboardsResponse.parse(await bList.json());
    expect(bBody.dashboards.find((d) => d.id === aBody.id)).toBeUndefined();

    // Read across tenants → 404.
    const bRead = await env.app.request(`/v1/dashboards/${encodeURIComponent(aBody.id)}`, {
      headers: otherAuth,
    });
    expect(bRead.status).toBe(404);
  });

  it('refuses 404 to unknown ids', async () => {
    const res = await env.app.request('/v1/dashboards/dash_does-not-exist');
    expect(res.status).toBe(404);
  });

  it('shared dashboard visible read-only to other tenant members', async () => {
    // Create a shared dashboard from the harness's default user, then
    // list it under a different user in the SAME tenant.
    const createRes = await env.app.request('/v1/dashboards', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Shared', isShared: true, layout: [] }),
    });
    const createBody = Dashboard.parse(await createRes.json());

    // Different user, same tenant.
    const peerAuth = await env.authFor(env.tenantId, { userId: 'peer-user' });
    const peerList = await env.app.request('/v1/dashboards', { headers: peerAuth });
    const peerBody = ListDashboardsResponse.parse(await peerList.json());
    const found = peerBody.dashboards.find((d) => d.id === createBody.id);
    expect(found).toBeDefined();
    expect(found?.ownedByMe).toBe(false);

    // Peer cannot edit (404 — visible but not mine).
    const peerPatch = await env.app.request(`/v1/dashboards/${encodeURIComponent(createBody.id)}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', ...peerAuth },
      body: JSON.stringify({ name: 'hijacked' }),
    });
    expect(peerPatch.status).toBe(404);
  });
});

describe('Dashboard widget-data aggregation', () => {
  it('timeseries-cost sums usd in window', async () => {
    const tenantId = `00000000-0000-0000-0000-${Math.floor(Math.random() * 1e12)
      .toString()
      .padStart(12, '0')}`;
    const auth = await env.authFor(tenantId);
    const now = new Date();
    await seedRun(env.db, {
      id: 'r1',
      agentName: 'a1',
      tenantId,
      startedAt: new Date(now.getTime() - 60 * 60 * 1000).toISOString(),
      endedAt: new Date(now.getTime() - 50 * 60 * 1000).toISOString(),
      usage: [
        {
          provider: 'p',
          model: 'm1',
          usd: 1.5,
          at: new Date(now.getTime() - 55 * 60 * 1000).toISOString(),
        },
      ],
    });

    const create = await env.app.request('/v1/dashboards', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...auth },
      body: JSON.stringify({
        name: 'X',
        layout: [
          {
            id: 'w1',
            kind: 'timeseries-cost',
            title: 'Cost',
            query: { period: '24h' },
            layout: { col: 0, row: 0, w: 6, h: 4 },
          },
        ],
      }),
    });
    expect(create.status).toBe(201);
    const dashId = Dashboard.parse(await create.json()).id;

    const data = await env.app.request(`/v1/dashboards/${encodeURIComponent(dashId)}/data`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...auth },
      body: JSON.stringify({}),
    });
    expect(data.status).toBe(200);
    const dataBody = (await data.json()) as { widgets: Record<string, TimeseriesData> };
    const sum = dataBody.widgets.w1?.points.reduce((s, p) => s + p.value, 0);
    expect(sum).toBeGreaterThan(1.4);
    expect(sum).toBeLessThan(1.6);
  });

  it('pie-models groups spend by model', async () => {
    const tenantId = `00000000-0000-0000-0000-${Math.floor(Math.random() * 1e12)
      .toString()
      .padStart(12, '0')}`;
    const auth = await env.authFor(tenantId);
    const now = new Date();
    const at = new Date(now.getTime() - 30 * 60 * 1000).toISOString();
    await seedRun(env.db, {
      id: 'r2',
      agentName: 'a2',
      tenantId,
      startedAt: at,
      endedAt: at,
      usage: [
        { provider: 'p', model: 'gpt', usd: 2, at },
        { provider: 'p', model: 'claude', usd: 3, at },
      ],
    });
    const create = await env.app.request('/v1/dashboards', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...auth },
      body: JSON.stringify({
        name: 'P',
        layout: [
          {
            id: 'pie',
            kind: 'pie-models',
            title: 'Models',
            query: { period: '24h' },
            layout: { col: 0, row: 0, w: 4, h: 4 },
          },
        ],
      }),
    });
    const dashId = Dashboard.parse(await create.json()).id;

    const data = await env.app.request(`/v1/dashboards/${encodeURIComponent(dashId)}/data`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...auth },
      body: JSON.stringify({}),
    });
    const body = (await data.json()) as { widgets: Record<string, PieData> };
    const slices = body.widgets.pie?.slices ?? [];
    expect(slices.find((s) => s.label === 'gpt')?.value).toBe(2);
    expect(slices.find((s) => s.label === 'claude')?.value).toBe(3);
  });

  it('bar-agents ranks by cost', async () => {
    const tenantId = `00000000-0000-0000-0000-${Math.floor(Math.random() * 1e12)
      .toString()
      .padStart(12, '0')}`;
    const auth = await env.authFor(tenantId);
    const at = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    await seedRun(env.db, {
      id: 'rA',
      agentName: 'big-spender',
      tenantId,
      startedAt: at,
      endedAt: at,
      usage: [{ provider: 'p', model: 'm', usd: 10, at }],
    });
    await seedRun(env.db, {
      id: 'rB',
      agentName: 'cheap',
      tenantId,
      startedAt: at,
      endedAt: at,
      usage: [{ provider: 'p', model: 'm', usd: 1, at }],
    });
    const create = await env.app.request('/v1/dashboards', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...auth },
      body: JSON.stringify({
        name: 'B',
        layout: [
          {
            id: 'bar',
            kind: 'bar-agents',
            title: 'Top',
            query: { period: '7d', metric: 'cost', topN: 5 },
            layout: { col: 0, row: 0, w: 6, h: 4 },
          },
        ],
      }),
    });
    const dashId = Dashboard.parse(await create.json()).id;
    const data = await env.app.request(`/v1/dashboards/${encodeURIComponent(dashId)}/data`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...auth },
      body: JSON.stringify({}),
    });
    const body = (await data.json()) as {
      widgets: Record<string, { rows: { label: string; value: number }[] }>;
    };
    expect(body.widgets.bar?.rows[0]?.label).toBe('big-spender');
    expect(body.widgets.bar?.rows[0]?.value).toBe(10);
  });

  it('kpi-runs-24h counts runs in last 24h', async () => {
    const tenantId = `00000000-0000-0000-0000-${Math.floor(Math.random() * 1e12)
      .toString()
      .padStart(12, '0')}`;
    const auth = await env.authFor(tenantId);
    const at = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    for (let i = 0; i < 3; i += 1) {
      await seedRun(env.db, {
        id: `kpi-r-${i}`,
        agentName: 'x',
        tenantId,
        startedAt: at,
      });
    }
    const create = await env.app.request('/v1/dashboards', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...auth },
      body: JSON.stringify({
        name: 'K',
        layout: [
          {
            id: 'kpi',
            kind: 'kpi-runs-24h',
            title: 'Runs',
            query: { period: '24h' },
            layout: { col: 0, row: 0, w: 4, h: 2 },
          },
        ],
      }),
    });
    const dashId = Dashboard.parse(await create.json()).id;
    const data = await env.app.request(`/v1/dashboards/${encodeURIComponent(dashId)}/data`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...auth },
      body: JSON.stringify({}),
    });
    const body = (await data.json()) as { widgets: Record<string, KpiData> };
    expect(body.widgets.kpi?.value).toBe(3);
  });

  it('kpi-cost-mtd sums spend month-to-date', async () => {
    const tenantId = `00000000-0000-0000-0000-${Math.floor(Math.random() * 1e12)
      .toString()
      .padStart(12, '0')}`;
    const auth = await env.authFor(tenantId);
    const at = new Date().toISOString();
    await seedRun(env.db, {
      id: 'mtd-r',
      agentName: 'x',
      tenantId,
      startedAt: at,
      endedAt: at,
      usage: [{ provider: 'p', model: 'm', usd: 7.25, at }],
    });
    const create = await env.app.request('/v1/dashboards', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...auth },
      body: JSON.stringify({
        name: 'M',
        layout: [
          {
            id: 'mtd',
            kind: 'kpi-cost-mtd',
            title: 'MTD',
            query: { period: '30d' },
            layout: { col: 0, row: 0, w: 4, h: 2 },
          },
        ],
      }),
    });
    const dashId = Dashboard.parse(await create.json()).id;
    const data = await env.app.request(`/v1/dashboards/${encodeURIComponent(dashId)}/data`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...auth },
      body: JSON.stringify({}),
    });
    const body = (await data.json()) as { widgets: Record<string, KpiData> };
    expect(body.widgets.mtd?.value).toBeCloseTo(7.25, 2);
  });

  it('heatmap-cost-by-hour returns cells over 24-hour x-axis', async () => {
    const tenantId = `00000000-0000-0000-0000-${Math.floor(Math.random() * 1e12)
      .toString()
      .padStart(12, '0')}`;
    const auth = await env.authFor(tenantId);
    const at = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    await seedRun(env.db, {
      id: 'h-r',
      agentName: 'x',
      tenantId,
      startedAt: at,
      endedAt: at,
      usage: [{ provider: 'p', model: 'mz', usd: 3, at }],
    });
    const create = await env.app.request('/v1/dashboards', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...auth },
      body: JSON.stringify({
        name: 'H',
        layout: [
          {
            id: 'h',
            kind: 'heatmap-cost-by-hour',
            title: 'Heat',
            query: {
              period: '7d',
              xAxis: 'hour-of-day',
              yAxis: 'model',
              metric: 'cost',
            },
            layout: { col: 0, row: 0, w: 6, h: 4 },
          },
        ],
      }),
    });
    const dashId = Dashboard.parse(await create.json()).id;
    const data = await env.app.request(`/v1/dashboards/${encodeURIComponent(dashId)}/data`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...auth },
      body: JSON.stringify({}),
    });
    const body = (await data.json()) as { widgets: Record<string, HeatmapData> };
    expect(body.widgets.h?.xLabels.length).toBe(24);
    expect(body.widgets.h?.yLabels.includes('mz')).toBe(true);
    const cell = body.widgets.h?.cells.find((c) => c.y === 'mz' && c.value > 0);
    expect(cell).toBeDefined();
  });
});
