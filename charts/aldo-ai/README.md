# ALDO AI — Helm chart

> **Licensed under FSL-1.1-ALv2.** See repo root [`LICENSE`](../../LICENSE).

Self-host the ALDO AI control plane (api + web + Postgres) on any
conformant Kubernetes ≥ 1.27 cluster. Closes the LangSmith Self-Hosted
v0.13 competitive gap; backs the Enterprise tier's "packaged build"
claim with an actual deployable artifact.

```
charts/aldo-ai
├── Chart.yaml
├── README.md                 ← you are here
├── values.yaml               ← every knob, with defaults
├── templates/
│   ├── _helpers.tpl
│   ├── NOTES.txt
│   ├── api-deployment.yaml
│   ├── api-service.yaml
│   ├── api-hpa.yaml
│   ├── configmap.yaml
│   ├── ingress.yaml
│   ├── migrations-job.yaml          (helm.sh/hook: post-install,post-upgrade)
│   ├── networkpolicy.yaml           (privacy-tier enforcement)
│   ├── pdb.yaml
│   ├── postgres-secret.yaml         (random-password init, kept across upgrades)
│   ├── postgres-service.yaml        (headless)
│   ├── postgres-statefulset.yaml
│   ├── secret.yaml                  (placeholder Secret — dev only)
│   ├── serviceaccount.yaml
│   ├── web-deployment.yaml
│   ├── web-service.yaml
│   └── web-hpa.yaml
└── values-examples/
    ├── values-minikube.yaml
    └── values-prod.yaml
```

## TL;DR

```bash
# Local kind / minikube — bundled Postgres, no ingress, port-forward to test.
helm install aldo-ai ./charts/aldo-ai \
  -n aldo-ai --create-namespace \
  -f charts/aldo-ai/values-examples/values-minikube.yaml

kubectl port-forward -n aldo-ai svc/aldo-ai-web 8080:8080
open http://localhost:8080

# Production — BYO managed Postgres + real ingress + privacy-tier enforced.
helm install aldo-ai ./charts/aldo-ai \
  -n aldo-ai --create-namespace \
  -f charts/aldo-ai/values-examples/values-prod.yaml
```

## Limitations (read first)

This chart was authored without access to a live Kubernetes cluster. We
ship it confident that:

- `helm lint charts/aldo-ai/` passes
- `helm template charts/aldo-ai/ --debug` emits valid manifests
- `helm install --dry-run` followed by `kubectl apply --dry-run=client`
  parses every manifest

…and not yet that:

- A real cluster install converges to Ready (no e2e smoke against a
  real EKS/GKE/AKS in this PR).
- The chart is published to an OCI registry. Today you reference it from
  the repo. A `helm push oci://ghcr.io/aldo-tech-labs/charts/aldo-ai`
  workflow is on the roadmap.
- Container images at `ghcr.io/aldo-tech-labs/aldo-{api,web}` are public.
  The Dockerfiles ship in the repo (`apps/api/Dockerfile`,
  `apps/web/Dockerfile`); customers can build + push to a private
  registry and override `image.{api,web}.repository` until the public
  publish workflow lands.
- AWS IRSA / GCP Workload Identity / Azure Workload Identity bindings
  are scaffolded in `serviceAccount.annotations` but not pre-wired —
  see [`terraform/`](../../terraform/) for the per-cloud module that
  fills these in.

## Prerequisites

| | Version |
|---|---|
| Kubernetes | ≥ 1.27 |
| Helm | ≥ 3.13 |
| CNI with NetworkPolicy enforcement | required if `privacyTier.enforced: true` (Calico, Cilium, Antrea, EKS w/ NP plugin, GKE Dataplane V2, AKS w/ Azure NP) |
| Ingress controller | required if `ingress.enabled: true` (NGINX, Traefik, Istio Gateway, etc.) |
| StorageClass with `WaitForFirstConsumer` binding | recommended for the bundled Postgres PVC |

## Install

