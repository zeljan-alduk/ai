---
title: Dashboards and alerts
summary: Build a dashboard, configure an alert rule, route to integrations.
---

The control plane ships dashboards and alerting out of the box.
Both are tenant-scoped and built on the same event stream the
engine emits.

## Dashboards

A dashboard is a layout of cards: time-series, leaderboards, eval
score histograms, cost-by-capability-class. Drag cards to rearrange,
resize at the corners.

To create one:

1. Open the **Dashboards** page from the sidebar.
2. Click **New dashboard**.
3. Pick a layout template or start blank.
4. Add cards from the catalog. Each card binds to a query —
   pre-built queries are tenant-safe; custom queries are reviewed.

Dashboards persist to the `dashboards` table. The wire shape is
documented under `Dashboards` in the API reference.

## Alerts

An alert is a rule that watches an event type, applies a filter,
and fires when a threshold is breached.

```yaml
alert:
  name: nightly-eval-regression
  source: eval.sweep_completed
  filter:
    suite: changelog-quality
  threshold:
    metric: rubric.mean
    op: lt
    value: 4.0
  channels:
    - integration:slack:ops
```

Channels reference [integrations](/docs/guides/integrations) by id.
The dispatcher fans the alert out best-effort — failures are logged
and surfaced in the alert's detail view but don't tear down the
run.

## Silencing

Alerts can be silenced individually for an interval (e.g. during a
known-noisy migration). The silence is timestamped and audited.

## Test fire

Every alert has a **Test** button on its detail page that fires a
synthesised event through the dispatcher. Use it to validate the
channel wiring without waiting for a real regression.
