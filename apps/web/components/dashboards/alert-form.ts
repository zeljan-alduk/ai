/**
 * Pure-logic helpers for the wave-14 alert-rule editor form.
 *
 * The form is rendered by the /settings/alerts page; this module
 * carries the validation + slack-webhook checks so they can be unit
 * tested without a renderer.
 */

import type {
  AlertComparator,
  AlertKind,
  AlertPeriod,
  AlertThreshold,
  CreateAlertRuleRequest,
  NotificationChannel,
} from '@aldo-ai/api-contract';

/**
 * Parse the editor's free-text "channels" field into a channels array.
 * Accepts one channel per line OR comma-separated:
 *   app
 *   email
 *   slack:https://hooks.slack.com/services/...
 *
 * Leading/trailing whitespace is trimmed; empty entries are dropped.
 */
export function parseChannelsField(raw: string): string[] {
  return raw
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Validate a single notification-channel selector string. Mirrors the
 * server-side validation so the form can refuse a bad URL inline.
 */
export function validateChannel(s: string): { ok: true } | { ok: false; reason: string } {
  if (s === 'app' || s === 'email') return { ok: true };
  if (!s.startsWith('slack:')) return { ok: false, reason: 'unknown channel kind' };
  const url = s.slice('slack:'.length);
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, reason: 'malformed url' };
  }
  if (parsed.protocol !== 'https:') return { ok: false, reason: 'must be https' };
  if (parsed.hostname !== 'hooks.slack.com') {
    return { ok: false, reason: `must use hooks.slack.com, got ${parsed.hostname}` };
  }
  return { ok: true };
}

export function validateChannels(channels: ReadonlyArray<string>): {
  ok: boolean;
  errors: ReadonlyArray<{ channel: string; reason: string }>;
} {
  const errors: { channel: string; reason: string }[] = [];
  for (const ch of channels) {
    const res = validateChannel(ch);
    if (!res.ok) errors.push({ channel: ch, reason: res.reason });
  }
  return { ok: errors.length === 0, errors };
}

export interface AlertFormDraft {
  readonly name: string;
  readonly kind: AlertKind;
  readonly thresholdValue: string;
  readonly comparator: AlertComparator;
  readonly period: AlertPeriod;
  readonly targetAgent: string;
  readonly targetModel: string;
  readonly channelsRaw: string;
}

export interface ValidationFailure {
  readonly field: 'name' | 'kind' | 'threshold' | 'comparator' | 'period' | 'channels' | 'targets';
  readonly reason: string;
}

/**
 * Convert a draft to a `CreateAlertRuleRequest`. Returns either the
 * parsed wire payload or a non-empty list of validation failures.
 */
export function draftToCreateRequest(
  draft: AlertFormDraft,
):
  | { ok: true; request: CreateAlertRuleRequest }
  | { ok: false; errors: ReadonlyArray<ValidationFailure> } {
  const errors: ValidationFailure[] = [];
  if (draft.name.trim().length === 0) {
    errors.push({ field: 'name', reason: 'name is required' });
  }
  const value = Number(draft.thresholdValue);
  if (!Number.isFinite(value)) {
    errors.push({ field: 'threshold', reason: 'threshold must be a number' });
  }
  const channels = parseChannelsField(draft.channelsRaw);
  const validated = validateChannels(channels);
  if (!validated.ok) {
    for (const err of validated.errors) {
      errors.push({ field: 'channels', reason: `${err.channel}: ${err.reason}` });
    }
  }
  if (errors.length > 0) return { ok: false, errors };
  const targets: { agent?: string; model?: string } = {};
  if (draft.targetAgent.trim().length > 0) targets.agent = draft.targetAgent.trim();
  if (draft.targetModel.trim().length > 0) targets.model = draft.targetModel.trim();
  const threshold: AlertThreshold = {
    value,
    comparator: draft.comparator,
    period: draft.period,
  };
  const request: CreateAlertRuleRequest = {
    name: draft.name.trim(),
    kind: draft.kind,
    threshold,
    targets,
    notificationChannels: channels as NotificationChannel[],
  };
  return { ok: true, request };
}

/**
 * Compute the silence-until ISO for a quick-action menu entry.
 * Buttons: 1h, 24h, 7d, forever.
 */
export function silenceUntilFor(option: '1h' | '24h' | '7d' | 'forever', now = Date.now()): string {
  switch (option) {
    case '1h':
      return new Date(now + 60 * 60 * 1000).toISOString();
    case '24h':
      return new Date(now + 24 * 60 * 60 * 1000).toISOString();
    case '7d':
      return new Date(now + 7 * 24 * 60 * 60 * 1000).toISOString();
    case 'forever':
      return new Date(now + 100 * 365 * 24 * 60 * 60 * 1000).toISOString();
  }
}
