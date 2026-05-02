# Customer support intake

> Audience: whoever is on duty for `info@aldo.tech` today. That's the
> founder solo, but this document is written so a future first hire can
> inherit the inbox without re-deriving the rules.
>
> Cross-references: [`docs/runbook.md`](./runbook.md) (operational
> procedures during an incident), [`docs/data-retention.md`](./data-retention.md)
> (deletion requests), [`STATUS.md`](../STATUS.md) (what is live and
> what is known broken).

---

## 1. The inbox

**`info@aldo.tech`** is the canonical customer-support address. It is
also the responsible-disclosure address (per [`/security`](https://ai.aldo.tech/security))
and the enterprise-sales address (per `/pricing`). Every public page
that asks "how do I reach a human?" points here.

When volume warrants splitting (estimated trigger: ~50 inbound
emails/week), spawn dedicated addresses in this order:

1. `security@aldo.tech` — responsible disclosure only.
2. `support@aldo.tech` — paying-customer support.
3. `sales@aldo.tech` — enterprise prospect intake.

`info@` stays as a catch-all and bounces nothing.

## 2. Triage rules — severity matrix

Classify every inbound email into one of P0–P3 within 30 minutes of
landing. The classification drives both the response SLA and whether
to wake the founder (cross-reference `runbook.md` §8).

| Severity | Definition | First-response SLA | Wake the founder? |
|---|---|---|---|
| **P0** | Full outage of `ai.aldo.tech` (login broken for everyone, API returning 5xx on all routes, deploy pipeline blocking a production rollback) | **Within 1 hour, any time of day**. Status page updated within 30 min. | Yes — see runbook §8 |
| **P1** | Major degradation for a paying customer (their tenant cannot run agents, their data is inaccessible, billing is incorrectly charging them) | **Within 4 hours during business hours, 8 hours overnight** | Only if you cannot resolve within 30 min |
| **P2** | Bug with no degradation (a feature is broken in a way that has a workaround, an edge-case error message is wrong, a doc is misleading) | **Within 1 business day** | No |
| **P3** | Feature request, general question, "how do I do X", evaluation inquiry from a prospect | **Within 3 business days** | No |

**Business hours** = 09:00–18:00 Europe/Ljubljana, Mon–Fri. Outside
that, P2 and P3 SLAs pause; P0 and P1 SLAs do not.

If you cannot make a confident call between two severities, pick the
higher one. False-positive P1s are recoverable; false-negative P1s are
not.

## 3. Triage process

For every inbound email:

1. **Read the full thread.** Skim attachments. If the customer
   referenced a run id or agent name, open it in the dashboard before
   you reply.
2. **Classify** using the matrix in §2.
3. **Reply within the SLA** with: (a) acknowledgement of receipt, (b) a
   ticket id (`AAI-YYYYMMDD-NNN`, monotonically increasing per day,
   e.g. `AAI-20260502-001`), and (c) an ETA appropriate to the
   severity. If you can answer immediately, answer immediately and skip
   the ETA.
4. **If engineering work is needed**, file a GitHub issue in the
   `zeljan-alduk/ai` repo. Title format: `[support] <one-line
   summary> (AAI-…)`. Body: customer-anonymised reproduction steps,
   the run id if applicable, the relevant log excerpt, the proposed
   fix tier (P0–P3 mapping). Link the issue back in your reply to the
   customer with "tracked as #N".
5. **If a security report**, do **not** open a public GitHub issue.
   Reply per the responsible-disclosure section of `/security`,
   acknowledge within 2 business days, and discuss the fix and
   credit privately. File a private security advisory in GitHub when
   the fix is in flight.
6. **Update the status page** for any P0 within 30 minutes of
   confirming the incident, with a fresh update at least every 60
   minutes until resolved. Post the resolution and a one-line root
   cause when closed.
7. **Log the ticket in the audit log.** For now, append a one-line
   entry to `DEVELOPMENT_LOG.txt`: timestamp, ticket id, severity,
   one-line resolution. This is the only record we have until a
   ticketing tool is in place.

## 4. Status page

Live at **https://ai.aldo.tech/status** (page is being built in a
sibling task this wave; if you are reading this before that page ships,
the URL will 404 — the policy still applies the moment it is up).

Status page must show:

- A green / yellow / red banner for current platform health.
- The most recent five incidents with their resolution.
- A subscription form for email updates (TBD if not implemented yet —
  for now point customers to following the page directly).

Update cadence during an incident:

| Phase | Cadence |
|---|---|
| Incident detected, root cause unknown | Every 30 min |
| Root cause known, fix in flight | Every 60 min |
| Fix deployed, monitoring | One update at deploy + one at "all clear" 30 min later |
| Postmortem | Within 72 hours of all-clear |

If you cannot update on time, post "still investigating, next update
at HH:MM" — silence is worse than slow.

## 5. SLA wording for paid plans

The pricing page (`/pricing`) is intentionally short on legalese; it
points support-related questions to email. The implicit SLA mirrors
the matrix above. When a paying customer asks for an SLA in writing,
respond with:

| Plan | First-response SLA | Resolution targets | Uptime commitment |
|---|---|---|---|
| **Solo ($29/mo)** | Best effort, P2/P3 within 1–3 business days. P0/P1 same as Team. | None contractually | None contractually |
| **Team ($99/mo)** | P0 within 1 hour, P1 within 4 business hours, P2 within 1 business day, P3 within 3 business days | None contractually; we publish status and post-mortems | None contractually; status page is the authoritative record |
| **Enterprise** | Negotiated per contract; our default offer is P0/1h, P1/2 business hours, P2/4 business hours | Negotiated per contract | 99.5% monthly uptime default; service credits for missed targets |

Cross-reference plan tiers on `/pricing`. Do **not** offer Solo or
Team customers a contractual uptime guarantee — we have a single VPS
deploy without a measured uptime baseline; promising one would be
material misrepresentation.

If a customer asks for a written SLA and they're on Solo or Team,
quote the table above and offer to escalate to Enterprise pricing if
they need contractual targets.

## 6. Escalation

Today the escalation chain is **solo operator → solo founder → end of
chain**. The chain is documented anyway so the eventual second hire
inherits the sequence rather than reconstructing it.

| Step | Who | When |
|---|---|---|
| L1 | Whoever is on the inbox | All inbound. Resolve P2/P3 directly. |
| L2 | On-call operator | P0 / P1, or any L1 ticket the operator cannot resolve within the SLA |
| L3 | Founder | P0, suspected security incident, contractual / legal question, refund request >$200, anything that could become a public statement |
| External counsel | Founder decides | GDPR data-subject claim that can't be answered with §4 of `data-retention.md`, regulatory inquiry, subpoena, anything where the founder needs legal sign-off |

Today L1 = L2 = L3 = founder. The matrix exists so that when L1 is a
new hire, they know the rule is "I handle P2/P3 and the deletion
workflow; I escalate everything else to the founder same day." This
keeps the founder's inbox to actual escalations rather than the
day-to-day.

## 7. Common requests — playbook

Quick references for the highest-frequency support patterns. These
should be answerable from the L1 seat.

| Request | Action |
|---|---|
| "How do I delete my account / data?" | Walk through `data-retention.md` §4. Confirm scope in the reply. Process within 30 days. |
| "I forgot my password" | Today: operator-mediated reset. Generate a one-time password, hand off via the customer's verified email. Self-serve reset is on the roadmap. |
| "Stripe charged me incorrectly" | Verify in Stripe dashboard, refund via Stripe if confirmed, reply with the refund confirmation. P1 if the charge is wrong; P2 if disputed but plausibly correct. |
| "Can I get a copy of my data?" | Generate a JSON export of the customer's tenant (agents + runs + datasets + eval results). For now this is a manual `pg_dump --table=…` filtered to their tenant id; 30-day SLA. Self-serve export is on the roadmap. |
| "Is X SOC 2 / HIPAA / GDPR compliant?" | Point to `/security` and `data-retention.md`. Answer is "no SOC 2, no HIPAA today; partial GDPR; we can self-host for compliance-sensitive workloads." Don't soften this. |
| "Can I self-host?" | Yes — Enterprise tier. Pass to the founder. Note in STATUS.md the published Helm chart is not yet shipped (ROADMAP 3.3); be honest if the customer wants to deploy themselves today. |
| "I think I found a bug / security issue" | Bug → P2, file an issue. Security → §3 step 5, do not file public issue. |

---

## Changelog

| Date | Change |
|---|---|
| 2026-05-02 | Initial version. |
