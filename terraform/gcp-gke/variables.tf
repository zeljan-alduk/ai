# Licensed under FSL-1.1-ALv2

variable "project_id" {
  description = "GCP project ID."
  type        = string
}

variable "region" {
  description = "GCP region (e.g. europe-west1)."
  type        = string
}

variable "cluster_name" {
  description = "GKE cluster name."
  type        = string
  default     = "aldo-ai"
}

variable "release_channel" {
  description = "GKE release channel (RAPID / REGULAR / STABLE)."
  type        = string
  default     = "REGULAR"
}

variable "network" {
  description = "VPC network self-link or name. Defaults to 'default'."
  type        = string
  default     = "default"
}

variable "subnetwork" {
  description = "Subnetwork self-link or name."
  type        = string
  default     = "default"
}

variable "master_ipv4_cidr_block" {
  description = "Private control-plane CIDR (/28)."
  type        = string
  default     = "172.16.0.0/28"
}

variable "machine_type" {
  description = "Node machine type."
  type        = string
  default     = "e2-standard-4"
}

variable "node_disk_size_gb" {
  description = "Node boot disk size."
  type        = number
  default     = 100
}

variable "node_count" {
  description = "Initial nodes per zone."
  type        = number
  default     = 1
}

variable "node_min_count" {
  description = "Minimum nodes per zone (autoscaler)."
  type        = number
  default     = 1
}

variable "node_max_count" {
  description = "Maximum nodes per zone (autoscaler)."
  type        = number
  default     = 3
}

variable "deletion_protection" {
  description = "GKE deletion protection. Default true; flip false in dev."
  type        = bool
  default     = true
}

variable "namespace" {
  description = "Kubernetes namespace for the ALDO release."
  type        = string
  default     = "aldo-ai"
}

variable "chart_path" {
  description = "Path or OCI URL of the Helm chart."
  type        = string
  default     = "../../charts/aldo-ai"
}

variable "chart_version" {
  description = "Chart version (only used when chart_path is OCI)."
  type        = string
  default     = null
}

variable "create_app_secret" {
  description = "Whether the module creates the aldo-app-secrets Secret."
  type        = bool
  default     = true
}

variable "app_secret_values" {
  description = "Map of provider-key envs. Sensitive."
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
  description = "Helm-chart postgres block (passthrough)."
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
  description = "Free-form extra values appended to the helm_release."
  type        = string
  default     = ""
}