```bash
# 1. Create the namespace + a Secret holding your provider keys.
kubectl create namespace aldo-ai
kubectl create secret generic aldo-app-secrets -n aldo-ai \
  --from-literal=ANTHROPIC_API_KEY=sk-ant-... \
  --from-literal=OPENAI_API_KEY=sk-... \
  --from-literal=JWT_SIGNING_KEY=$(openssl rand -hex 32)

# 2. Install.
helm install aldo-ai ./charts/aldo-ai \
  -n aldo-ai \
  -f my-values.yaml
```

## Upgrade

```bash
helm upgrade aldo-ai ./charts/aldo-ai -n aldo-ai -f my-values.yaml
```

The post-upgrade migrations Job runs first; the api Deployment rolls
only after migrations succeed.

## Uninstall

```bash
helm uninstall aldo-ai -n aldo-ai
```

The Postgres PVC is **kept** by Helm by default. To wipe data:

```bash
kubectl delete pvc -n aldo-ai -l app.kubernetes.io/component=postgres
kubectl delete secret -n aldo-ai aldo-ai-postgres   # password kept across reinstalls
```

## Values reference

> Run `helm show values ./charts/aldo-ai` to dump the canonical defaults.

### Images

| Key | Default | Notes |
|---|---|---|
| `image.registry` | `ghcr.io` | |
| `image.pullPolicy` | `IfNotPresent` | |
| `image.api.repository` | `aldo-tech-labs/aldo-api` | Image not yet published — build locally + override until the publish workflow lands. |
| `image.api.tag` | `""` (= `Chart.AppVersion`) | |
| `image.web.repository` | `aldo-tech-labs/aldo-web` | |
| `image.web.tag` | `""` (= `Chart.AppVersion`) | |
| `imagePullSecrets` | `[]` | List of `{name: ...}` entries. Create the dockerconfigjson Secret out of band. |

### Replicas + autoscaling

| Key | Default | Notes |
|---|---|---|
| `replicas.api` | `2` | Ignored when `autoscaling.api.enabled: true`. |
| `replicas.web` | `2` | Ignored when `autoscaling.web.enabled: true`. |
| `autoscaling.api.enabled` | `false` | Requires `metrics-server`. |
| `autoscaling.api.minReplicas` | `2` | |
| `autoscaling.api.maxReplicas` | `10` | |
| `autoscaling.api.targetCPUUtilizationPercentage` | `70` | |
| `autoscaling.api.targetMemoryUtilizationPercentage` | `80` | |
| `autoscaling.web.enabled` | `false` | |
| `autoscaling.web.minReplicas` | `2` | |
| `autoscaling.web.maxReplicas` | `6` | |
| `autoscaling.web.targetCPUUtilizationPercentage` | `70` | |

### Resources

| Key | Default |
|---|---|
| `resources.api.requests.cpu` | `250m` |
| `resources.api.requests.memory` | `512Mi` |
| `resources.api.limits.cpu` | `2` |
| `resources.api.limits.memory` | `2Gi` |
| `resources.web.requests.cpu` | `100m` |
| `resources.web.requests.memory` | `256Mi` |
| `resources.web.limits.cpu` | `1` |
| `resources.web.limits.memory` | `1Gi` |

### Pod scheduling + security

| Key | Default | Notes |
|---|---|---|
| `serviceAccount.create` | `true` | |
| `serviceAccount.name` | `""` | Generated when blank. |
| `serviceAccount.annotations` | `{}` | IRSA / Workload Identity bindings. |
| `podSecurityContext.runAsNonRoot` | `true` | |
| `podSecurityContext.runAsUser` | `1000` | |
| `podSecurityContext.fsGroup` | `1000` | |
| `containerSecurityContext.allowPrivilegeEscalation` | `false` | |
| `containerSecurityContext.readOnlyRootFilesystem` | `false` | Next.js writes the build cache; flip to `true` once the cache moves to an emptyDir. |
| `containerSecurityContext.capabilities.drop` | `[ALL]` | |
| `nodeSelector` | `{}` | |
| `tolerations` | `[]` | |
| `affinity` | `{}` | |
| `topologySpreadConstraints` | `[]` | |
| `podAnnotations` | `{}` | |
| `podLabels` | `{}` | |

