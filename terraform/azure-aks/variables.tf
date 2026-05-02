# Licensed under FSL-1.1-ALv2

variable "region" {
  description = "Azure region (e.g. westeurope)."
  type        = string
}

variable "resource_group_name" {
  description = "Resource group name (created by this module)."
  type        = string
  default     = "aldo-ai-rg"
}

variable "cluster_name" {
  description = "AKS cluster name."
  type        = string
  default     = "aldo-ai"
}

variable "kubernetes_version" {
  description = "AKS Kubernetes version. Leave null for AKS default."
  type        = string
  default     = null
}

variable "vm_size" {
  description = "Node VM SKU."
  type        = string
  default     = "Standard_D4s_v5"
}

variable "node_count" {
  description = "Initial node count."
  type        = number
  default     = 3
}

variable "node_min_count" {
  description = "Min nodes (autoscaler)."
  type        = number
  default     = 2
}

variable "node_max_count" {
  description = "Max nodes (autoscaler)."
  type        = number
  default     = 6
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
