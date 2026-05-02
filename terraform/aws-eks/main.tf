# Licensed under FSL-1.1-ALv2
# ============================================================================
# ALDO AI on AWS EKS — full module
# ----------------------------------------------------------------------------
# Provisions:
#   - EKS cluster (managed control plane)
#   - One managed node group
#   - kubernetes + helm providers wired through the EKS cluster
#   - helm_release of charts/aldo-ai
#
# NOT provisioned (by design — operators usually own these):
#   - VPC + subnets (pass IDs via vars)
#   - Route53 / ACM certs
#   - RDS Postgres (chart's bundled postgres is the default; flip postgres
#     to BYO and point at an existing RDS instance)
#
# Run:
#   terraform init
#   terraform apply -var-file=prod.tfvars
# ============================================================================

terraform {
  required_version = ">= 1.5.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
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

provider "aws" {
  region = var.region
}

# ----------------------------------------------------------------------------
# EKS cluster
# ----------------------------------------------------------------------------
resource "aws_iam_role" "cluster" {
  name = "${var.cluster_name}-cluster"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Principal = {
        Service = "eks.amazonaws.com"
      }
      Action = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy_attachment" "cluster_amazoneks_cluster" {
  policy_arn = "arn:aws:iam::aws:policy/AmazonEKSClusterPolicy"
  role       = aws_iam_role.cluster.name
}

resource "aws_eks_cluster" "this" {
  name     = var.cluster_name
  role_arn = aws_iam_role.cluster.arn
  version  = var.kubernetes_version

  vpc_config {
    subnet_ids              = var.subnet_ids
    endpoint_private_access = true
    endpoint_public_access  = var.endpoint_public_access
  }

  # Privacy-tier enforcement requires NetworkPolicy. Enable VPC CNI's
  # network-policy plugin via add-on so the chart's NetworkPolicy works.
  depends_on = [
    aws_iam_role_policy_attachment.cluster_amazoneks_cluster,
  ]
}

resource "aws_eks_addon" "vpc_cni" {
  cluster_name = aws_eks_cluster.this.name
  addon_name   = "vpc-cni"
  configuration_values = jsonencode({
    enableNetworkPolicy = "true"
  })
}

# ----------------------------------------------------------------------------
# Managed node group
# ----------------------------------------------------------------------------
resource "aws_iam_role" "node" {
  name = "${var.cluster_name}-node"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Principal = {
        Service = "ec2.amazonaws.com"
      }
      Action = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy_attachment" "node_worker" {
  policy_arn = "arn:aws:iam::aws:policy/AmazonEKSWorkerNodePolicy"
  role       = aws_iam_role.node.name
}

resource "aws_iam_role_policy_attachment" "node_cni" {
  policy_arn = "arn:aws:iam::aws:policy/AmazonEKS_CNI_Policy"
  role       = aws_iam_role.node.name
}

resource "aws_iam_role_policy_attachment" "node_registry" {
  policy_arn = "arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryReadOnly"
  role       = aws_iam_role.node.name
}

resource "aws_eks_node_group" "this" {
  cluster_name    = aws_eks_cluster.this.name
  node_group_name = "${var.cluster_name}-default"
  node_role_arn   = aws_iam_role.node.arn
  subnet_ids      = var.subnet_ids

  scaling_config {
    desired_size = var.node_count
    min_size     = var.node_min_count
    max_size     = var.node_max_count
  }

  instance_types = [var.instance_type]
  capacity_type  = var.node_capacity_type

  depends_on = [
    aws_iam_role_policy_attachment.node_worker,
    aws_iam_role_policy_attachment.node_cni,
    aws_iam_role_policy_attachment.node_registry,
  ]
}

# ----------------------------------------------------------------------------
# kubernetes + helm providers — auth via EKS token
# ----------------------------------------------------------------------------
data "aws_eks_cluster_auth" "this" {
  name = aws_eks_cluster.this.name
}

provider "kubernetes" {
  host                   = aws_eks_cluster.this.endpoint
  cluster_ca_certificate = base64decode(aws_eks_cluster.this.certificate_authority[0].data)
  token                  = data.aws_eks_cluster_auth.this.token
}

provider "helm" {
  kubernetes = {
    host                   = aws_eks_cluster.this.endpoint
    cluster_ca_certificate = base64decode(aws_eks_cluster.this.certificate_authority[0].data)
    token                  = data.aws_eks_cluster_auth.this.token
  }
}

# ----------------------------------------------------------------------------
# Application namespace + provider-key Secret (bring your own values)
# ----------------------------------------------------------------------------
resource "kubernetes_namespace_v1" "aldo" {
  metadata {
    name = var.namespace
  }
  depends_on = [aws_eks_node_group.this]
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
# Helm release of the chart
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
    aws_eks_addon.vpc_cni,
    kubernetes_secret_v1.app_secrets,
  ]
}
