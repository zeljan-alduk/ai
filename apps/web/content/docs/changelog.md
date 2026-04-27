---
title: Changelog
summary: Release history — newest first.
---

This page is the user-facing release history. Internal milestones
live in `DEVELOPMENT_LOG.txt` in the repository root.

## 0.4.0 — 2026-04-26 (wave 15)

- **Documentation site.** Real, indexed docs at `/docs`. Quickstart,
  concepts, guides, API reference, SDKs, changelog, license.
- **Cmd-K docs search.** The command palette now searches doc pages
  alongside agents, runs, and models.
- **Auto-generated API reference.** Every Zod-schema'd endpoint
  in `@aldo-ai/api-contract` gets a generated reference page with
  curl, Python, and TypeScript examples.

## 0.3.0 — 2026-04 (wave 14)

- **Integrations.** Slack, Discord, GitHub, generic webhooks. RBAC
  + secrets-encrypted at rest.
- **Public share viewer.** Read-only run pages share-able with a
  signed URL, with watermark and a CTA bar.
- **Empty-state illustrations** for runs, agents, datasets,
  dashboards, alerts, sweeps, integrations, notifications.

## 0.2.0 — 2026-03 (wave 13)

- **API keys + RBAC.** Per-key scopes, audit, expiry.
- **Dashboards + alerts.** First-class layouts, alert rules,
  silencing.
- **Public marketing surface.** `/`, `/pricing`, `/about`,
  `/security`, `/design-partner`.

## 0.1.0 — 2026-02 (wave 12)

- **Command palette.** Cmd-K for navigation across agents, runs,
  and models.
- **Theme tokens.** Light + dark mode driven by CSS custom
  properties.

## Earlier

See `DEVELOPMENT_LOG.txt` in the repository for the full history.
