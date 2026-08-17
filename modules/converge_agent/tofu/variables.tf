# One published module, N instantiations. This variable set IS the complete
# per-site authority (docs/patterns/stateful-workload-convergence.md §2):
# a site-shaped need these inputs cannot express is an upstream PR against
# the module, never a fork.

variable "enabled" {
  description = "Compose the carrier at all. Default true preserves the pre-gate behaviour; a first adopter under an inert-gate law (MMS) passes its own `enable_*` variable so the stack composes NO carrier resource until the reviewed activation ceremony flips it. The gate lives inside the module so the instance address is `kubernetes_manifest.converge_agent[0]` in every instantiation, gated or not — one address shape to declare in config/production-convergence.json (site.scaffold #128 admits the index suffix)."
  type        = bool
  default     = true
}

variable "tenant" {
  description = "Site name this instantiation converges (label + state-key prefix). Never a bespoke agent name: the deployed object is always `converge-agent`, the instance label carries this value."
  type        = string

  validation {
    condition     = can(regex("^[a-z0-9][a-z0-9-]*$", var.tenant))
    error_message = "tenant must be lowercase alphanumeric/hyphen."
  }
}

variable "namespace" {
  description = "Runtime namespace this instantiation owns. Two tenants sharing a namespace fail the isolation contract."
  type        = string
}

variable "schedule" {
  description = "CronJob schedule. The interval is the contract: wanting a faster converge is a schedule commit, never a button."
  type        = string
  default     = "*/10 * * * *"
}

variable "overlay_repo_ssh" {
  description = "Git remote whose main the carrier clones read-only (SSH form; the deploy key is the credential boundary)."
  type        = string

  validation {
    condition     = can(regex("^(git@|ssh://)", var.overlay_repo_ssh))
    error_message = "overlay_repo_ssh must be an SSH remote (git@... or ssh://...)."
  }
}

variable "overlay_branch" {
  description = "The overlay repository's integration branch — the single history this loop obeys. This input exists so a tenant can NAME its integration branch, never so a tick can follow a second history: the default is main and the module's contract pins that default."
  type        = string
  default     = "main"

  validation {
    condition     = can(regex("^[A-Za-z0-9][A-Za-z0-9._/-]*$", var.overlay_branch)) && !strcontains(var.overlay_branch, "*")
    error_message = "overlay_branch must be a single branch name — no globs, no refspecs."
  }
}

variable "workflow_state_document" {
  description = "Checked-in workflow-state document (repo-relative) carrying the reviewed `enabled` kill switch the carrier reads each tick."
  type        = string
  default     = "config/workflow-state/production-converge.json"
}

variable "enabled_flag_pointer" {
  description = "RFC 6901 JSON pointer to the reviewed kill-switch boolean inside workflow_state_document. Default /enabled reproduces the previously hard-coded `.enabled == true` read; MMS keeps the flag at /enabled of config/production-convergence.json, a nested document is equally valid."
  type        = string
  default     = "/enabled"

  validation {
    condition     = startswith(var.enabled_flag_pointer, "/") && length(var.enabled_flag_pointer) > 1
    error_message = "enabled_flag_pointer must be an RFC 6901 pointer naming a field (e.g. /enabled or /convergence/enabled)."
  }
}

variable "armed_flag_pointer" {
  description = "RFC 6901 JSON pointer to the reviewed ARMING boolean inside workflow_state_document (addendum §10). The arming gate is the kill switch's complement and MUST NOT be collapsed into it: `enabled: false` is an incident (stop something running), `armed: false` is a plan (this carrier has never run). The reviewed default is UNARMED, so an absent flag halts — a document with no `armed` key is a document whose arming ceremony never happened."
  type        = string
  default     = "/armed"

  validation {
    condition     = startswith(var.armed_flag_pointer, "/") && length(var.armed_flag_pointer) > 1
    error_message = "armed_flag_pointer must be an RFC 6901 pointer naming a field (e.g. /armed)."
  }
}

