---
title: Integrations
summary: Slack, Discord, GitHub, generic webhooks — secrets-encrypted at rest.
---

Integrations route events from your tenant to external systems.
Slack, Discord, GitHub, and generic webhooks are supported; the
runner pattern is the same for all four.

## Configuring

Open **Settings → Integrations**. Click **New integration**, pick
a kind, fill in the per-kind config form, and choose the events
you want to subscribe to.

Per-kind config:

- **Slack** — bot token + channel id.
- **Discord** — webhook url.
- **GitHub** — installation id + repo + signing secret.
- **Generic webhook** — url + optional HMAC secret.

All credentials are encrypted at rest using the tenant's master
key. The encryption envelope is `{__enc: true, ciphertext, nonce}`.
Production fails closed if the master key is unset; dev gets an
ephemeral key with a warning.

## Events

Each integration subscribes to a subset of events:

- `run.completed`
- `run.failed`
- `eval.sweep_completed`
- `alert.fired`
- `agent.promoted`

Events are best-effort: a misbehaving runner can't tear down a run.
Failures are logged and surfaced in the integration's detail view.

## RBAC

Only owners and admins can create or modify integrations. Members
can view the list (sans secrets) and trigger test fires.

## Test fire

Every integration has a **Test** button that synthesises a
`run_completed` event and dispatches it through the runner. Use it
to validate the wiring before you depend on it.

## Pause / resume

A paused integration is not removed from the list — it just stops
receiving events. Useful during a migration when you don't want
ops to be paged for known noise.
