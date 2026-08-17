# site.scaffold spoke infrastructure composition.
#
# Composes two generic spoke-facing modules from
# tinyland-inc/GloriousFlywheel/tofu/modules/spoke-* at
# spoke-tofu-modules-v1.0.0. The full
# contract is documented in docs/CI-SCHEMA.md (§8 OpenTofu posture;
# §5 runner classes).

variable "spoke_slug" {
  description = "Spoke slug (matches .github/lanes.json spoke.name)."
  type        = string
}

variable "github_org" {
  description = "GitHub org that owns the spoke repo."
  type        = string
  default     = "tinyland-inc"
}

variable "allowed_runner_classes" {
  description = "Runner classes the spoke may dispatch to (subset of CI-SCHEMA §5 enum)."
  type        = list(string)
  default     = ["tinyland-nix"]
}

variable "cache_quota_gib" {
  description = "Aggregate cache quota in GiB."
  type        = number
  default     = 50
}

locals {
  github_repository = "${var.github_org}/${var.spoke_slug}"
  modules_source    = "git::ssh://git@github.com/tinyland-inc/GloriousFlywheel.git//tofu/modules"
  modules_ref       = "spoke-tofu-modules-v1.0.0"
}

module "cache_quota" {
  source     = "${local.modules_source}/spoke-cache-quota?ref=${local.modules_ref}"
  spoke_slug = var.spoke_slug
  cache_gib  = var.cache_quota_gib
}

module "runner_binding" {
  source                 = "${local.modules_source}/spoke-runner-binding?ref=${local.modules_ref}"
  spoke_slug             = var.spoke_slug
  github_repository      = local.github_repository
  allowed_runner_classes = var.allowed_runner_classes
}

output "attic_namespace" {
  description = "Attic namespace this spoke pushes/fetches under."
  value       = module.cache_quota.attic_namespace
}