### Service

| Key | Default |
|---|---|
| `service.api.type` | `ClusterIP` |
| `service.api.port` | `8080` |
| `service.api.annotations` | `{}` |
| `service.web.type` | `ClusterIP` |
| `service.web.port` | `8080` |
| `service.web.annotations` | `{}` |

### Ingress

| Key | Default | Notes |
|---|---|---|
| `ingress.enabled` | `false` | |
| `ingress.className` | `nginx` | |
| `ingress.annotations` | `{}` | cert-manager / proxy-body-size go here. |
| `ingress.hosts.web` | `aldo.example.com` | |
| `ingress.hosts.api` | `api.aldo.example.com` | |
| `ingress.tls.enabled` | `true` | |
| `ingress.tls.secretName` | `aldo-tls` | cert-manager populates. |

### Postgres (bundled)

| Key | Default | Notes |
|---|---|---|
| `postgres.enabled` | `true` | Set `false` to BYO. |
| `postgres.image.repository` | `postgres` | |
| `postgres.image.tag` | `16-alpine` | |
| `postgres.database` | `aldo` | |
| `postgres.user` | `aldo` | |
| `postgres.passwordSecret.create` | `true` | When `false`, pre-create with `passwordSecret.name`. |
| `postgres.passwordSecret.name` | `""` | Defaults to `<release>-aldo-ai-postgres`. |
| `postgres.passwordSecret.key` | `postgres-password` | |
| `postgres.storage.size` | `20Gi` | |
| `postgres.storage.storageClass` | `""` | Cluster default. |
| `postgres.storage.accessModes` | `[ReadWriteOnce]` | |
| `postgres.resources.*` | sane defaults | |
| `postgres.service.port` | `5432` | |

### Postgres (external — BYO)

| Key | Default | Notes |
|---|---|---|
| `postgres.external.host` | `""` | Required when `postgres.enabled: false`. |
| `postgres.external.port` | `5432` | |
| `postgres.external.database` | `aldo` | |
| `postgres.external.user` | `aldo` | |
| `postgres.external.existingSecret` | `""` | Required when `postgres.enabled: false`. |
| `postgres.external.existingSecretPasswordKey` | `password` | |
| `postgres.external.sslMode` | `require` | |

### Migrations job

| Key | Default | Notes |
|---|---|---|
| `migrations.enabled` | `true` | Belt + suspenders — API also migrates on boot. |
| `migrations.ttlSecondsAfterFinished` | `600` | |
| `migrations.backoffLimit` | `2` | |
| `migrations.resources.*` | sane defaults | |

### Application config

| Key | Default | Notes |
|---|---|---|
| `config.nodeEnv` | `production` | |
| `config.defaultPrivacy` | `internal` | When an agent spec omits `privacy_tier`. |
| `config.runUsdCap` | `1.00` | Hard kill-switch per run, USD. |
| `config.apiPublicUrl` | `""` | Set when web fetches the api over the public ingress. |
| `config.webPublicUrl` | `""` | |

### Secrets

| Key | Default | Notes |
|---|---|---|
| `secrets.bringYourOwnSecret` | `true` | **Use BYO in production.** |
| `secrets.name` | `aldo-app-secrets` | Pre-existing Secret name. |
| `secrets.values.*` | empty strings | Used **only** when `bringYourOwnSecret: false`. **WARNING:** values land in the Helm release — dev only. Plumb provider keys via ExternalSecretsOperator / SealedSecrets / Vault Agent in real deployments. |

Recognised keys (mirrors `.env.example`):
`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`, `GROQ_API_KEY`,
`OPENROUTER_API_KEY`, `XAI_API_KEY`, `OLLAMA_BASE_URL`, `VLLM_BASE_URL`,
`LLAMACPP_BASE_URL`, `LM_STUDIO_BASE_URL`, `TGI_BASE_URL`, `S3_ENDPOINT`,
`S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_BUCKET`,
`OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_EXPORTER_OTLP_HEADERS`,
`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SIGNING_SECRET`, `STRIPE_PRICE_SOLO`,
`STRIPE_PRICE_TEAM`, `STRIPE_PRICE_ENTERPRISE`,
`STRIPE_BILLING_PORTAL_RETURN_URL`, `STRIPE_PUBLISHABLE_KEY`,
`JWT_SIGNING_KEY`.

