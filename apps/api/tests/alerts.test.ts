/**
 * Wave-14 — alert rules CRUD + evaluation + silence + slack channel.
 *
 * Coverage:
 *   - 6 evaluation tests (cost_spike pos/neg, error_rate, latency_p95,
 *     guards_blocked, eval-via-test endpoint, debounce/skip).
 *   - 1 silence test.
 *   - 1 slack-webhook validation test (rejects non-Slack URLs).
 */

import { AlertRule, ListAlertRulesResponse, TestAlertResponse } from '@aldo-ai/api-contract';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { comparatorMatches, shouldSkipForTick } from '../src/dashboards/alert-eval.js';
import { isSlackWebhookUrl } from '../src/dashboards/notify-channels.js';
import { runAlertsTick } from '../src/routes/alerts.js';
import { type TestEnv, seedRun, setupTestEnv } from './_setup.js';

let env: TestEnv;

beforeAll(async () => {
  env = await setupTestEnv();
});

afterAll(async () => {
  await env.teardown();
});

async function freshTenant(): Promise<{ tenantId: string; auth: { Authorization: string } }> {
  const tenantId = `00000000-0000-0000-0000-${Math.floor(Math.random() * 1e12)
    .toString()
    .padStart(12, '0')}`;
  const auth = await env.authFor(tenantId);
  return { tenantId, auth };
}