variable "destroy_admission_pointer" {
  description = "RFC 6901 JSON pointer to the optional `destroy_admission` object inside workflow_state_document (addendum §4): { addresses: [...], reason: \"...\" }. Absent is the normal value; an admission is consumed by one converge and the next tick reads a document without it. The grammar — enumerated addresses, never a prefix, a type, a wildcard, or `all`, plus a reason — is enforced tenant-side by contract/tenant_contract.py."
  type        = string
  default     = "/destroy_admission"

  validation {
    condition     = startswith(var.destroy_admission_pointer, "/") && length(var.destroy_admission_pointer) > 1
    error_message = "destroy_admission_pointer must be an RFC 6901 pointer naming a field (e.g. /destroy_admission)."
  }
}

variable "durable_data_addresses" {
  description = "The tenant's durable-data resource addresses inside the converged stack (addendum §3), e.g. [\"kubernetes_persistent_volume_claim.data\"]. Each tick classifies the plan (§4): a destroy or replace of any address here halts the tick non-zero and applies NOTHING unless the reviewed document admits that exact address, or the stack declared itself ephemeral. The watch matches by BASE address — a count/for_each-gated instance planning as `address[0]` is refused when the base form is declared here — while an admission must name the exact planned address the refusal receipt printed. Empty is legitimate for a stateless tenant and a lie for any other — contract/tenant_contract.py is what stops a stack with a PVC in it from declaring none."
  type        = list(string)
  default     = []

  validation {
    condition     = alltrue([for address in var.durable_data_addresses : !strcontains(address, "*") && length(split(".", address)) >= 2])
    error_message = "each durable-data address must be a concrete tofu address (type.name, optionally module-qualified or indexed) — never a wildcard or a bare type prefix."
  }
}

variable "ephemeral" {
  description = "Addendum §7.2 rule 5: `true` is the standing admission, declared at birth, to destroy the durable data this stack owns — the declaration that makes a PR-environment reap a lifecycle rather than an incident. A production stack declares `false` and can NEVER carry the standing admission; one boolean, declared once, decides which of the two this is."
  type        = bool
  default     = false
}

variable "source_repository_url" {
  description = "The APPLICATION repository — the code the edge serves, which at every tenant in the estate is a different repository from the overlay. The loop resolves its branch head with `git ls-remote` (no clone), and that sha is what the image tag is built from AND what the served-sha assert compares against. Empty keeps the pre-input behaviour: the overlay sha is used for both, which is only correct for a single-repository tenant."
  type        = string
  default     = ""

  validation {
    condition     = var.source_repository_url == "" || can(regex("^(https://|git@|ssh://)", var.source_repository_url))
    error_message = "source_repository_url must be an https, git@, or ssh:// remote."
  }
}

variable "source_branch" {
  description = "Branch of source_repository_url whose head is the application sha."
  type        = string
  default     = "main"

  validation {
    condition     = can(regex("^[A-Za-z0-9][A-Za-z0-9._/-]*$", var.source_branch)) && !strcontains(var.source_branch, "*")
    error_message = "source_branch must be a single branch name — no globs, no refspecs."
  }
}

variable "stack_dir" {
  description = "Tofu stack directory inside the overlay repository that this carrier plans/applies (the stack that also declares this module: §1 self-managed)."
  type        = string
  default     = "tofu/stacks/application"
}

variable "application_image_tag" {
  description = "Moving registry tag naming which line to follow (e.g. ghcr.io/org/app:main). The carrier resolves it to an immutable digest at plan time; a digest here is a defect — resolution is the loop's job. Leave empty for template mode (sites publishing no moving tag: set application_image_repository + image_tag_template instead); exactly one mode must be set."
  type        = string
  default     = ""

  validation {
    condition     = var.application_image_tag == "" || (!strcontains(var.application_image_tag, "@") && strcontains(var.application_image_tag, ":"))
    error_message = "application_image_tag must be a moving tag (repo:tag) with no digest; the carrier resolves the digest at plan time. Leave it empty to use image_tag_template mode."
  }
}

