# ALDO AI on AWS EKS — Terraform module

> **Licensed under FSL-1.1-ALv2.**

Provisions an EKS cluster, a managed node group, the VPC-CNI add-on with
NetworkPolicy enabled, and a Helm release of `charts/aldo-ai`.

## Prerequisites

- AWS account with IAM permissions for EKS, EC2, IAM, VPC.
- Existing VPC + ≥2 subnets across distinct AZs (pass via `subnet_ids`).
- `aws` CLI authenticated (`aws sts get-caller-identity` works).
- Terraform ≥ 1.5.

## Quick start

```bash
cat > prod.tfvars <<'EOF'
region        = "us-east-1"
cluster_name  = "aldo-ai-prod"
subnet_ids    = ["subnet-aaa", "subnet-bbb", "subnet-ccc"]
node_count    = 3
instance_type = "m6i.large"

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

# Provider-key secrets — keep this file out of git.
app_secret_values = {
  ANTHROPIC_API_KEY = "sk-ant-..."
  OPENAI_API_KEY    = "sk-..."
  JWT_SIGNING_KEY   = "<openssl rand -hex 32>"
}
EOF

terraform init
terraform apply -var-file=prod.tfvars
```

After apply:

```bash
$(terraform output -raw kubeconfig_command)
kubectl get pods -n aldo-ai
```

## Inputs

| Name | Default | Notes |
|---|---|---|
| `region` | — | required |
| `cluster_name` | `aldo-ai` | |
| `kubernetes_version` | `1.31` | |
| `subnet_ids` | — | required, ≥2 across AZs |
| `endpoint_public_access` | `true` | flip false in regulated VPCs |
| `node_count` | `3` | |
| `node_min_count` | `2` | |
| `node_max_count` | `6` | |
| `instance_type` | `m6i.large` | |
| `node_capacity_type` | `ON_DEMAND` | or `SPOT` |
| `namespace` | `aldo-ai` | |
| `chart_path` | `../../charts/aldo-ai` | swap for OCI URL once published |
| `chart_version` | `null` | required only when `chart_path` is OCI |
| `create_app_secret` | `true` | |
| `app_secret_values` | `{}` | sensitive map of provider keys |
| `ingress` | `{ enabled = false }` | passthrough to chart |
| `postgres` | `{ enabled = true, storage = { size = "20Gi" } }` | flip enabled=false to point at RDS |
| `replicas` | `{ api = 2, web = 2 }` | |
| `extra_values_yaml` | `""` | escape hatch for arbitrary chart values |

## Outputs

| Name | Sensitive | Notes |
|---|---|---|
| `cluster_name` | no | |
| `cluster_endpoint` | no | |
| `kubeconfig_command` | no | run to populate kubeconfig |
| `namespace` | no | |
| `release_name` | no | always `aldo-ai` |
| `postgres_connection_string` | yes | bundled-postgres URL — only meaningful when `postgres.enabled=true` |
| `web_ingress_host` | no | |

## Limitations

- VPC + subnets are **not** created — pass existing IDs.
- RDS is not provisioned. To use managed Postgres, set
  `postgres = { enabled = false, external = { ... } }` and create the
  RDS instance + credentials Secret out of band.
- IRSA bindings are scaffolded in the chart (`serviceAccount.annotations`)
  but not pre-wired — add the role ARN via `extra_values_yaml`.
- Real-cluster validation: this module ships untested against a live
  account in this PR. Manifests are `helm template` + `kubeconform`
  green offline. See chart `README.md` for the full caveat.
