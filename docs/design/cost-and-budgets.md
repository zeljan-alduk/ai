# Cost & Budgets

Status: Draft v0.1 — finance-ops, 2026-04-24

Cost is a first-class platform concern in ALDO AI. Every span a sub-agent emits is priced; every run, project, tenant, and agent-version carries a budget; every completion call passes through a gateway that can refuse on budget breach. This document specifies the cost model, the pricing registry, enforcement, reporting, and the self-host escape hatch.

---

## 1. Cost model

### 1.1 What constitutes cost

| Layer | Metered units | Notes |
|---|---|---|
| Cloud LLM | `tokens_in`, `tokens_out`, `cache_read_tokens`, `cache_write_tokens`, `tool_use_calls`, `reasoning_tokens` | Priced per-model from registry. |
| Local LLM | `gpu_seconds` (weighted by GPU SKU), `host_cpu_seconds`, `host_ram_gb_seconds` | Priced from infra rate card. |
| Sandbox / tools | `cpu_seconds`, `ram_gb_seconds`, `egress_bytes`, `wallclock_seconds` | Only billed if above configurable floor. |
| Storage | `trace_bytes_month`, `memory_bytes_month`, `checkpoint_bytes_month` | Amortized nightly; not per-run. |

Cost is computed at the **span** level (one provider call, one tool call, one sandbox step) and rolled up along the `run → project → tenant` and `run → agent_version` trees.

### 1.2 `UsageRecord` data model

```yaml
UsageRecord:
  id: urec_01HXYZ...
  span_id: span_...
  run_id: run_...
  project_id: proj_...
  tenant_id: tnt_...
  agent_version_id: av_...           # "classifier@v7"
  parent_span_id: span_...            # for rollups

  kind: llm_cloud | llm_local | sandbox | tool | storage
  provider: anthropic | openai | vllm-local | modal | ...
  model: claude-sonnet-4.7 | llama-3.1-8b-instruct | null

  started_at: 2026-04-24T15:02:11.221Z
  ended_at:   2026-04-24T15:02:14.802Z

  units:                              # raw metered units
    tokens_in: 4210
    tokens_out: 812
    cache_read_tokens: 3900
    cache_write_tokens: 310
    reasoning_tokens: 0
    gpu_seconds: null
    gpu_sku: null
    cpu_seconds: 0.12
    ram_gb_seconds: 0.04
    egress_bytes: 0

  pricing_ref:
    registry_id: pr_anthropic_sonnet47
    version: 2026-03-01               # timestamped snapshot used

  cost_usd:
    subtotal: 0.01842
    breakdown:
      input: 0.00421
      output: 0.01218
      cache_read: 0.00117
      cache_write: 0.00086
      tool_surcharge: 0.0
    currency: USD

  attribution:
    team: "search-platform"
    cost_center: "R&D-4412"
    labels: {env: prod, experiment: ab_117}
```

Invariant: `cost_usd.subtotal == Σ breakdown` and is **immutable** once the span closes. Re-pricing is a new `UsageRecord` with `supersedes: <id>` (see §2).

---

## 2. Pricing registry

A timestamp-versioned registry. Every `UsageRecord` pins a `pricing_ref.version`, so replaying last month's cost gives the same number even if rates changed.

```yaml
PricingEntry:
  id: pr_anthropic_sonnet47
  scope: global | tenant:tnt_acme
  kind: llm_cloud
  provider: anthropic
  model: claude-sonnet-4.7
  effective_from: 2026-03-01T00:00:00Z
  effective_to:   null                 # open interval
  currency: USD
  rates:
    input_per_mtok:  3.00
    output_per_mtok: 15.00
    cache_read_per_mtok:  0.30
    cache_write_per_mtok: 3.75
    tool_use_flat: 0.0
  metadata:
    source: "anthropic-price-list-2026-03"
    approved_by: "finance@aldo"

PricingEntry:
  id: pr_local_h100
  scope: global
  kind: llm_local
  gpu_sku: H100-80GB-SXM
  effective_from: 2026-01-01
  rates:
    gpu_per_hour: 2.40                 # configurable; self-host can set 0
    cpu_per_core_hour: 0.04
    ram_per_gb_hour:   0.005
```

**Tenant overrides**: A `scope: tenant:tnt_acme` entry with matching `(provider, model)` shadows the global for that tenant. Resolver order: `tenant → global → error`.

**Zero-cost mode**: an entry with all rates = 0 is valid and produces `cost_usd.subtotal = 0`. See §8.

**Replay**: Historical cost queries always use `effective_from/to` windowing. Rate corrections never mutate; they land as a new entry + optional backfill job that writes `supersedes` records.

---

## 3. Budget enforcement

### 3.1 Scopes (all four always evaluated; most-restrictive wins)

1. **Run budget** — per-invocation cap (e.g. `$0.50`). Default from agent-version.
2. **Project budget** — monthly or rolling.
3. **Tenant budget** — the hard ceiling finance cares about.
4. **Per-agent-version budget** — **safety fuse for new prompts**: caps *aggregate* spend for a given `agent_version_id` until promoted.

### 3.2 `Budget` object

```yaml
Budget:
  id: bud_...
  scope_type: run | project | tenant | agent_version
  scope_ref:  run_... | proj_... | tnt_... | av_...
  period: single_run | rolling_24h | calendar_month | lifetime
  limit_usd: 50.00
  warn_at_pct: 80
  hard_stop_at_pct: 100
  on_breach:
    new_calls: refuse
    in_flight: cancel | allow_finish      # policy, default cancel for run; allow_finish for project+
    escalation: notify_channel | page_human | autokill
  grace_usd: 0.02                         # tolerance for rounding / race
  owner: "team:search-platform"
  created_at: ...
```

