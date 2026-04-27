# ALDO AI — 90-day GTM plan

> Internal — not for customer distribution. Last revised: 2026-04-27.

## Goal of these 90 days

End-state on day 90:

- **3 paying logos** (any size, any plan).
- **2 active design partners** (signed NDA, source access, weekly check-ins).
- **1 enterprise pilot** in flight ($30K–250K/yr ACV target).
- **20 qualified discovery calls** banked (notes + objections in CRM).
- **A working content + outreach engine** that doesn't need a daily founder push.

Anything beyond is upside. Anything below is a signal to cut scope or pivot ICP.

## ICP — who we sell to in this 90 days

We are NOT trying to sell to everyone. The privacy-tier story buys us the right
to charge a premium in regulated EU industries. So that's where we go.

**Primary ICP — EU regulated SMEs / mid-market, 50–500 employees, building or
about to build internal LLM tooling.** Three vertical slices, in priority order:

1. **EU healthcare tech** (digital-health platforms, hospital-IT vendors, clinical-AI
   startups). Pain: PHI handling under GDPR + national health-data acts. Title to
   reach: VP Engineering, CTO, Head of AI/ML.
2. **EU financial services / fintech** (challenger banks, regtech, insurance-tech,
   payments). Pain: data-residency, model-risk-management policies, replay/audit.
   Title: Head of Engineering, Head of Compliance Engineering, CTO.
3. **EU government adjacent** (public-sector consultancies, defence-adjacent
   software houses, national-security software vendors). Pain: data sovereignty,
   on-prem requirement. Title: CTO, Engineering Director, Innovation Lead.

**Secondary ICP** (lower priority, only if time): EU AI consultancies and
boutique software houses building agent products for their own clients. They
become resellers, not end customers.

**Disqualified during these 90 days:**

- US enterprises (long sales cycle, requires US presence we don't have).
- Anyone who's never written a line of LLM code (we're not the on-ramp; we're the
  serious tool).
- Hobby developers (worth Solo plan revenue at best; lifecycle cost > LTV).

## Source lists — concrete

### Healthcare (50 leads, week-1 task to enrich)

Targets to research first (companies, not people — find the right title via
LinkedIn during enrichment):

- **DACH region**: Doctolib, CompuGroup Medical, Medical Tribune, Avi Medical,
  Caresyntax, Heartbeat Medical, Klara, Doctorly, Heartbeat Labs portfolio cos.
- **France**: Alan, Owkin, Honestica, Lifen, Therapixel, Inato.
- **Nordics**: Kry, Min Doktor, Coala Life, Anatomical Concepts, Doctrin, Kaiku
  Health, Klinik.
- **Benelux**: Healthplus.ai, Pacmed, MyTomorrows, MedPace, Castor.
- **Spain/Italy**: Mediktor, MIO Health, Synapse Medicine.
- **UK** (post-Brexit but still regulated EU-aligned): Babylon, Cera Care,
  Push Doctor, Patchwork Health, Skin Analytics, Sensyne Health.

### Fintech / financial services (50 leads)

- **Challenger banks**: N26, Vivid Money, Bunq, Tomorrow, Lunar, Klarna,
  Revolut (UK), Wise (UK).
- **Regtech**: ComplyAdvantage (UK), Hawk:AI, Kyriba, Featurespace, Quantexa
  (UK).
- **Payments / fraud**: Adyen, Mollie, Sumup, Trustly, Klarna risk team.
- **Insurance-tech**: Wefox, Ottonova, Bough, Onlia, Element.
- **Asset management / quant**: Scalable Capital, Trade Republic, Liqid.
- **Treasury / B2B fintech**: Pliant, Embat, Toqio, Numeral.

### Government-adjacent / defence-adjacent (30 leads)

- **DACH defence software**: Helsing, Quantum Systems, ARX Robotics, Bayinfra.
- **EU/national consultancies with public-sector practice**: Capgemini Invent,
  Sopra Steria, Atos, Indra, T-Systems, Tieto Evry, Devoteam.
- **Civic-tech / gov-cloud**: STX Next, Allegro.eu (Polish state contracts),
  Mongoose-IT, Eficode (Finland), Karelics, Ginetta.

**How to enrich (week 1):** for each company, find one target person — VP/Head
of Engineering, CTO, or Head of AI — via LinkedIn or Apollo/Hunter. Capture
{name, title, email, linkedin, company, stack-signal (any LangChain/CrewAI/
OpenAI mention in their public material)}. Put in a CSV at
`docs/sales/leads-001.csv` (do NOT commit personal contact info to a public
repo — keep this file gitignored or in a private repo).

