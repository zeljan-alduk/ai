---
title: Dataset uploads
summary: Upload JSONL or CSV; bind to suites; share across agents.
---

Datasets are reusable bundles of cases. One dataset can back
multiple suites; multiple suites can target one agent. Versioning
follows the rest of the registry: every push gets a new version,
the live pointer moves explicitly.

## Format

Datasets are JSONL or CSV. JSONL is preferred — it preserves
structured ground-truth fields:

```jsonl
{"input": "Refactor the auth module", "ground_truth": "preserved-public-api", "tags": ["refactor"]}
{"input": "Find the off-by-one", "ground_truth": "loop bound off by one", "tags": ["debug"]}
```

CSV is fine for flat schemas; the column header row determines the
field names.

## Upload

Via CLI:

```bash
aldo dataset push ./changelog-cases.jsonl --name changelog-cases
```

Via the API:

```bash
curl -X POST https://app.aldo-ai.dev/api/auth-proxy/v1/datasets \
  -H "Authorization: Bearer $ALDO_API_KEY" \
  -H "Content-Type: application/x-ndjson" \
  --data-binary @changelog-cases.jsonl
```

## Privacy tier

Datasets carry a privacy tier. A `sensitive` dataset can only be
used by `sensitive` runs — the platform won't bind it to a suite
that runs against a less-strict tier.

## Sharing

A dataset is tenant-scoped by default. To share across tenants,
the operator must explicitly mark it `shared` (only available in
self-hosted deployments).

## Inspecting

The **Datasets** page in the control plane shows row counts, tag
distribution, and a sample of recent rows. Click into a dataset to
see its version history and which suites bind to it.
