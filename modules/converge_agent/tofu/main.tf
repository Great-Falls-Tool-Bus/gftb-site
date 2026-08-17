# The carrier is a resource in the state it applies (converge-agent.md §1):
# tenants declare this module INSIDE the stack the carrier converges, so
# spec drift against the CronJob is structurally healed by the next tick,
# and removing the carrier is a visible stack diff, never a quiet click.

locals {
  # The credential seam is expressed as PATHS (variables.tf), and the mount
  # geometry is derived from them: the directory is the mountPath, the file
  # name is the Secret key projected into it. One input per key, so a tenant
  # whose Secret stores the key under a different filename is an input change
  # and never a fork of this template.
  deploy_key_mount             = dirname(var.deploy_key_path)
  application_deploy_key_mount = dirname(var.application_deploy_key_path)

  cronjob_manifest = yamldecode(templatefile(
    "${path.module}/../templates/converge-agent-cronjob.yaml.tftpl",
    {
      tenant                        = var.tenant
      namespace                     = var.namespace
      schedule                      = var.schedule
      overlay_repo_ssh              = var.overlay_repo_ssh
      overlay_branch                = var.overlay_branch
      workflow_state_document       = var.workflow_state_document
      enabled_flag_pointer          = var.enabled_flag_pointer
      armed_flag_pointer            = var.armed_flag_pointer
      destroy_admission_pointer     = var.destroy_admission_pointer
      durable_data_addresses_json   = jsonencode(jsonencode(var.durable_data_addresses))
      ephemeral                     = var.ephemeral ? "true" : "false"
      source_repository_url         = var.source_repository_url
      source_branch                 = var.source_branch
      stack_dir                     = var.stack_dir
      backend_config_path           = var.backend_config_path
      var_file_path                 = var.var_file_path
      apply_variable_overrides_json = jsonencode(jsonencode(var.apply_variable_overrides))
      application_image_tag         = var.application_image_tag
      application_image_repository  = var.application_image_repository
      image_tag_template            = var.image_tag_template
      application_image_variable    = var.application_image_variable
      edge_probe_token_secret_name  = var.edge_probe_token_secret_name
      edge_health_url               = var.edge_health_url
      served_sha_field              = var.served_sha_field
      rollout_target                = var.rollout_target
      rollout_timeout               = var.rollout_timeout
      carrier_image                 = var.carrier_image
      carrier_liveness_alert_ref    = var.carrier_liveness_alert_ref
      state_backend_bucket          = var.state_backend.bucket
      state_backend_key             = var.state_backend.key
      state_backend_region          = var.state_backend.region
      state_backend_endpoint        = var.state_backend.endpoint
      deploy_key_secret_name        = var.deploy_key_secret_name
      deploy_key_path               = var.deploy_key_path
      deploy_key_mount              = local.deploy_key_mount

      application_deploy_key_secret_name = var.application_deploy_key_secret_name
      application_deploy_key_path        = var.application_deploy_key_path
      application_deploy_key_mount       = local.application_deploy_key_mount

      state_credentials_secret_name = var.state_credentials_secret_name
      cloudflare_secret_name        = var.cloudflare_secret_name
      registry_pull_secret_name     = var.registry_pull_secret_name
      service_account_name          = var.service_account_name
    },
  ))
}

# The loop body rides the module (TIN-2698 packaging shape): the script the
# CronJob mounts is the file shipped in this package, so a site-local edit of
# the loop is impossible without a visible module-source change.
resource "kubernetes_config_map_v1" "converge_agent_script" {
  count = var.enabled ? 1 : 0

  metadata {
    name      = "converge-agent-script"
    namespace = var.namespace
    labels = {
      "app.kubernetes.io/name"     = "converge-agent"
      "app.kubernetes.io/instance" = var.tenant
      "app.kubernetes.io/part-of"  = "production-convergence"
    }
  }

  data = {
    "converge-agent.sh" = file("${path.module}/../carrier/converge-agent.sh")
  }
}

