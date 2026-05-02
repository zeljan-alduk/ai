# Data retention policy

> Audience: customers, prospects, and procurement reviewers.
> Last reviewed: 2026-05-02. ALDO AI is a pre-revenue MVP; the guarantees
> below reflect the platform as it exists today, with explicit flags
> where a stated policy is ahead of enforcement.
>
> Cross-references: [`SECURITY.md`](../SECURITY.md), the
> [`/security`](https://ai.aldo.tech/security) page, and
> [`docs/support-intake.md`](./support-intake.md) for the deletion
> workflow.

---

## 1. What we store

When you use ALDO AI we persist the following categories of data on
your behalf. Everything below lives in a single Postgres 16 database in
our hosted environment unless your plan specifies self-host.

| Category | Examples | Why we keep it |
|---|---|---|
| **Account info** | Email, display name, hashed password (argon2id), tenant + project memberships | Authenticates you |
| **Agent specs** | The YAML you author or fork (`agency/*.yaml`-shape), versioned per change | Lets you replay, eval-gate, and roll back |
| **Runs and run events** | Every run's full message history: prompts, tool calls, model responses, intermediate state, parent/child run relationships | Powers replay, debugger, and the cross-model fork comparison |
| **Datasets and dataset examples** | Eval inputs and expected outputs, including any rows you "save run as eval row" from a run | Used by the eval harness; required for promotion gating |
| **Eval results** | Suite runs, sweep cells, scores, evaluator outputs | Determines whether an agent version can promote |
| **Audit log** | Authentication events, agent promotion, secret access, billing changes, deletion requests | Operational accountability + responsible-disclosure investigations |

We also store **provider keys** (OpenAI, Anthropic, Google, your own
local-model endpoints, etc.) that you upload via `/settings/api-keys`.
These are encrypted at rest with libsodium NaCl secretbox under a
per-tenant key, themselves wrapped by a deploy-environment master key;
the plaintext never lands on disk in the database. See `/security` for
the full secrets-at-rest writeup.

## 2. Retention defaults

These are the **stated defaults**. As of 2026-05-02 the platform does
not yet run a scheduled retention sweep — no `apps/api/src/jobs`-style
prune job exists. The defaults below describe the policy we will
enforce; the job that enforces them is on the roadmap as part of the
billing tier work and lands in a follow-up wave. Until then, we do not
delete run history except on explicit customer request (§4); customers
who require enforced retention today should ask for it as part of their
contract.

| Tier | Run history (runs + run events + checkpoints) | Datasets, evaluators, agent specs | Audit log |
|---|---|---|---|
| **Free / trial** | 30 days | Kept until you delete them | 13 months |
| **Solo ($29/mo)** | 30 days | Kept until you delete them | 13 months |
| **Team ($99/mo)** | 90 days | Kept until you delete them | 13 months |
| **Enterprise** | Configurable per-contract (default 90 days, max 7 years) | Kept until you delete them | Contract-defined, 13 months minimum |

A "run" includes the full message tree and tool-call payloads. After
the retention window the run row and its events are deleted; the
parent agent spec, dataset, and eval suite remain.

The audit log retention is set by legal-hold rules (§4) and is **not**
affected by deleting a run — we keep an audit-log entry that the run
existed and was deleted, even after the run itself is gone.

## 3. Privacy tiers

ALDO AI's strongest data-handling guarantee is enforced in the
platform, not in the agent author's code. Every agent declares a
`privacy_tier`:

- `public` — may be routed to any provider, including frontier cloud
  models.
- `internal` — restricted to providers your tenant has explicitly
  approved.
- `sensitive` — **physically incapable of reaching a cloud model.**
  The model gateway drops the call before it leaves the trust
  boundary; this is enforced at the router, not by convention. An
  agent author cannot bypass this from inside the agent.

This is the platform's strongest invariant (see CLAUDE.md
"Non-negotiable constraints" #3 and the `/security` page). If an agent
that processes your data is marked `sensitive`, that data does not
leave the local-model boundary even if a downstream agent author makes
a mistake.

## 4. Deletion

### 4.1 How to request deletion

For now, deletion is operator-mediated:

> Email **info@aldo.tech** with the subject line `Deletion request:
> <your tenant slug>` and one of: (a) "delete my entire tenant
> including all members, agents, runs, datasets, and evals", or
> (b) a specific scope ("delete all runs older than X", "delete this
> dataset", "remove my account from this tenant").

We will acknowledge within two business days and complete the
deletion within **30 days** of acknowledgement. A self-serve deletion
flow under `/settings/account` is on the roadmap; until it ships,
the email path is canonical.

### 4.2 What "delete" means here

When we delete a tenant or run:

- The Postgres rows are removed.
- Application-level caches (eval result cache, run-tree cache,
  notification feed) are invalidated within 24 hours.
- Encrypted secrets are zeroed out of the secrets table; the wrapping
  key is rotated for that tenant.

### 4.3 What we keep after deletion (legal hold)

We retain the **audit-log entry** of the deletion event itself for the
audit-log window (13 months) so that we can answer "was this account
ever a customer, and when was it deleted?" for compliance
investigations and chargeback disputes. The audit-log entry contains
the tenant id, the actor who initiated the deletion, the requested
scope, and the completion timestamp — it does **not** contain any of
the deleted content (no message bodies, no eval results, no provider
keys).

If you need a deletion that does not leave even an audit-log
entry — for example, a data-subject "right to erasure" claim under
GDPR Article 17 that the audit retention period does not satisfy — say
so explicitly in your deletion email and we will handle it as a
hand-processed legal request.

### 4.4 Backups

We do not run a customer-visible backup schedule today (see
[`runbook.md`](./runbook.md) §4). Deletion therefore propagates
immediately to the only copy that exists. When we add scheduled
backups, deletion guarantees will be re-stated to cover the backup
retention window.

## 5. Sub-processors

Today we use the following sub-processors. Inclusion in this list does
**not** mean your data is sent to them — it means it *may* be sent,
subject to the privacy tier of the agent processing the data and to
your explicit configuration.

| Sub-processor | Purpose | When your data reaches them |
|---|---|---|
| **Anthropic** | Claude family models | Only when an agent's `privacy_tier` permits cloud routing AND your tenant has uploaded an Anthropic provider key OR opted into our cloud-credit pool (Team plan) |
| **OpenAI** | GPT family models | Same conditions as Anthropic |
| **Google** | Gemini family models | Same conditions as Anthropic |
| **Stripe** | Subscription billing for Solo / Team plans | Card data is collected by Stripe directly via Checkout; we never see the PAN. Email + billing address may transit our servers |
| **Hosting provider (VPS)** | Single-tenant infrastructure for ai.aldo.tech | All persisted data lives here. The provider is a single-VPS host; provider name is **TBD** in this document — see the upcoming sub-processor schedule on `/security` for the canonical disclosure |

A few things to note explicitly:

- **You can opt out of any cloud provider** by setting an agent's
  `privacy_tier` to `sensitive`. The router drops cloud calls for that
  agent regardless of which keys you have uploaded.
- **No analytics or marketing trackers** are loaded on authenticated
  pages. Marketing pages may use first-party server-side request logs
  for aggregate statistics.
- **No logging / observability sub-processor** today (no Datadog, no
  Sentry, no LogRocket). Logs live on the VPS only. This is a gap,
  not a feature; if and when we add one we will list it here and
  notify customers in advance per §6.

We will give **30 days' notice** before adding a new sub-processor that
processes customer content. Sub-processors that touch only operational
metadata (e.g. an uptime-monitoring service that pings `/health`) may
be added with notice but without a waiting period.

## 6. GDPR posture

Honest read:

- **Data subject rights** (access, rectification, deletion, portability):
  supported via `info@aldo.tech` per §4. Self-serve flows are on the
  roadmap.
- **Lawful basis**: contract performance for paying customers,
  legitimate interest for trial users.
- **Data Processing Agreement (DPA) template**: not yet drafted.
  Enterprise contracts can have a DPA negotiated bilaterally; a
  template that Solo / Team customers can sign without negotiation is
  on the roadmap (ROADMAP Tier 5.5).
- **EU data residency**: not available. Today the platform deploys to
  a single region. EU residency is on the roadmap as a quarter-scale
  build (ROADMAP Tier 3.4) and will be tackled when a confirmed EU
  customer asks for it.
- **International data transfers**: data may transit to US-based cloud
  model providers (Anthropic, OpenAI, Google) under Standard
  Contractual Clauses by default. The `sensitive` privacy tier blocks
  this entirely.
- **Breach notification**: we will notify affected customers within 72
  hours of confirming a breach that involves their data, and notify
  the relevant supervisory authority where required.

We will not claim a posture we have not earned. SOC 2, HIPAA, ISO
27001, and FedRAMP are all explicitly **not** in place today. See the
[`/security`](https://ai.aldo.tech/security) page and STATUS.md for the
full list.

---

## Changelog

| Date | Change |
|---|---|
| 2026-05-02 | Initial version. |
