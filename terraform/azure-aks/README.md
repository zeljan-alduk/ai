# ALDO AI on Azure AKS — Terraform module

> **Licensed under FSL-1.1-ALv2.**

Provisions an AKS cluster with Azure CNI + Calico NetworkPolicy
enforcement and a Helm release of `charts/aldo-ai`.

## Prerequisites

- Azure subscription with the Microsoft.ContainerService provider registered.
- `az login` executed.
- Terraform ≥ 1.5.

## Quick start

```bash
cat > prod.tfvars <<'EOF'
region              = "westeurope"
resource_group_name = "aldo-ai-prod-rg"
cluster_name        = "aldo-ai-prod"

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
| `region` | required |
| `resource_group_name` | `aldo-ai-rg` |
| `cluster_name` | `aldo-ai` |
| `kubernetes_version` | `null` (AKS default) |
| `vm_size` | `Standard_D4s_v5` |
| `node_count` / `node_min_count` / `node_max_count` | `3` / `2` / `6` |

## Outputs

`cluster_name`, `resource_group`, `kubeconfig_command`, `namespace`,
`release_name`, `postgres_connection_string` (sensitive),
`web_ingress_host`.

## Notes

- **Network policy**: this module sets `network_policy = "calico"`.
  Switch to `"azure"` in `main.tf` if you prefer Azure-native enforcement.
- **Workload Identity** + OIDC issuer are enabled. Bind via
  `extra_values_yaml`.
- **Real-cluster validation**: not yet exercised against a live
  subscription. See chart `README.md`.