describe('Alert rules — CRUD', () => {
  it('creates + lists + reads + patches + deletes', async () => {
    const { auth } = await freshTenant();
    const create = await env.app.request('/v1/alerts', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...auth },
      body: JSON.stringify({
        name: 'Spend > $50/day',
        kind: 'cost_spike',
        threshold: { value: 50, comparator: 'gt', period: '24h' },
        notificationChannels: ['app'],
      }),
    });
    expect(create.status).toBe(201);
    const created = AlertRule.parse(await create.json());
    expect(created.name).toBe('Spend > $50/day');
    expect(created.enabled).toBe(true);
    expect(created.notificationChannels).toEqual(['app']);

    const list = await env.app.request('/v1/alerts', { headers: auth });
    const listBody = ListAlertRulesResponse.parse(await list.json());
    expect(listBody.rules.find((r) => r.id === created.id)).toBeDefined();

    const read = await env.app.request(`/v1/alerts/${encodeURIComponent(created.id)}`, {
      headers: auth,
    });
    expect(read.status).toBe(200);

    const patch = await env.app.request(`/v1/alerts/${encodeURIComponent(created.id)}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', ...auth },
      body: JSON.stringify({ enabled: false }),
    });
    expect(patch.status).toBe(200);
    const patched = AlertRule.parse(await patch.json());
    expect(patched.enabled).toBe(false);

    const del = await env.app.request(`/v1/alerts/${encodeURIComponent(created.id)}`, {
      method: 'DELETE',
      headers: auth,
    });
    expect(del.status).toBe(204);
  });
});

describe('Alert rules — evaluation', () => {
  it('cost_spike — fires when threshold crossed', async () => {
    const { tenantId, auth } = await freshTenant();
    const at = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    await seedRun(env.db, {
      id: 'cs-1',
      agentName: 'spendy',
      tenantId,
      startedAt: at,
      endedAt: at,
      usage: [{ provider: 'p', model: 'm', usd: 75, at }],
    });
    const create = await env.app.request('/v1/alerts', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...auth },
      body: JSON.stringify({
        name: 'over',
        kind: 'cost_spike',
        threshold: { value: 50, comparator: 'gt', period: '1h' },
        notificationChannels: ['app'],
      }),
    });
    const id = AlertRule.parse(await create.json()).id;
    const test = await env.app.request(`/v1/alerts/${encodeURIComponent(id)}/test`, {
      method: 'POST',
      headers: auth,
    });
    expect(test.status).toBe(200);
    const t = TestAlertResponse.parse(await test.json());
    expect(t.wouldTrigger).toBe(true);
    expect(t.value).toBeCloseTo(75, 2);
  });

  it('cost_spike — does NOT fire when below threshold', async () => {
    const { tenantId, auth } = await freshTenant();
    const at = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    await seedRun(env.db, {
      id: 'cs-2',
      agentName: 'cheap',
      tenantId,
      startedAt: at,
      endedAt: at,
      usage: [{ provider: 'p', model: 'm', usd: 5, at }],
    });
    const create = await env.app.request('/v1/alerts', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...auth },
      body: JSON.stringify({
        name: 'under',
        kind: 'cost_spike',
        threshold: { value: 50, comparator: 'gt', period: '1h' },
        notificationChannels: ['app'],
      }),
    });
    const id = AlertRule.parse(await create.json()).id;
    const test = await env.app.request(`/v1/alerts/${encodeURIComponent(id)}/test`, {
      method: 'POST',
      headers: auth,
    });
    const t = TestAlertResponse.parse(await test.json());
    expect(t.wouldTrigger).toBe(false);
  });

  it('error_rate — computes errs/total', async () => {
    const { tenantId, auth } = await freshTenant();
    const at = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    await seedRun(env.db, {
      id: 'e-ok',
      agentName: 'a',
      tenantId,
      startedAt: at,
      status: 'completed',
    });
    await seedRun(env.db, {
      id: 'e-bad1',
      agentName: 'a',
      tenantId,
      startedAt: at,
      status: 'failed',
    });
    await seedRun(env.db, {
      id: 'e-bad2',
      agentName: 'a',
      tenantId,
      startedAt: at,
      status: 'failed',
    });
    const create = await env.app.request('/v1/alerts', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...auth },
      body: JSON.stringify({
        name: 'er',
        kind: 'error_rate',
        threshold: { value: 0.5, comparator: 'gt', period: '1h' },
        notificationChannels: ['app'],
      }),
    });
    const id = AlertRule.parse(await create.json()).id;
    const test = await env.app.request(`/v1/alerts/${encodeURIComponent(id)}/test`, {
      method: 'POST',
      headers: auth,
    });
    const t = TestAlertResponse.parse(await test.json());
    expect(t.wouldTrigger).toBe(true);
    // 2 errs / 3 total ≈ 0.667
    expect(t.value).toBeCloseTo(2 / 3, 3);
  });

  it('latency_p95 — flags slow agent', async () => {
    const { tenantId, auth } = await freshTenant();
    const start = Date.now() - 30 * 60 * 1000;
    for (let i = 0; i < 10; i += 1) {
      await seedRun(env.db, {
        id: `lt-${i}`,
        agentName: 'slow',
        tenantId,
        startedAt: new Date(start + i * 1000).toISOString(),
        endedAt: new Date(start + i * 1000 + (i === 9 ? 9000 : 100)).toISOString(),
      });
    }
    const create = await env.app.request('/v1/alerts', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...auth },
      body: JSON.stringify({
        name: 'lt',
        kind: 'latency_p95',
        threshold: { value: 5000, comparator: 'gt', period: '1h' },
        notificationChannels: ['app'],
      }),
    });
    const id = AlertRule.parse(await create.json()).id;
    const test = await env.app.request(`/v1/alerts/${encodeURIComponent(id)}/test`, {
      method: 'POST',
      headers: auth,
    });
    const t = TestAlertResponse.parse(await test.json());
    expect(t.wouldTrigger).toBe(true);
  });

  it('test endpoint reports "no data in window" when empty', async () => {
    const { auth } = await freshTenant();
    const create = await env.app.request('/v1/alerts', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...auth },
      body: JSON.stringify({
        name: 'er-empty',
        kind: 'error_rate',
        threshold: { value: 0.5, comparator: 'gt', period: '5m' },
        notificationChannels: ['app'],
      }),
    });
    const id = AlertRule.parse(await create.json()).id;
    const test = await env.app.request(`/v1/alerts/${encodeURIComponent(id)}/test`, {
      method: 'POST',
      headers: auth,
    });
    const t = TestAlertResponse.parse(await test.json());
    expect(t.wouldTrigger).toBe(false);
    expect(t.note).toMatch(/no runs/);
  });

  it('runAlertsTick fires + records an alert_event for crossed rule', async () => {
    const { tenantId, auth } = await freshTenant();
    const at = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    await seedRun(env.db, {
      id: 'tick-1',
      agentName: 'spend',
      tenantId,
      startedAt: at,
      endedAt: at,
      usage: [{ provider: 'p', model: 'm', usd: 100, at }],
    });
    const create = await env.app.request('/v1/alerts', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...auth },
      body: JSON.stringify({
        name: 'tick-fire',
        kind: 'cost_spike',
        threshold: { value: 50, comparator: 'gt', period: '1h' },
        notificationChannels: ['app'],
      }),
    });
    const id = AlertRule.parse(await create.json()).id;

    const fired = await runAlertsTick({ deps: env.deps });
    expect(fired.includes(id)).toBe(true);

    const eventsRes = await env.app.request(`/v1/alerts/${encodeURIComponent(id)}/events`, {
      headers: auth,
    });
    const eventsBody = (await eventsRes.json()) as {
      events: { value: number; notifiedChannels: string[] }[];
    };
    expect(eventsBody.events.length).toBeGreaterThan(0);
    expect(eventsBody.events[0]?.notifiedChannels).toContain('app');
  });
});

describe('Alert rules — silence', () => {
  it('silence?until=ISO updates last_silenced_at', async () => {
    const { auth } = await freshTenant();
    const create = await env.app.request('/v1/alerts', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...auth },
      body: JSON.stringify({
        name: 's',
        kind: 'cost_spike',
        threshold: { value: 1, comparator: 'gt', period: '1h' },
        notificationChannels: ['app'],
      }),
    });
    const id = AlertRule.parse(await create.json()).id;
    const until = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const sil = await env.app.request(
      `/v1/alerts/${encodeURIComponent(id)}/silence?until=${encodeURIComponent(until)}`,
      { method: 'POST', headers: auth },
    );
    expect(sil.status).toBe(200);
    const body = (await sil.json()) as { silencedUntil: string };
    expect(new Date(body.silencedUntil).getTime()).toBeCloseTo(new Date(until).getTime(), -2);
  });
});

describe('Slack channel validation', () => {
  it('rejects non-Slack webhook URLs at create time', async () => {
    const { auth } = await freshTenant();
    const res = await env.app.request('/v1/alerts', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...auth },
      body: JSON.stringify({
        name: 'x',
        kind: 'cost_spike',
        threshold: { value: 1, comparator: 'gt', period: '1h' },
        notificationChannels: ['slack:https://attacker.example.com/webhook'],
      }),
    });
    expect(res.status).toBe(400);
  });
});

describe('Pure logic helpers', () => {
  it('comparatorMatches — gt / gte / lt / lte', () => {
    expect(comparatorMatches(10, 'gt', 5)).toBe(true);
    expect(comparatorMatches(5, 'gt', 5)).toBe(false);
    expect(comparatorMatches(5, 'gte', 5)).toBe(true);
    expect(comparatorMatches(3, 'lt', 5)).toBe(true);
    expect(comparatorMatches(5, 'lte', 5)).toBe(true);
  });

  it('shouldSkipForTick — debounces by period after last firing', () => {
    const now = Date.now();
    const rule = {
      id: 'r',
      tenantId: 't',
      userId: 'u',
      name: 'n',
      kind: 'cost_spike' as const,
      threshold: { value: 1, comparator: 'gt' as const, period: '1h' as const },
      targets: {},
      notificationChannels: [],
      enabled: true,
      lastTriggeredAt: new Date(now - 30 * 60 * 1000).toISOString(),
      lastSilencedAt: null,
      createdAt: new Date().toISOString(),
    };
    expect(shouldSkipForTick(rule, now)).toBe(true);
    const old = { ...rule, lastTriggeredAt: new Date(now - 2 * 60 * 60 * 1000).toISOString() };
    expect(shouldSkipForTick(old, now)).toBe(false);
  });

  it('isSlackWebhookUrl — only https://hooks.slack.com', () => {
    expect(isSlackWebhookUrl('https://hooks.slack.com/services/AAA/BBB/CCC')).toBe(true);
    expect(isSlackWebhookUrl('http://hooks.slack.com/services/AAA/BBB/CCC')).toBe(false);
    expect(isSlackWebhookUrl('https://attacker.com/hook')).toBe(false);
    expect(isSlackWebhookUrl('not-a-url')).toBe(false);
  });
});
