# Licensed under FSL-1.1-ALv2

output "cluster_name" {
  description = "AKS cluster name."
  value       = azurerm_kubernetes_cluster.this.name
}

output "resource_group" {
  description = "AKS resource group."
  value       = azurerm_resource_group.this.name
}

output "kubeconfig_command" {
  description = "Run this to populate kubeconfig."
  value       = "az aks get-credentials --resource-group ${azurerm_resource_group.this.name} --name ${azurerm_kubernetes_cluster.this.name}"
}

output "namespace" {
  description = "Namespace the chart was released into."
  value       = kubernetes_namespace_v1.aldo.metadata[0].name
}

output "release_name" {
  description = "Helm release name."
  value       = helm_release.aldo_ai.name
}

output "postgres_connection_string" {
  description = "Postgres URL — only meaningful when bundled postgres is enabled."
  value       = var.postgres.enabled ? "postgres://aldo:<lookup-secret>@aldo-ai-postgres.${var.namespace}.svc:5432/aldo" : null
  sensitive   = true
}

output "web_ingress_host" {
  description = "Public web hostname when ingress.enabled=true."
  value       = try(var.ingress.hosts.web, null)
}