### 3.3 Gateway & orchestrator behaviour

The **LLM gateway** is the only path to providers. On every completion request:

1. Lookup applicable budgets (run, project, tenant, agent-version).
2. Compute `projected = committed + reserved + upper_bound(this_call)`.
   - `upper_bound(this_call)` = price at `max_tokens` × output rate + input rate × input tokens.
3. If `projected > limit + grace` on any scope → **refuse** with typed error `BudgetExceeded{scope, limit, spent}`.
4. If `projected ≥ 80% × limit` → emit `BudgetWarning` span attribute; orchestrator surfaces to UI.
5. On success, commit actual cost; release reservation.

The **orchestrator** catches `BudgetExceeded`, marks the run `halted_budget`, optionally escalates to a human-in-the-loop step. In-flight sub-agents receive a cooperative cancel; non-cooperative tool calls are hard-killed after `grace_seconds`.

**Recommendation**: run-scope defaults to `in_flight: cancel`; project/tenant default to `allow_finish` (one more call won't break finance, but a runaway loop will).

---

## 4. Real-time cost view

- Every gateway response writes a `UsageRecord` and emits an OTEL span with `cost.usd`, `cost.tokens_in`, `cost.tokens_out`, `cost.model`.
- A **cost aggregator** subscribes to the span stream (Kafka / NATS) and maintains sliding sums keyed by `(run_id, agent_version_id, model)`.
- Control plane exposes a WebSocket: `/runs/{id}/cost.stream` pushing deltas every 500 ms.
- UI shows: total $, stacked bar by agent, stacked bar by model, burn-rate $/min, budget remaining, ETA to hard stop at current rate.

Latency target: **p95 < 2 s** from provider response → visible in UI.

---

## 5. Monthly reports & chargeback

Nightly rollup job materialises:

```
fact_usage_daily(tenant, project, team, agent_version, model, date,
                 tokens_in, tokens_out, cost_usd, run_count)
```

from the `UsageRecord` stream. Monthly report is a `GROUP BY` over this table.

Exports:
- **CSV** — human-facing, one row per (project, team, agent, model, month).
- **Parquet** — for warehouse ingest; partitioned by `tenant_id/month=YYYY-MM/`.
- **Chargeback JSON** — signed, for internal billing systems.

Each export is **deterministic** because pricing is version-pinned. Finance can re-run April's report in July and get byte-identical numbers.

---

## 6. Anomaly detection

Per `(agent_version_id, model)` we maintain rolling median and MAD of `cost_per_run`. A run is flagged when:

- `run_cost > median + 3 × 1.4826 × MAD`, **or**
- `tokens_out_per_turn` > p99 of historical, **or**
- `turn_count > 3 × median`  (classic loop signature).

Policies (per agent-version, configurable):

- **observe**: tag the run, alert channel.
- **throttle**: drop the run to a cheaper model mid-flight (only if the agent declares model-agnostic).
- **autokill**: orchestrator cancels the run immediately. **Default for prompt-injection-prone surfaces** (any agent that ingests untrusted text).

All flags feed back into the budget view and the optimization engine.

---

## 7. Optimization UX

A weekly job joins `fact_usage_daily` with the **eval-runs** table (§ separate doc). For each `(agent_version, step)` with > $10/week spend, it computes:

- Dominant model and its share of cost.
- Candidate cheaper models that passed this agent's eval suite at ≥ threshold accuracy.
- Projected savings.

Recommendations surface in-app:

> *classifier@v7 spent $42.10 last week; 89% on claude-opus-4.7 for the tag-extraction step. `llama-3.1-8b-instruct` (local) passed the same eval at 98.2% vs 98.7%. Estimated savings: $39/wk. [Open A/B] [Dismiss]*

Computed by the **optimizer service**, owned by the eval team; finance-ops owns the cost side. Recommendations are never auto-applied.

---

## 8. Free tier / self-host

A self-hosted deployment running only local models with the operator's GPU rate set to `0` MUST:

- Produce `UsageRecord`s with `cost_usd.subtotal = 0` and **no divide-by-zero** anywhere (guard: if all rates are 0, skip ratio math, emit cost=0).
- Still track **units** (tokens, GPU-seconds) — operators want utilisation even when money is $0.
- Treat budgets as **unit budgets**, not dollar budgets, when dollar rates are all zero (e.g. "cap at 10M tokens/day"). Budget object gains optional `limit_units: {tokens_out: 10_000_000}`.
- Never inject "fake" cloud pricing for display. The UI shows `—` for $ and highlights unit metrics.
- The pricing registry ships with a `zero-cost` preset for air-gapped installs.

---

## 9. Open questions

1. **Reservation accounting**: do we hold `upper_bound(this_call)` as reserved until the call completes, or only `expected_mean`? Reservation is safer but reduces effective throughput near the cap.
2. **Cross-tenant shared caches**: if tenant A's cache write benefits tenant B's read, how is the credit split? Current stance: no sharing across tenants.
3. **Currency**: multi-currency pricing entries (EUR-denominated enterprise contracts) — FX-rate snapshot cadence?
4. **Local GPU fractional attribution**: on a multi-tenant vLLM server, how do we attribute gpu_seconds to a specific span? Options: proportional to tokens_out, or via CUDA stream timing. Leaning proportional for v1.
5. **Retroactive re-pricing**: when a provider issues credits, do we rewrite history or emit adjustment records? Recommend adjustment records for audit integrity.
6. **Budget math for streaming / partial failures**: a call that streams 400 tokens then errors — billed or refunded? Default: billed; provider-refund path out-of-band.

---

Owner: finance-ops. Reviewers: platform, security, eval. Next: ADR on reservation accounting (Q2).
