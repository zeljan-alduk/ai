# Licensed under FSL-1.1-ALv2
# ============================================================================
# ALDO AI on GCP GKE — full module
# ----------------------------------------------------------------------------
# Provisions a GKE cluster (Dataplane V2 — required for NetworkPolicy),
# a node pool, kubernetes + helm providers via the GKE token, and a Helm
# release of charts/aldo-ai.
# ============================================================================

terraform {
  required_version = ">= 1.5.0"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = ">= 5.0"
    }
    kubernetes = {
      source  = "hashicorp/kubernetes"
      version = ">= 2.30"
    }
    helm = {
      source  = "hashicorp/helm"
      version = ">= 2.13"
    }
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}

# ----------------------------------------------------------------------------
# GKE cluster — regional, Dataplane V2 (Cilium), private nodes
# ----------------------------------------------------------------------------
resource "google_container_cluster" "this" {
  name                     = var.cluster_name
  location                 = var.region
  remove_default_node_pool = true
  initial_node_count       = 1
  deletion_protection      = var.deletion_protection

  # Dataplane V2 = NetworkPolicy enforcement out of the box.
  datapath_provider = "ADVANCED_DATAPATH"

  network    = var.network
  subnetwork = var.subnetwork

  ip_allocation_policy {}

  release_channel {
    channel = var.release_channel
  }

  workload_identity_config {
    workload_pool = "${var.project_id}.svc.id.goog"
  }

  private_cluster_config {
    enable_private_nodes    = true
    enable_private_endpoint = false
    master_ipv4_cidr_block  = var.master_ipv4_cidr_block
  }
}

resource "google_container_node_pool" "default" {
  name       = "default"
  cluster    = google_container_cluster.this.name
  location   = google_container_cluster.this.location
  node_count = var.node_count

  node_config {
    machine_type = var.machine_type
    disk_size_gb = var.node_disk_size_gb
    oauth_scopes = [
      "https://www.googleapis.com/auth/cloud-platform",
    ]

    workload_metadata_config {
      mode = "GKE_METADATA"
    }
  }

  autoscaling {
    min_node_count = var.node_min_count
    max_node_count = var.node_max_count
  }

  management {
    auto_repair  = true
    auto_upgrade = true
  }
}

# ----------------------------------------------------------------------------
# Auth + providers
# ----------------------------------------------------------------------------
data "google_client_config" "this" {}

provider "kubernetes" {
  host                   = "https://${google_container_cluster.this.endpoint}"
  cluster_ca_certificate = base64decode(google_container_cluster.this.master_auth[0].cluster_ca_certificate)
  token                  = data.google_client_config.this.access_token
}

provider "helm" {
  kubernetes = {
    host                   = "https://${google_container_cluster.this.endpoint}"
    cluster_ca_certificate = base64decode(google_container_cluster.this.master_auth[0].cluster_ca_certificate)
    token                  = data.google_client_config.this.access_token
  }
}

# ----------------------------------------------------------------------------
# Namespace + provider-key Secret
# ----------------------------------------------------------------------------
resource "kubernetes_namespace_v1" "aldo" {
  metadata {
    name = var.namespace
  }
  depends_on = [google_container_node_pool.default]
}

resource "kubernetes_secret_v1" "app_secrets" {
  count = var.create_app_secret ? 1 : 0

  metadata {
    name      = "aldo-app-secrets"
    namespace = kubernetes_namespace_v1.aldo.metadata[0].name
  }
  type = "Opaque"
  data = var.app_secret_values
}

# ----------------------------------------------------------------------------
# Helm release
# ----------------------------------------------------------------------------
resource "helm_release" "aldo_ai" {
  name      = "aldo-ai"
  namespace = kubernetes_namespace_v1.aldo.metadata[0].name
  chart     = var.chart_path
  version   = var.chart_version

  values = [
    yamlencode({
      privacyTier = {
        enforced = true
      }
      secrets = {
        bringYourOwnSecret = true
        name               = "aldo-app-secrets"
      }
      ingress  = var.ingress
      postgres = var.postgres
      replicas = var.replicas
    }),
    var.extra_values_yaml,
  ]

  depends_on = [
    kubernetes_secret_v1.app_secrets,
  ]
}
