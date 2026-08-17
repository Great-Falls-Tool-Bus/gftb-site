terraform {
  # OpenTofu >= 1.10: the carrier initializes the S3-compatible backend with
  # use_lockfile=true (native lockfile locking; stateful addendum §1).
  required_version = ">= 1.10.0"

  required_providers {
    kubernetes = {
      source  = "hashicorp/kubernetes"
      version = ">= 2.30.0"
    }
  }
}