# The one carrier (production-convergence.md §3). Declare it in
# config/production-convergence.json as
#   "carrier_resource": "module.<label>.kubernetes_manifest.converge_agent"
# in the same reviewed change that deletes any workflow carrier — no interim
# state may run both (converge-agent.md §6).
resource "kubernetes_manifest" "converge_agent" {
  count = var.enabled ? 1 : 0

  manifest = local.cronjob_manifest

  depends_on = [kubernetes_config_map_v1.converge_agent_script]

  lifecycle {
    # Exactly one image mode (§2.3a): a moving tag, XOR a template that
    # derives the tag from the resolved main SHA for sites whose CI
    # publishes no moving tag. Two image authorities is none.
    precondition {
      condition     = (var.application_image_tag != "") != (var.image_tag_template != "")
      error_message = "Set exactly one of application_image_tag (moving-tag mode) or image_tag_template (template mode, for sites publishing no moving tag)."
    }

    precondition {
      condition     = var.image_tag_template == "" || var.application_image_repository != ""
      error_message = "image_tag_template mode requires application_image_repository (the bare repo the rendered tag is joined to)."
    }

    # The resolved digest must reach apply through SOME reviewed channel: the
    # module's own -var, or an override carrying {digest}/{image}. Dropping
    # both is a plan that never learns what image it pinned.
    precondition {
      condition = var.application_image_variable != "" || length([
        for value in values(var.apply_variable_overrides) :
        value if strcontains(value, "{digest}") || strcontains(value, "{image}")
      ]) > 0
      error_message = "With application_image_variable = \"\", apply_variable_overrides must carry {digest} or {image} — otherwise the resolved digest never reaches apply."
    }

    # Addendum §10 — "The arming gate and the kill switch are two flags and
    # MUST NOT be collapsed into one." Aliasing both pointers onto one key is
    # exactly that collapse, and it would make "stop the runaway carrier" and
    # "never started it" indistinguishable in history.
    precondition {
      condition     = var.armed_flag_pointer != var.enabled_flag_pointer
      error_message = "armed_flag_pointer and enabled_flag_pointer must name different fields: they differ in reviewed default (unarmed vs armed) and in what a flip means (a plan vs an incident)."
    }

    # D1 (operator ruling 2026-08-13) — a second deploy key exists to read a
    # PRIVATE application repository. A key minted for a repository this
    # instantiation never reads is a credential with no reader: refuse it at
    # plan time rather than mount it and hope.
    precondition {
      condition     = var.application_deploy_key_secret_name == "" || var.source_repository_url != ""
      error_message = "application_deploy_key_secret_name is set but source_repository_url is empty: the second deploy key authorizes the APPLICATION repository, and this instantiation reads none."
    }

    # An https remote presents no ssh identity, so the second key would be
    # mounted, never used, and the private repository still unreadable — a
    # failure that looks like a credential problem and is an addressing one.
    precondition {
      condition     = var.application_deploy_key_secret_name == "" || startswith(var.source_repository_url, "git@") || startswith(var.source_repository_url, "ssh://")
      error_message = "application_deploy_key_secret_name requires an SSH source_repository_url (git@host:path or ssh://host/path): a deploy key cannot authenticate an https remote."
    }

    # Two Secrets cannot share one mountPath. A tenant that points both key
    # paths at one directory has silently mounted exactly one key, and the
    # tick would fail on whichever repository lost the race.
    precondition {
      condition     = var.application_deploy_key_secret_name == "" || dirname(var.application_deploy_key_path) != dirname(var.deploy_key_path)
      error_message = "application_deploy_key_path and deploy_key_path must live in different directories: each path's directory is its Secret's mountPath, and two Secrets cannot be projected onto one."
    }

    # Addendum §7.2 rule 5 — a stack whose state key names production can
    # never carry the standing admission to destroy its own durable data. The
    # split is structural, not a convention: one boolean decides whether a
    # reaper is a lifecycle or an incident, and production is never the former.
    precondition {
      condition     = !(var.ephemeral && can(regex("/production\\.tfstate$", var.state_backend.key)))
      error_message = "A production state key cannot be declared ephemeral: `ephemeral = true` is the standing admission to destroy this stack's durable data (addendum §7.2 rule 5), and a production stack never carries it."
    }
  }
}