variable "application_image_repository" {
  description = "Bare image repository (no tag, no digest) for template mode — sites whose CI publishes only sha-<commit> tags (the GFTB shape). The carrier joins it with the rendered image_tag_template. Empty in moving-tag mode."
  type        = string
  default     = ""

  validation {
    condition     = !strcontains(var.application_image_repository, "@") && !can(regex("[:\\s]", var.application_image_repository))
    error_message = "application_image_repository must be a bare repository reference — no tag, no digest, no whitespace."
  }
}

variable "image_tag_template" {
  description = "Tag template for sites publishing no moving tag: the carrier substitutes {sha} (full 40-hex) or {short7} (the 7-hex short form docker/metadata-action publishes for type=sha) with the resolved APPLICATION commit BEFORE digest resolution, then resolves the derived ref to an immutable digest as usual. MassageIthaca publishes sha-<short7>, so MMS's declared `image_tag_format = \"sha-{short7}\"` is this input. Mutually exclusive with application_image_tag; requires application_image_repository."
  type        = string
  default     = ""

  validation {
    condition     = var.image_tag_template == "" || ((strcontains(var.image_tag_template, "{sha}") || strcontains(var.image_tag_template, "{short7}")) && !can(regex("[@:\\s]", var.image_tag_template)))
    error_message = "image_tag_template must carry the {sha} or {short7} placeholder and is only the tag — no digest, no colon, no whitespace."
  }
}

variable "application_image_variable" {
  description = "Name of the stack's tofu variable that receives the digest-pinned image reference (repository@sha256:...) at plan time. Set it to \"\" for a stack that takes the image in its own shape — then apply_variable_overrides MUST carry {digest} or {image}, so the resolved digest still reaches apply."
  type        = string
  default     = "application_image"
}

variable "backend_config_path" {
  description = "Optional reviewed backend hcl inside the overlay clone (repo-relative, e.g. tofu/backend/application-production.s3.hcl), passed to `tofu init` BEFORE the module's own -backend-config flags so the validated state coordinates always win the merge. Empty keeps the pre-input behaviour: flags only."
  type        = string
  default     = ""

  validation {
    condition     = var.backend_config_path == "" || (!startswith(var.backend_config_path, "/") && !strcontains(var.backend_config_path, ".."))
    error_message = "backend_config_path must be a relative path inside the overlay clone — no absolute paths, no parent traversal."
  }
}

variable "var_file_path" {
  description = "Optional reviewed tfvars file inside the overlay clone (repo-relative, e.g. tofu/stacks/application/config/production-honey.tfvars.json) passed as `-var-file` at plan time. Empty keeps the pre-input behaviour: no -var-file is passed at all."
  type        = string
  default     = ""

  validation {
    condition     = var.var_file_path == "" || (!startswith(var.var_file_path, "/") && !strcontains(var.var_file_path, ".."))
    error_message = "var_file_path must be a relative path inside the overlay clone — no absolute paths, no parent traversal."
  }
}

variable "apply_variable_overrides" {
  description = "Additional reviewed `-var name=value` pairs for the plan. Values may carry the placeholders the loop already resolved: {digest} (sha256:...), {image} (repository@sha256:...), {sha} (application sha, 40-hex), {short7}. This is how a stack that takes the image in its own shape is served without a fork — MMS empties the mutable image_tag and pins image_digest = \"{digest}\". Empty map keeps the pre-input behaviour: exactly one -var."
  type        = map(string)
  default     = {}
}

variable "served_sha_field" {
  description = "jq path to the commit sha inside the edge health payload. The default .sha is only a DEFAULT, not a law: MassageIthaca serves .build.commitHash, and a carrier that hard-codes .sha reads null at that edge and fails every tick after a successful apply."
  type        = string
  default     = ".sha"

  validation {
    condition     = startswith(var.served_sha_field, ".")
    error_message = "served_sha_field must be a jq path beginning with '.' (e.g. .sha or .build.commitHash)."
  }
}