## Weekly cadence (what every week looks like)

- **Mon AM** (90 min): Lead enrichment — refresh + add 10 new leads to the
  active queue. Write the week's outbound copy.
- **Mon–Thu** (60 min/day): Send 10–15 outbound emails per day. NEVER
  templated; always customised paragraph 1 referencing something real about
  their company.
- **Tue + Thu PM**: Reply to anyone who replied. Books call. Keep response
  time under 8 hours during EU business hours.
- **Wed eve** (60 min): Write or schedule one piece of content (LinkedIn
  post, /vs page improvement, blog post, demo video).
- **Fri AM** (60 min): Discovery / pilot calls (booked Mon–Thu).
- **Fri PM** (60 min): Pipeline review — update CRM, calculate metrics,
  decide what to cut next week.

**Total founder time: ~10–12 hours/week on GTM.** The rest goes to product.

## Outbound email playbook

### Cold-email template (customise paragraph 1 every time)

> Subject: privacy-tier router for {company}'s agents
>
> Hi {first name},
>
> Saw {specific thing about their company — recent funding, blog post, job
> listing for ML engineer, etc.}. If you're building anything with LLM agents
> over {data type they handle: PHI / PII / financial transactions / classified}
> in the next 12 months, the thing keeping your security team up at night is
> probably this: agents are one prompt away from accidentally calling a cloud
> LLM with regulated data.
>
> We built ALDO AI to make that physically impossible. Privacy tier is a
> property of the agent spec; the router fails closed before any token leaves
> your tenant boundary. Self-host on your own infra; same product as the
> hosted tier.
>
> One-pager: https://ai.aldo.tech/sales/one-pager
> 12-min walkthrough: https://ai.aldo.tech/deck
>
> Worth 25 minutes to see if it fits? I have a few slots Wed/Thu next week.
>
> {sig}

### Reply rate expectations

- Cold email reply rate: **3–6%** if paragraph 1 is genuinely customised.
  Lower if templated.
- Of replies, **30–50%** convert to a discovery call.
- Of discovery calls, **20–30%** convert to a pilot conversation.
- Of pilot conversations, **30–50%** convert to a paid pilot or design-partner
  contract.
- Math: 50 emails/week → 2 replies → 1 call → 1 pilot conversation per month →
  1–2 paying customers per quarter from cold alone.

### Inbound levers (compound interest)

- One LinkedIn post per week. Topic = a real lesson from this week's product
  work, not marketing. Best performers: "we found a CodeQL XSS in our docs
  loader, here's the fix"; "running 13B Qwen vs Claude on an agent eval".
- One technical blog post per fortnight on `ai.aldo.tech/blog` (yet to build).
  Topics: privacy-tier enforcement, local-vs-frontier eval results, MCP server
  patterns.
- Reply to 5 LangChain/CrewAI threads on HackerNews or Reddit per week with a
  substantive answer + a link only if asked. Goal: become a recognised voice
  before being a known vendor.

## Week-by-week milestones

### Weeks 1–2: foundation

- [ ] Enrich initial 130 leads into a CRM (Notion, HubSpot, or Pipedrive) with
      {name, title, email, linkedin, vertical, last-touch}.
- [ ] Write the cold-email template above; A/B test 2 subject lines on the
      first 30 sends.
- [ ] Get the trial signup flow tight — measure time from email click to first
      agent run. Should be < 5 minutes.
- [ ] Make sure the one-pager + deck links work end-to-end. Send to 3 trusted
      friends for blunt feedback before sending to a real prospect.

### Weeks 3–4: first sends

- [ ] 50 outbound emails per week. Healthcare vertical first (smallest, highest
      privacy pain).
- [ ] Goal: 3–5 replies. 1–2 discovery calls.
- [ ] Add the 5 best objections from those calls to a `docs/sales/faq.md` and
      update the website to address them.
- [ ] First LinkedIn post.

### Weeks 5–6: tighten + expand

- [ ] Add fintech vertical to the outbound. 50 emails/week split 30 healthcare
      / 20 fintech.
- [ ] Goal: 5–10 replies, 2–3 discovery calls, **first design-partner
      conversation** in flight.
- [ ] First technical blog post live.
- [ ] Update the deck / one-pager based on real objections heard so far.

