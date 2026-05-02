# ALDO AI — Terraform modules

> **Licensed under FSL-1.1-ALv2.**

Three thin per-cloud modules that provision a Kubernetes cluster and
release the `charts/aldo-ai` Helm chart in one apply.

```
terraform/
├── README.md           ← you are here
├── aws-eks/            EKS + VPC-CNI w/ NetworkPolicy + Helm release
├── gcp-gke/            GKE Dataplane V2 + Helm release
└── azure-aks/          AKS + Azure CNI + Calico + Helm release
```

## Choosing a module

| | EKS | GKE | AKS |
|---|---|---|---|
| Network policy | VPC-CNI add-on (`enableNetworkPolicy`) | Dataplane V2 (Cilium) | Calico (default) or Azure |
| Workload Identity | IRSA via `serviceAccount.annotations` | GCP WI via `serviceAccount.annotations` | Azure WI + OIDC issuer |
| Pre-existing VPC required | yes (pass `subnet_ids`) | no (default network OK) | no (module creates RG) |
| Default node SKU | `m6i.large` | `e2-standard-4` | `Standard_D4s_v5` |

Pick the cloud, copy that module's quick-start from its README, fill in
a `prod.tfvars`, run `terraform apply`.

## Common pattern

Every module:

1. Provisions the cluster + node pool / group.
2. Wires `kubernetes` + `helm` Terraform providers using the cluster's
   own auth.
3. Creates the `aldo-ai` namespace.
4. Optionally creates the `aldo-app-secrets` Secret from a sensitive
   `app_secret_values` map (set `create_app_secret = false` and
   pre-create the Secret yourself in production — keeps the keys out of
   Terraform state).
5. `helm_release`s `../../charts/aldo-ai` with privacy-tier enforcement
   on by default.

## Switching to managed Postgres

The chart bundles a single-node Postgres StatefulSet for first-touch
self-host. For production:

```hcl
postgres = {
  enabled = false
  external = {
    host                       = "aldo-prod.cluster-XXXX.us-east-1.rds.amazonaws.com"
    port                       = 5432
    database                   = "aldo"
    user                       = "aldo"
    existingSecret             = "aldo-postgres-credentials"
    existingSecretPasswordKey  = "password"
    sslMode                    = "require"
  }
}
```

## OCI chart

Until the publish workflow lands, every module references the chart via
the relative path `../../charts/aldo-ai`. Once the chart is published
to `oci://ghcr.io/aldo-tech-labs/charts/aldo-ai`, set
`chart_path = "oci://ghcr.io/aldo-tech-labs/charts/aldo-ai"` and pin
`chart_version`.

## Limitations

- DNS, ACM/Cert-Manager, and the ingress controller itself are out of
  scope. Provision them with your usual modules and reference them via
  `ingress.className` + `ingress.annotations`.
- These modules are `terraform fmt` + `terraform validate` clean. They
  have **not** been applied against a live cloud account in this PR.
- Multi-region / multi-cluster topologies are out of scope — a single
  cluster per module instance.
