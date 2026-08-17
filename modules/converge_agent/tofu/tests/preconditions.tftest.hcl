# Native precondition tests for the D1 application-credential seam — the
# CONDITION LOGIC, evaluated by the real parser, not error_message prose.
# Each of the three D1 preconditions on kubernetes_manifest.converge_agent
# gets both sides of its matrix: rows that must plan clean and rows where
# exactly that condition refuses. The two deploy-key path validations get
# their refusal rows too. Run in CI by the carrier-module-tofu gate
# (.github/workflows/ci.yml) through the repo nix devshell's opentofu.
#
# The kubernetes provider is MOCKED: preconditions and variable validations
# are core-side plan logic, and mocking is what lets a plan run with no
# cluster (kubernetes_manifest normally validates against a live API at
# plan time). Nothing here applies anything, anywhere.

mock_provider "kubernetes" {}

# A conforming production instantiation (moving-tag image mode; the seam
# dormant by default — application_deploy_key_secret_name = "").
variables {
  tenant                     = "alpha"
  namespace                  = "alpha-production"
  overlay_repo_ssh           = "git@github.com:example/alpha-infra.git"
  edge_health_url            = "https://www.alpha.example.com/api/health"
  rollout_target             = "deployment/alpha"
  carrier_image              = "ghcr.io/tinyland-inc/converge-agent@sha256:1111111111111111111111111111111111111111111111111111111111111111"
  carrier_liveness_alert_ref = "alpha-carrier-liveness"
  application_image_tag      = "ghcr.io/example/alpha:main"
  state_backend = {
    bucket   = "tofu-state"
    key      = "alpha/application/production.tfstate"
    region   = "us-east-1"
    endpoint = "https://state.internal.example"
  }
}

# ---------------------------------------------------------------- valid rows

# The pre-input shape: no second key, no second identity — must stay legal
# byte for byte.
run "dormant_seam_plans_clean" {
  command = plan
}

# The guards are SCOPED to the seam: a separate PUBLIC application
# repository read over https with NO second key was always legal and must
# stay so — the ssh-shape rule binds the KEY, not the source input.
run "dormant_seam_with_https_source_plans_clean" {
  command = plan

  variables {
    source_repository_url = "https://github.com/example/alpha.git"
  }
}

# The seam, active and correctly addressed (git@ shorthand): distinct mount
# directories arrive from the two path defaults.
run "active_seam_with_scp_style_source_plans_clean" {
  command = plan

  variables {
    application_deploy_key_secret_name = "converge-agent-application-deploy-key"
    source_repository_url              = "git@github.com:example/alpha.git"
  }
}

# The seam, active over the ssh:// scheme — the other admitted spelling.
run "active_seam_with_ssh_scheme_source_plans_clean" {
  command = plan

  variables {
    application_deploy_key_secret_name = "converge-agent-application-deploy-key"
    source_repository_url              = "ssh://git@github.com/example/alpha.git"
  }
}

# -------------------------------------------------- D1 precondition refusals

# D1 condition 1: a second key with source_repository_url = "" is a
# credential with no reader — refused at plan.
run "seam_without_source_repository_refused" {
  command = plan

  variables {
    application_deploy_key_secret_name = "converge-agent-application-deploy-key"
  }

  expect_failures = [
    kubernetes_manifest.converge_agent,
  ]
}

# D1 condition 2: a second key against an https remote presents no ssh
# identity — mounted, never used — refused at plan.
run "seam_with_https_source_refused" {
  command = plan

  variables {
    application_deploy_key_secret_name = "converge-agent-application-deploy-key"
    source_repository_url              = "https://github.com/example/alpha.git"
  }

  expect_failures = [
    kubernetes_manifest.converge_agent,
  ]
}

# D1 condition 3: both key paths in ONE directory is one mountPath for two
# Secrets — exactly one key survives the race — refused at plan. The
# application path here shares deploy_key_path's default directory
# (/secrets/deploy-key) under a different filename.
run "seam_sharing_the_overlay_mount_refused" {
  command = plan

  variables {
    application_deploy_key_secret_name = "converge-agent-application-deploy-key"
    source_repository_url              = "git@github.com:example/alpha.git"
    application_deploy_key_path        = "/secrets/deploy-key/id_application"
  }

  expect_failures = [
    kubernetes_manifest.converge_agent,
  ]
}

# ------------------------------------------------ path validation refusals

# deploy_key_path must be absolute and name a file inside its own mount
# directory.
run "relative_deploy_key_path_refused" {
  command = plan

  variables {
    deploy_key_path = "secrets/deploy-key/id_ed25519"
  }

  expect_failures = [
    var.deploy_key_path,
  ]
}

# A file directly under / has no mount directory to project the Secret into.
run "rootless_application_deploy_key_path_refused" {
  command = plan

  variables {
    application_deploy_key_path = "/id_ed25519"
  }

  expect_failures = [
    var.application_deploy_key_path,
  ]
}

# Parent traversal never names an in-container mount geometry.
run "traversal_application_deploy_key_path_refused" {
  command = plan

  variables {
    application_deploy_key_path = "/secrets/application-deploy-key/../id_ed25519"
  }

  expect_failures = [
    var.application_deploy_key_path,
  ]
}
