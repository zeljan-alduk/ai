# Licensed under FSL-1.1-ALv2

variable "region" {
  description = "AWS region (e.g. us-east-1)."
  type        = string
}

variable "cluster_name" {
  description = "EKS cluster name."
  type        = string
  default     = "aldo-ai"
}

variable "kubernetes_version" {
  description = "Kubernetes minor version for the EKS control plane."
  type        = string
  default     = "1.31"
}

variable "subnet_ids" {
  description = "Subnet IDs for the EKS cluster + node group. At least 2 across distinct AZs."
  type        = list(string)
}

variable "endpoint_public_access" {
  description = "Expose the EKS API endpoint to the public internet. Disable in regulated environments."
  type        = bool
  default     = true
}

variable "node_count" {
  description = "Desired managed-node-group size."
  type        = number
  default     = 3
}

variable "node_min_count" {
  description = "Minimum nodes in the managed group."
  type        = number
  default     = 2
}

variable "node_max_count" {
  description = "Maximum nodes in the managed group."
  type        = number
  default     = 6
}

variable "instance_type" {
  description = "EC2 instance type for the node group."
  type        = string
  default     = "m6i.large"
}

variable "node_capacity_type" {
  description = "ON_DEMAND or SPOT."
  type        = string
  default     = "ON_DEMAND"
}

variable "namespace" {
  description = "Kubernetes namespace for the ALDO release."
  type        = string
  default     = "aldo-ai"
}

variable "chart_path" {
  description = "Path or OCI URL of the Helm chart. Defaults to the in-repo path."
  type        = string
  default     = "../../charts/aldo-ai"
}

variable "chart_version" {
  description = "Chart version (only used when chart_path is an OCI URL)."
  type        = string
  default     = null
}

variable "create_app_secret" {
  description = "Whether the module creates the aldo-app-secrets Secret. When false, pre-create it out of band."
  type        = bool
  default     = true
}

variable "app_secret_values" {
  description = "Map of provider-key envs (ANTHROPIC_API_KEY, OPENAI_API_KEY, JWT_SIGNING_KEY, etc.). Sensitive."
  type        = map(string)
  sensitive   = true
  default     = {}
}

variable "ingress" {
  description = "Helm-chart ingress block (passthrough)."
  type        = any
  default = {
    enabled = false
  }
}

variable "postgres" {
  description = "Helm-chart postgres block (passthrough). Default is bundled; switch enabled=false + external=... for RDS."
  type        = any
  default = {
    enabled = true
    storage = {
      size = "20Gi"
    }
  }
}

variable "replicas" {
  description = "Per-component replica counts."
  type = object({
    api = number
    web = number
  })
  default = {
    api = 2
    web = 2
  }
}

variable "extra_values_yaml" {
  description = "Free-form extra values appended to the helm_release. Multi-document not allowed."
  type        = string
  default     = ""
}
