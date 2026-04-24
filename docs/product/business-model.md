# Business model

Date: 2026-04-24
Source: principal (user) decision.

## Decision

**Subscription-based SaaS**, standard three-tier structure:

| Tier | Audience | Notes |
|---|---|---|
| **Free / Individual** | Single user, hobbyist, design partner | Caps on runs, agents, trace retention, concurrent sandboxes. Local models fully unlocked. |
| **Team** | Small / mid teams (2–50 seats) | Seats, shared org memory, shared agent registry, SSO lite, standard support. |
| **Enterprise** | 50+ seats, regulated industries | SSO (SAML/OIDC), SCIM, audit log export, custom data residency, BYOK, priority support, SLA, optional self-host add-on. |

This is the conventional SaaS ladder — pricing table, plan-picker, upgrade
CTA, yearly discount, a "contact sales" button on Enterprise.

## Implications for the platform

1. **Multi-tenant from day one.** Every object (agent, run, trace, memory
   entry, cost record) is scoped to a tenant and an organisation. The
   gateway, engine, memory store, and observability all thread
   `TenantId` through `CallContext`. This is already in `@meridian/types`.

2. **Seats and roles.** Team and Enterprise plans need:
   - Seat management (invite, revoke, transfer)
   - Roles: `owner | admin | developer | reviewer | viewer`
   - Role-gated actions (promote agent version, change budgets, see cost)
   - Audit log per tenant

3. **Metering the right things.** Subscription price covers platform
   seats; **LLM token cost is passed through** (users bring their own
   keys) or **metered** on top (we front the keys and mark up). Default
   for v0: BYO-keys; metered add-on deferred to v1.
   Sandbox minutes, trace retention, and concurrent runs are the
   additional meters that differentiate tiers.

4. **Free-tier constraints.** Concrete caps (working numbers — tune on
   design-partner feedback):
   - Free: 1 user, 3 agents, 100 runs/month, 7-day trace retention,
     1 concurrent sandbox, community-tier support.
   - Team ($TBD/seat/mo, annual discount): unlimited agents, 10k
     runs/month/seat, 90-day retention, 10 concurrent sandboxes/seat,
     SSO lite, email support.
   - Enterprise: custom; includes SSO, SCIM, audit export, BYOK,
     data residency, 99.9% SLA, priority support.

5. **Self-host remains a first-class path.** The OSS core (Apache-2.0)
   runs entirely self-hosted with local models; enterprises pay the
   subscription for the **managed control plane** (web UI, trace
   backend, eval dashboard, support). This matches competitors
   (Langfuse, Temporal, CrewAI) and protects the privacy-tier
   positioning — the data plane can stay on-prem even when the
   control plane is SaaS.

6. **Billing stack (v1).** Stripe for card billing, Stripe Billing for
   metered usage, Orb or openmeter as backup if we outgrow Stripe
   Billing's metering. Free-tier usage tracked the same way so caps
   are enforced uniformly.

## What this does NOT decide

- Concrete prices (deferred to design-partner research).
- Token-cost markup % for the future managed-keys add-on.
- Whether "Enterprise" requires a minimum seat count.
- Regional data-residency options (covered under compliance ADR later).

## Status

Accepted. Implementation follows in later ADRs once v0.1 ships.
