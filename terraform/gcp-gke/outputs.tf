# Licensed under FSL-1.1-ALv2

output "cluster_name" {
  description = "GKE cluster name."
  value       = google_container_cluster.this.name
}

output "cluster_endpoint" {
  description = "GKE master endpoint."
  value       = google_container_cluster.this.endpoint
  sensitive   = true
}

output "kubeconfig_command" {
  description = "Run this to populate kubeconfig."
  value       = "gcloud container clusters get-credentials ${google_container_cluster.this.name} --region ${var.region} --project ${var.project_id}"
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