variable "edge_health_url" {
  description = "Real-edge health endpoint (public hostname, full ingress path) whose .sha must equal the resolved main commit after rollout."
  type        = string

  validation {
    condition     = startswith(var.edge_health_url, "https://")
    error_message = "edge_health_url must be a public https URL — a pod curl is not evidence."
  }
}

variable "rollout_target" {
  description = "kubectl rollout target the carrier waits on before the edge assert (e.g. deployment/massageithaca)."
  type        = string
}

variable "rollout_timeout" {
  description = "Timeout for the rollout wait."
  type        = string
  default     = "5m"
}

variable "carrier_image" {
  description = "Digest-pinned image the carrier itself runs (bash, git, openssh, opentofu, kubectl, crane, jq, curl). Pinned by digest for the same reason the loop pins the application image."
  type        = string

  validation {
    condition     = strcontains(var.carrier_image, "@sha256:")
    error_message = "carrier_image must be digest-pinned (…@sha256:…)."
  }
}

variable "state_backend" {
  description = "S3-compatible state coordinates. The endpoint is operator/environment authority passed in by the instantiation; source never hard-codes it. Locking is always use_lockfile=true (set by the carrier at init, not configurable here)."
  type = object({
    bucket   = string
    key      = string
    region   = string
    endpoint = string
  })

  # Two admitted shapes, both tenant-scoped (next validation). The production
  # shape is §7.1 main==prod; the spoke shape is the documented PR-lane state
  # layout (blahaj tofu/intent/spoke-managed-state.schema.json `state_key`
  # pattern), so the eventual PR-env leg instantiates THIS module instead of
  # growing a second carrier with its own key grammar.
  validation {
    condition = (
      can(regex("^[a-z0-9-]+/[a-z0-9-]+/production\\.tfstate$", var.state_backend.key))
      || can(regex("^spokes/[a-z][a-z0-9-]{1,62}/pr/[1-9][0-9]{0,8}/lanes/[a-z][a-z0-9-]{0,62}/opentofu\\.tfstate$", var.state_backend.key))
    )
    error_message = "state key must be <site>/<stack>/production.tfstate (production) or spokes/<site>/pr/<n>/lanes/<lane>/opentofu.tfstate (spoke PR lane, per blahaj tofu/intent/spoke-managed-state.schema.json) — exactly one key per (stack, environment)."
  }

  validation {
    condition = (
      startswith(var.state_backend.key, "spokes/")
      ? startswith(var.state_backend.key, "spokes/${var.tenant}/pr/")
      : startswith(var.state_backend.key, "${var.tenant}/")
    )
    error_message = "state key must be scoped to this instantiation's tenant (production: <tenant>/...; spoke: spokes/<tenant>/pr/...); two tenants sharing a key is two writers of one state."
  }
}

variable "carrier_liveness_alert_ref" {
  description = "Name of the carrier-liveness detector covering this instantiation (converge-agent.md §1: adoption REQUIRES a named detector alerting on BOTH kube_cronjob_spec_suspend == 1 and last-success staleness, because suspend/delete is the residual halt surface nothing structural heals). A reference — e.g. a Grafana alert rule UID or the overlay's alert-rule path — never a mechanism: the rule itself lives with the tenant's observability surface. REQUIRED, no default, empty refused: an instantiation without a named detector is exactly the un-detected suspend surface the doctrine forbids, so the module refuses to compose it. Threaded onto the CronJob as the tinyland.dev/carrier-liveness-alert annotation so the running object carries its own detector's name in the receipt trail."
  type        = string

  validation {
    condition     = length(trimspace(var.carrier_liveness_alert_ref)) > 0
    error_message = "carrier_liveness_alert_ref must name the carrier-liveness detector (suspend + staleness alert) this instantiation is covered by; the doctrine refuses an instantiation without a named detector (converge-agent.md §1)."
  }
}

