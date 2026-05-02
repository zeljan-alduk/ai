# Licensed under FSL-1.1-ALv2

output "cluster_name" {
  description = "EKS cluster name."
  value       = aws_eks_cluster.this.name
}

output "cluster_endpoint" {
  description = "EKS API server endpoint."
  value       = aws_eks_cluster.this.endpoint
}

output "kubeconfig_command" {
  description = "Run this to populate kubeconfig for the new cluster."
  value       = "aws eks update-kubeconfig --region ${var.region} --name ${aws_eks_cluster.this.name}"
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
