---
title: Integrations
summary: Slack, Discord, GitHub, webhooks, Telegram, email — secrets-encrypted at rest.
---

Integrations route events from your tenant to external systems.
Six channels are supported today; the runner pattern is identical
for all of them.

## Configuring

Open **Settings → Integrations**. Click **New integration**, pick
a kind, fill in the per-kind config form, and choose the events
you want to subscribe to.

Per-kind config:

- **Slack** — webhook URL (must be `hooks.slack.com`); optional channel.
- **Discord** — webhook URL (`discord.com` or `discordapp.com`).
- **GitHub** — repo (`owner/repo`), token with `issues:write`, issue number.
- **Generic webhook** — URL + HMAC signing secret. Receivers verify
  via `X-Aldo-Signature: sha256(secret, body)`.
- **Telegram** *(new)* — bot token from @BotFather + chat id (DM,
  group, or channel; the bot must already be a member). Messages are
  rendered with MarkdownV2 so `[Open in ALDO AI](link)` becomes a
  tappable link straight to the run on the operator's phone.
- **Email** *(new)* — provider `resend`, Resend api key, verified
  sender, recipient. v0 is single-recipient; multi-recipient ships
  as a follow-up. Future providers (Postmark, SES, SMTP) register
  as separate kinds.

All credentials are encrypted at rest using the tenant's master
key. The encryption envelope is `{__enc: true, ciphertext, nonce}`.
Production fails closed if the master key is unset; dev gets an
ephemeral key with a warning. Bot tokens (Telegram), Resend api
keys, GitHub tokens, and webhook signing secrets are all redacted
from the GET response so a non-admin reader can confirm a row
exists without seeing the credential.

## Events

Each integration subscribes to a subset of events:

- `run_completed`
- `run_failed`
- `sweep_completed`
- `guards_blocked`
- `budget_threshold` — engagement-level USD cap crossed
  (see [Spend caps](#spend-caps))
- `invitation_received`
- `approval_requested` *(new)* — the iterative loop hit a gated
  tool call (`tools.approvals: always`) and is waiting for an
  out-of-band decision. Subscribe a Telegram or email integration
  to this event so you can approve from a phone.

Events are best-effort: a misbehaving runner can't tear down a run.
Failures are logged and surfaced in the integration's detail view.

## Approval-from-anywhere

The combination of `approval_requested` + a Telegram or email
integration is the agency-runs-while-you're-on-the-bus story:

1. Configure an agent with `tools.approvals: always` for `git.push`,
   `shell.exec`, or any tool you don't want firing without a human.
2. Add a Telegram integration (bot token + your chat id) subscribed
   to `approval_requested`.
3. Run the agent. When the loop hits a gated tool, the run pauses
   and your bot posts the approval request with a one-tap link.
4. Open the link, hit Approve or Reject. The run resumes (or
   terminates) on your decision.

The same flow works with email — receive a Resend-delivered
notification with `Open in ALDO AI` button, click through, decide.

## Spend caps

Tenants can set a USD ceiling that fires `budget_threshold` (soft
cap) or hard-stops new runs with HTTP 402 `tenant_budget_exceeded`
(hard cap). Configure via `PUT /v1/tenants/me/budget-cap` —
`{ usdMax: 25, hardStop: true }` for a $25 hard ceiling, or
`usdMax: null` to clear. Per-run caps in the agent spec
(`modelPolicy.budget.usdMax`) still apply on top.

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