variable "edge_probe_token_secret_name" {
  description = "Optional name of an operator-minted Secret carrying a Cloudflare Access service token (keys client_id / client_secret) that the edge probe presents as the CF-Access-Client-Id / CF-Access-Client-Secret header pair — for edges fronted by Access SSO where an unauthenticated probe never reaches the app (GFTB blocker B2). Name only, never a value; empty disables the header pair. Minted by the operator; never created by this module."
  type        = string
  default     = ""
}

variable "deploy_key_secret_name" {
  description = "Secret carrying the read-only deploy key for the OVERLAY repository (the one the carrier clones). Minted by the operator; never created by this module."
  type        = string
  default     = "converge-agent-deploy-key"
}

variable "deploy_key_path" {
  description = "In-container path of the overlay deploy key. The DIRECTORY is where deploy_key_secret_name is projected and the FILE NAME is the key that Secret must carry — one input, so a tenant whose Secret stores the key under a different filename is an input change, never a fork. The default reproduces the previously hard-coded path exactly."
  type        = string
  default     = "/secrets/deploy-key/id_ed25519"

  validation {
    condition     = startswith(var.deploy_key_path, "/") && length(split("/", var.deploy_key_path)) >= 3 && !strcontains(var.deploy_key_path, "..")
    error_message = "deploy_key_path must be an absolute in-container path naming a file inside its own mount directory (e.g. /secrets/deploy-key/id_ed25519)."
  }
}

variable "application_deploy_key_secret_name" {
  description = "Optional name of a SECOND operator-minted Secret carrying a read-only deploy key for the APPLICATION repository — the repository whose branch head the loop resolves with `git ls-remote` (source_repository_url). A deploy key authorizes exactly one repository, so the overlay's key can never read a PRIVATE application repository: without this input that ls-remote is either unauthenticated (which only ever worked while the application repository was public) or refused. Empty — the default — renders no second mount, no second identity, and leaves GIT_SSH_COMMAND exactly as it was: the pre-input behaviour, byte for byte. Name only, never a value; minted by the operator, never created by this module."
  type        = string
  default     = ""
}

variable "application_deploy_key_path" {
  description = "In-container path of the application deploy key, on the same one-input rule as deploy_key_path: the DIRECTORY is where application_deploy_key_secret_name is projected, the FILE NAME is the key that Secret must carry. Only consulted when application_deploy_key_secret_name is set. Its mount directory must differ from deploy_key_path's — two Secrets cannot share one mountPath, and a tenant that points both at one directory has silently mounted only one key."
  type        = string
  default     = "/secrets/application-deploy-key/id_ed25519"

  validation {
    condition     = startswith(var.application_deploy_key_path, "/") && length(split("/", var.application_deploy_key_path)) >= 3 && !strcontains(var.application_deploy_key_path, "..")
    error_message = "application_deploy_key_path must be an absolute in-container path naming a file inside its own mount directory (e.g. /secrets/application-deploy-key/id_ed25519)."
  }
}

variable "state_credentials_secret_name" {
  description = "Secret carrying the state-backend credential. Custody stays in the stack: declared only here, never provisioned to CI runners — that boundary is what makes a workflow-side second carrier fail at backend init."
  type        = string
  default     = "converge-agent-state"
}

variable "cloudflare_secret_name" {
  description = "Optional name of an operator-minted Secret (key api_token) holding the zone-scoped Cloudflare API token the APPLY needs while the stack manages DNS. Projected as CLOUDFLARE_API_TOKEN and TF_VAR_cloudflare_api_token. Name only, never a value; empty omits both env entries. Minted by the operator; never created by this module."
  type        = string
  default     = ""
}

variable "registry_pull_secret_name" {
  description = "Optional name of an existing kubernetes.io/dockerconfigjson Secret used for the tag->digest resolution against a private registry. Projected as a read-only /secrets/registry/config.json plus DOCKER_CONFIG; empty omits the mount entirely. Name only, never a value; minted by the operator."
  type        = string
  default     = ""
}

variable "service_account_name" {
  description = "ServiceAccount the carrier pod runs as (RBAC minted by the operator; never created by this module)."
  type        = string
  default     = "converge-agent"
}