### Weeks 7–8: design-partner closes

- [ ] Goal: **first signed design partner** (NDA + access; no money yet).
- [ ] Add gov-adjacent vertical to outbound. 50 emails/week split across all
      three.
- [ ] First Solo plan signups should appear from any inbound (LinkedIn,
      blog). If not, the content isn't doing its job — review and adjust.

### Weeks 9–10: first paid

- [ ] Goal: **first paying customer** (any plan, any size).
- [ ] Goal: second design partner signed.
- [ ] First case study / customer quote (with permission) — even a one-liner
      on the homepage trust strip is worth a quarter of marketing.
- [ ] Pilot conversation with one mid-market enterprise prospect.

### Weeks 11–12: pilot in flight

- [ ] Goal: **enterprise pilot SOW signed.** $30K–250K/yr ACV target. 60-day
      paid pilot, named owner on our side, security questionnaire, DPA.
- [ ] Goal: 3 paying logos total.
- [ ] Decide: do we keep selling solo, or do we hire a part-time SDR for
      Q2? (Decision criterion: if outbound reply rate has stayed > 4% AND
      we're capacity-bound on calls, hire. Otherwise, don't.)

## What to measure (weekly)

| Metric | Target by week 12 |
|---|---|
| Outbound emails sent | 600+ cumulative |
| Reply rate | > 4% rolling 4-week |
| Discovery calls held | 20+ cumulative |
| Pilot conversations | 5+ cumulative |
| Paying logos | 3 |
| Design partners | 2 |
| Self-serve trial signups | 30+ cumulative |
| Trial → paid conversion | > 8% |
| Inbound : outbound mix | 30% : 70% by week 12 |
| Content shipped | 10 LinkedIn posts + 4 blog posts |

If reply rate falls below 2% for two consecutive weeks: stop, rewrite the
template, change the ICP slice, or both. Don't grind on a broken funnel.

## Pricing-conversation playbook (notes)

- **Trial → Solo** is for individual builders; don't waste time on these in
  outbound. They self-serve.
- **Team plan** is the natural mid-market entry. $99/mo is below most
  procurement thresholds — sells via founder contact.
- **Enterprise** is a custom contract. Anchor at €60K/yr base + €0.05/run + EU
  self-host. Be willing to discount the base for design partners.
- **Pilot pricing**: 60-day paid pilot at €5K. Apply to year-1 contract if they
  convert. Cheaper than a free pilot — paid skin = serious prospect.

## Things to NOT do in these 90 days

- **No fundraising conversations.** Capital chases revenue; the order matters.
  Get the 3 logos first.
- **No paid ads.** Wrong tool for $99-$5K-$60K ACV. Outbound + content beats
  Google Ads at this stage.
- **No new features that aren't from a paying customer's mouth.** Every
  feature request goes in a backlog; only ship if 2+ paying or pilot accounts
  ask for it.
- **No US-enterprise outbound.** Sales cycle is 6–12 months. We don't have the
  runway.
- **No conferences** (unless free + walking distance). ROI is poor at this
  stage.

## Risks + counterplays

| Risk | Counterplay |
|---|---|
| Reply rate < 2% | Switch ICP slice; rewrite copy; consider warm intros via design partners |
| First paying customer churns at month 2 | Treat as the most important data; do a full post-mortem; refund if needed; turn into a case study about the ICP we got wrong |
| Founder runs out of energy on outbound | Hire a part-time SDR or virtual assistant to enrich + book; founder only does the discovery calls |
| Bigger competitor announces a privacy-tier feature | Don't panic — they will ship it as a config flag, not the architecture. Sharpen the "ours is platform-level, theirs is convention" message |
| EU AI Act compliance becomes urgent for prospects | Move FAST — this is the wedge. Publish an EU-AI-Act mapping page within 2 weeks of any major ruling |

## Call notes — mandatory format for every discovery call

After every call, log:

1. **Who** (name, title, company, LinkedIn).
2. **The one sentence** they said about the problem.
3. **Their current stack** (LangChain? CrewAI? Custom? Nothing?).
4. **The objection** that almost killed the deal.
5. **Next step** with a date.
6. **Disqualified or qualified** — and why.

Quarterly: review all call notes. The pattern in objections is the next
landing-page improvement.

---

That's the plan. Update this doc weekly with what you learned and what
worked. The plan that doesn't change every two weeks isn't being executed.