### Privacy tier

| Key | Default | Notes |
|---|---|---|
| `privacyTier.enforced` | `true` | NetworkPolicy egress isolation for sensitive pods. CLAUDE.md non-negotiable #3. |
| `privacyTier.allowedEgressCIDRs` | `[]` | Per-CIDR exceptions for VPC-local local-LLM gateways. |
| `privacyTier.sensitivePodLabels` | `{aldo.tech/privacy-tier: sensitive}` | Pod-label match for the policy. The router stamps this onto sub-agent pods. |

### Probes

`probes.api.{liveness,readiness}.{path,initialDelaySeconds,periodSeconds,timeoutSeconds,failureThreshold}` — defaults match the Dockerfile HEALTHCHECK.

`probes.web.{liveness,readiness}.*` — same shape.

### PodDisruptionBudget

| Key | Default | Notes |
|---|---|---|
| `pdb.api.enabled` | `true` | Auto-skipped when `replicas.api < 2`. |
| `pdb.api.minAvailable` | `1` | |
| `pdb.web.enabled` | `true` | Auto-skipped when `replicas.web < 2`. |
| `pdb.web.minAvailable` | `1` | |

### Extra env

| Key | Default |
|---|---|
| `extraEnv` | `[]` — list of `{name, value}` entries appended to api + web pods. |

## Verifying the chart locally

```bash
# Static lint.
helm lint charts/aldo-ai

# Render templates with each example values file.
helm template aldo-ai charts/aldo-ai \
  -f charts/aldo-ai/values-examples/values-minikube.yaml --debug

helm template aldo-ai charts/aldo-ai \
  -f charts/aldo-ai/values-examples/values-prod.yaml --debug

# Offline server-side validation.
helm template aldo-ai charts/aldo-ai > /tmp/manifests.yaml
kubectl apply --dry-run=client -f /tmp/manifests.yaml
```

CI runs all three on every PR touching `charts/**` —
see [`.github/workflows/helm-chart.yml`](../../.github/workflows/helm-chart.yml).

## Operating notes

- **Postgres password** is randomly generated on first install and held by
  the chart-managed Secret with `helm.sh/resource-policy: keep`. Don't
  delete it — the StatefulSet's PVC encrypts data with it.
- **Privacy tier** enforcement requires a NetworkPolicy-aware CNI. EKS
  needs the official Network Policy add-on or Calico; GKE needs
  Dataplane V2; AKS needs `--network-policy=calico` or `azure`.
- **Migrations** run on every install + upgrade, pre-flight. The api
  also runs them on boot (`apps/api/src/index.ts`); the Job exists so we
  surface failures before rolling pods.
- **Replay bundles** (S3): when `S3_*` env is set, the API exports
  replay bundles to object storage. Without it, replays stay local.
- **OpenTelemetry**: set `OTEL_EXPORTER_OTLP_ENDPOINT` to ship spans to
  Phoenix / Langfuse / any OTLP backend.

## Known follow-ups

These are tracked in [`ROADMAP.md`](../../ROADMAP.md):

- Publish the chart to OCI registry (`oci://ghcr.io/aldo-tech-labs/charts`).
- Publish container images to public ghcr (`aldo-api`, `aldo-web`).
- Real-cluster e2e smoke (kind in CI; per-cloud nightly).
- Wire `ALDO_MIGRATE_AND_EXIT` short-circuit in `apps/api/src/index.ts`
  so the migrations Job exits cleanly instead of being killed by
  `activeDeadlineSeconds`.
- Per-cloud IRSA / Workload Identity templates.
- Optional: bundle Redis (rate-limit), Loki (logs), Tempo (traces) as
  sub-charts behind feature flags.
