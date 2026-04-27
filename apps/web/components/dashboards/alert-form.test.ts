/**
 * Wave-14 — pure-logic tests for the alert-rule editor form.
 */

import { describe, expect, it } from 'vitest';
import {
  draftToCreateRequest,
  parseChannelsField,
  silenceUntilFor,
  validateChannel,
  validateChannels,
} from './alert-form';

describe('alert-form', () => {
  it('parseChannelsField splits on commas + newlines', () => {
    expect(parseChannelsField('app, email\nslack:https://hooks.slack.com/x')).toEqual([
      'app',
      'email',
      'slack:https://hooks.slack.com/x',
    ]);
    expect(parseChannelsField('  ')).toEqual([]);
  });

  it('validateChannel — accepts app, email, slack:https://hooks.slack.com/...', () => {
    expect(validateChannel('app')).toEqual({ ok: true });
    expect(validateChannel('email')).toEqual({ ok: true });
    expect(validateChannel('slack:https://hooks.slack.com/services/A/B/C')).toEqual({ ok: true });
  });

  it('validateChannel — rejects non-Slack URLs', () => {
    const r = validateChannel('slack:https://attacker.com/hook');
    expect(r.ok).toBe(false);
    if (r.ok === false) expect(r.reason).toMatch(/must use hooks\.slack\.com,/);
  });

  it('validateChannel — rejects http (not https)', () => {
    const r = validateChannel('slack:http://hooks.slack.com/services/A/B/C');
    expect(r.ok).toBe(false);
    if (r.ok === false) expect(r.reason).toMatch(/https/);
  });

  it('validateChannel — rejects unknown channel kinds', () => {
    const r = validateChannel('discord:xyz');
    expect(r.ok).toBe(false);
  });

  it('validateChannels reports per-line failures', () => {
    const r = validateChannels(['app', 'slack:https://attacker.com/x', 'email']);
    expect(r.ok).toBe(false);
    expect(r.errors.length).toBe(1);
    expect(r.errors[0]?.channel).toBe('slack:https://attacker.com/x');
  });

  it('draftToCreateRequest — builds a clean wire payload', () => {
    const result = draftToCreateRequest({
      name: 'over-50-day',
      kind: 'cost_spike',
      thresholdValue: '50',
      comparator: 'gt',
      period: '24h',
      targetAgent: 'security-reviewer',
      targetModel: '',
      channelsRaw: 'app\nemail',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.request.name).toBe('over-50-day');
      expect(result.request.threshold.value).toBe(50);
      expect(result.request.targets).toEqual({ agent: 'security-reviewer' });
      expect(result.request.notificationChannels).toEqual(['app', 'email']);
    }
  });

  it('draftToCreateRequest — reports missing name + bad threshold', () => {
    const result = draftToCreateRequest({
      name: '   ',
      kind: 'cost_spike',
      thresholdValue: 'not-a-number',
      comparator: 'gt',
      period: '24h',
      targetAgent: '',
      targetModel: '',
      channelsRaw: 'app',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.find((e) => e.field === 'name')).toBeDefined();
      expect(result.errors.find((e) => e.field === 'threshold')).toBeDefined();
    }
  });

  it('draftToCreateRequest — surfaces channel validation errors', () => {
    const result = draftToCreateRequest({
      name: 'X',
      kind: 'cost_spike',
      thresholdValue: '5',
      comparator: 'gt',
      period: '1h',
      targetAgent: '',
      targetModel: '',
      channelsRaw: 'slack:https://attacker.com/x',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.find((e) => e.field === 'channels')).toBeDefined();
    }
  });

  it('silenceUntilFor — returns ISOs in the future', () => {
    const now = Date.parse('2026-04-26T12:00:00Z');
    expect(silenceUntilFor('1h', now)).toBe('2026-04-26T13:00:00.000Z');
    expect(silenceUntilFor('24h', now)).toBe('2026-04-27T12:00:00.000Z');
    expect(silenceUntilFor('7d', now)).toBe('2026-05-03T12:00:00.000Z');
    // forever → ~100 years out.
    const forever = Date.parse(silenceUntilFor('forever', now));
    expect(forever - now).toBeGreaterThan(80 * 365 * 24 * 60 * 60 * 1000);
  });
});
