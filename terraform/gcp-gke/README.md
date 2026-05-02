# ALDO AI on GCP GKE — Terraform module

> **Licensed under FSL-1.1-ALv2.**

Provisions a regional GKE cluster (Dataplane V2 — Cilium-backed
NetworkPolicy enforcement built-in), one auto-scaling node pool, and a
Helm release of `charts/aldo-ai`.

## Prerequisites

- GCP project with the GKE + Container Registry APIs enabled.
- `gcloud auth application-default login` executed.
- Terraform ≥ 1.5.

## Quick start

```bash
cat > prod.tfvars <<'EOF'
project_id   = "my-aldo-prod"
region       = "europe-west1"
cluster_name = "aldo-ai-prod"

ingress = {
  enabled    = true
  className  = "nginx"
  hosts = {
    web = "aldo.example.com"
    api = "api.aldo.example.com"
  }
  tls = {
    enabled    = true
    secretName = "aldo-tls"
  }
}

app_secret_values = {
  ANTHROPIC_API_KEY = "sk-ant-..."
  OPENAI_API_KEY    = "sk-..."
  JWT_SIGNING_KEY   = "<openssl rand -hex 32>"
}
EOF

terraform init
terraform apply -var-file=prod.tfvars

$(terraform output -raw kubeconfig_command)
kubectl get pods -n aldo-ai
```

## Inputs

See `variables.tf`. Notable:

| Name | Default |
|---|---|
| `project_id` | required |
| `region` | required |
| `cluster_name` | `aldo-ai` |
| `release_channel` | `REGULAR` |
| `network` / `subnetwork` | `default` |
| `master_ipv4_cidr_block` | `172.16.0.0/28` (private control plane) |
| `machine_type` | `e2-standard-4` |
| `node_count` | `1` per zone (regional cluster → 3 nodes total) |
| `node_min_count` / `node_max_count` | `1` / `3` per zone |
| `deletion_protection` | `true` |

## Outputs

`cluster_name`, `cluster_endpoint` (sensitive), `kubeconfig_command`,
`namespace`, `release_name`, `postgres_connection_string` (sensitive),
`web_ingress_host`.

## Notes

- **Workload Identity** is enabled on the cluster + node pool. Bind the
  chart's ServiceAccount to a Google SA via
  `extra_values_yaml = yamlencode({ serviceAccount = { annotations = { "iam.gke.io/gcp-service-account" = "..." } } })`.
- **Private nodes**: nodes have no public IPs by default. Cloud NAT is
  required for egress to public model providers (when allowed by the
  privacy tier).
- **Real-cluster validation**: not yet exercised against a live project.
  See chart `README.md` for the full caveat.
