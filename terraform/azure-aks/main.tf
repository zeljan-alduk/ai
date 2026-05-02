# Licensed under FSL-1.1-ALv2
# ============================================================================
# ALDO AI on Azure AKS — full module
# ----------------------------------------------------------------------------
# Provisions an AKS cluster with Azure CNI + Calico NetworkPolicy
# enforcement, a system node pool, and a Helm release of charts/aldo-ai.
# ============================================================================

terraform {
  required_version = ">= 1.5.0"

  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = ">= 4.0"
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

provider "azurerm" {
  features {}
}

# ----------------------------------------------------------------------------
# Resource group + AKS
# ----------------------------------------------------------------------------
resource "azurerm_resource_group" "this" {
  name     = var.resource_group_name
  location = var.region
}

resource "azurerm_kubernetes_cluster" "this" {
  name                = var.cluster_name
  location            = azurerm_resource_group.this.location
  resource_group_name = azurerm_resource_group.this.name
  dns_prefix          = var.cluster_name
  kubernetes_version  = var.kubernetes_version

  default_node_pool {
    name                 = "default"
    node_count           = var.node_count
    vm_size              = var.vm_size
    min_count            = var.node_min_count
    max_count            = var.node_max_count
    auto_scaling_enabled = true
  }

  identity {
    type = "SystemAssigned"
  }

  network_profile {
    network_plugin = "azure"
    # Calico is the broadest NetworkPolicy enforcer on AKS. Switch to
    # "azure" if you prefer the Azure-native policy engine.
    network_policy = "calico"
  }

  workload_identity_enabled = true
  oidc_issuer_enabled       = true
}

# ----------------------------------------------------------------------------
# kubernetes + helm providers
# ----------------------------------------------------------------------------
provider "kubernetes" {
  host                   = azurerm_kubernetes_cluster.this.kube_config[0].host
  client_certificate     = base64decode(azurerm_kubernetes_cluster.this.kube_config[0].client_certificate)
  client_key             = base64decode(azurerm_kubernetes_cluster.this.kube_config[0].client_key)
  cluster_ca_certificate = base64decode(azurerm_kubernetes_cluster.this.kube_config[0].cluster_ca_certificate)
}

provider "helm" {
  kubernetes = {
    host                   = azurerm_kubernetes_cluster.this.kube_config[0].host
    client_certificate     = base64decode(azurerm_kubernetes_cluster.this.kube_config[0].client_certificate)
    client_key             = base64decode(azurerm_kubernetes_cluster.this.kube_config[0].client_key)
    cluster_ca_certificate = base64decode(azurerm_kubernetes_cluster.this.kube_config[0].cluster_ca_certificate)
  }
}

# ----------------------------------------------------------------------------
# Namespace + provider-key Secret
# ----------------------------------------------------------------------------
resource "kubernetes_namespace_v1" "aldo" {
  metadata {
    name = var.namespace
  }
  depends_on = [azurerm_kubernetes_cluster.this]
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
