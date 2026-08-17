# tinyland_converge_agent

> **Historical, unpublished implementation.** TIN-2609 supersedes this shell
> CronJob with GF ApplicationRelease, the sole Go owner-overlay controller,
> and owner-repository exact-plan execution. The source and tests remain as
> evidence and reusable mechanics; this module and its carrier image will not
> be published or adopted. Nothing in this README grants runtime authority.

This package records the former pull-shaped production-convergence design,
which was intended to be authored once and instantiated per tenant. The
descriptions below explain that historical design and its contract tests; they
are not current implementation instructions.

> **Name.** This module was called `tofu-agent` / `tinyland_tofu_agent_carrier`
> until 2026-08-06. The cluster repository's ADR 006
> (`docs/architecture/decisions/006-tofu-agent-implementation-home.md`,
> Receiver-only Amendment 2026-07-29) reserves the name **tofu-agent** for a
> schema/validator/client/cluster-admission/receipt surface and states
> explicitly that it is **not** an application
> plan/apply/smoke/drift engine — which is exactly what this module is. Two
> unrelated surfaces shared one name; the rename landed while this module was
> still unmerged and unpublished, because a Bazel module name is the registry
> identity key and a post-publication rename is a breaking change plus a
> compatibility shim. `converge-agent` is the name MMS's merged interface stub
> already expects and the vocabulary the doctrine already uses.

> **Publication is retired, not merely blocked.** See the historical
> publication record below. Current convergence work must use the canonical
> GF/controller/owner-executor seam.

Pattern SSOT (reference by URL, never duplicate):

- [converge-agent carrier](../../docs/patterns/converge-agent.md) — the loop,
  one-carrier rule, kill-switch-as-code
- [production convergence](../../docs/patterns/production-convergence.md) —
  §2 pre-merge admission, §3 one carrier, §5 kill switch
- stateful-workload convergence addendum (PR
  [tinyland-inc/site.scaffold#127](https://github.com/tinyland-inc/site.scaffold/pull/127))
  — state-backend contract, one-module/N-instantiations, carrier vs PR-env
  split

## What the historical package contains

| Path | Content |
| --- | --- |
| `carrier/converge-agent.sh` | The loop body: clone the overlay's `main` read-only, read the reviewed `enabled` flag at its JSON pointer, resolve the APPLICATION repository's branch head with `git ls-remote`, derive/resolve the image tag to an immutable digest, `tofu init/plan/apply` against the S3-compatible backend with `use_lockfile=true`, rollout wait, real-edge served-sha assert at the tenant's own health field (optionally through a Cloudflare Access service-token header pair), receipts to stdout |
| `templates/converge-agent-cronjob.yaml.tftpl` | CronJob manifest template (`concurrencyPolicy: Forbid`, no trigger surface) rendered per tenant; the Access probe credential appears only as a `secretKeyRef` name, and only when `edge_probe_token_secret_name` is set |
| `tofu/` | The tofu module a tenant stack instantiates: ConfigMap carrying the loop body + the CronJob as `kubernetes_manifest.converge_agent[0]` (count-gated on `var.enabled`, so the address shape never changes when a tenant arms or disarms) |
| `contract/tenant_contract.py` | The TENANT-side laws, shipped with the module and imported by both call sites — this package's suite and the adopter's copy of `scripts/test-converge-agent-contract.example.py`. One implementation per law; a tenant that reimplements a checker has forked the law |
| `tests/test_converge_agent_contract.py` | Mutation-proving contract: module laws (the kill switch, the arming gate, and the destructive-plan classifier proven by EXECUTION, not string shape) + N-tenant isolation laws + every tenant law in `contract/` (TIN-2698 shape: the policy artifact rides the package) |

### One law, one copy

The estate reached three copies of this contract — a scaffold template, an MMS
adaptation, and this suite — and the copies disagreed. The scaffold template
returned **no violations** for an illustrative loop that hard-coded
`jq -r .sha` and compared the served sha to the OVERLAY clone's `HEAD`: the two
fatals this module had to fix. A duplicate that certifies the defect its
original forbids is what duplication costs.

The split now:

- **loop-body laws** belong to the module and are proven here, by executing
  the shipped loop — a tenant does not re-verify a loop it did not write, and
  the addendum (§2, §11) forbids it from writing one;
- **tenant-declaration laws** live once in `contract/tenant_contract.py` and
  are called from both places;
- the illustrative manifest and the template's private checkers are **deleted**.
  `ConsolidationTests` in this suite fails if either reappears.

## Historical instantiation examples — do not use

The former design had each site declare the module INSIDE the tofu stack the
carrier converged, so the carrier was a resource in the state it applied:

```hcl
module "converge_agent" {
  source = "<materialized package path>/tofu"

  tenant                = "mms"
  namespace             = "massageithaca"
  overlay_repo_ssh      = "git@github.com:Medical-Massage-Specialists/medical-massage-specialists-infra.git"
  application_image_tag = "ghcr.io/medical-massage-specialists/massageithaca:main"
  edge_health_url       = "https://massageithaca.com/api/health"
  rollout_target        = "deployment/massageithaca"
  carrier_image         = "ghcr.io/tinyland-inc/converge-agent@sha256:<digest>"

  # §1 adoption prerequisite: the NAMED suspend+staleness detector covering
  # this carrier. Required — an instantiation without one refuses to compose.
  carrier_liveness_alert_ref = "<alert rule UID or overlay rule path>"

  state_backend = {
    bucket   = "tofu-state"
    key      = "mms/application/production.tfstate"
    region   = "us-east-1"
    endpoint = var.state_backend_endpoint # operator/environment authority
  }
}
```

Sites whose CI publishes **no moving tag** — only `sha-<commit>` tags, the
GFTB shape (great-falls-tool-bus-infra#103) — use template mode instead of
`application_image_tag`: the carrier substitutes `{sha}` with the `main` SHA
it just resolved, BEFORE digest resolution, and the derived ref is still
digest-pinned for the apply. Edges fronted by Cloudflare Access SSO name the
operator-minted service-token Secret so the served-sha probe can reach the
app; the credential is a name in git, values only in the Secret:

```hcl
module "converge_agent" {
  source = "<materialized package path>/tofu"

  tenant                       = "gftb"
  namespace                    = "greatfallstoolbus-org-production"
  overlay_repo_ssh             = "git@github.com:Great-Falls-Tool-Bus/great-falls-tool-bus-infra.git"
  application_image_repository = "ghcr.io/great-falls-tool-bus/greatfallstoolbus.org"
  image_tag_template           = "sha-{short7}" # exactly one image mode: this XOR application_image_tag
  edge_health_url              = "https://greatfallstoolbus.org/health"
  edge_probe_token_secret_name = "web-convergence-edge-probe" # keys client_id / client_secret
  rollout_target               = "deployment/greatfallstoolbus-org"
  carrier_image                = "ghcr.io/tinyland-inc/converge-agent@sha256:<digest>"
  carrier_liveness_alert_ref   = "<alert rule UID or overlay rule path>"

  state_backend = {
    bucket   = "tofu-state"
    key      = "gftb/application/production.tfstate"
    region   = "us-east-1"
    endpoint = var.state_backend_endpoint
  }
}
```

Then, in the same reviewed change that deletes any workflow carrier (no
interim state may run both):

```json
{
  "carrier_resource": "module.converge_agent.kubernetes_manifest.converge_agent[0]",
  "workflow_state_document": "config/workflow-state/production-converge.json"
}
```

The `[0]` is unconditional: the carrier is count-gated inside the module, so
the instance address has the same shape whether a tenant's gate is armed or
inert. site.scaffold #128 landed the declaration-schema change that admits an
index suffix on the final segment; this records the resolved historical gate.

### Two repositories, two SHAs

The overlay repository carries the tofu this agent plans and applies. The
APPLICATION repository carries the code the edge serves. At every tenant in
the estate these are different repositories, so the sha the edge reports can
never equal the overlay sha. `source_repository_url` / `source_branch` name
the application repository; its head is resolved with `git ls-remote` (no
clone), and that sha — not the overlay sha — is what the image tag is built
from and what the served-sha assert compares against. Leaving
`source_repository_url` empty falls back to the overlay sha, which is correct
only for a single-repository tenant.

### The full MMS shape

MassageIthaca publishes only `sha-<7hex>` tags, tagged with the APPLICATION
repo's `github.sha`; its stack takes `image_repository` + `image_digest` and
wants the mutable `image_tag` emptied; its health endpoint serves
`.build.commitHash`, not `.sha`; and its inert-gate law requires the stack to
compose no carrier until a reviewed ceremony arms it:

```hcl
module "converge_agent" {
  source = "<materialized package path>/tofu"

  enabled = var.enable_converge_agent # false until the activation ceremony

  tenant                  = "massageithaca"
  namespace               = var.namespace
  overlay_repo_ssh        = "git@github.com:Medical-Massage-Specialists/medical-massage-specialists-infra.git"
  overlay_branch          = "main"
  workflow_state_document = "config/production-convergence.json"
  enabled_flag_pointer    = "/enabled"

  source_repository_url = "https://github.com/Jesssullivan/MassageIthaca"
  source_branch         = "main"

  application_image_repository = var.image_repository
  image_tag_template           = "sha-{short7}"
  application_image_variable   = "" # this stack takes the digest in its own shape
  apply_variable_overrides = {
    image_tag    = ""
    image_digest = "{digest}"
  }

  stack_dir           = "tofu/stacks/application"
  backend_config_path = "tofu/backend/application-production.s3.hcl"
  var_file_path       = "tofu/stacks/application/config/production-honey.tfvars.json"

  rollout_target   = "deploy/massageithaca"
  edge_health_url  = "https://www.medicalmassagespecialists.com/api/health"
  served_sha_field = ".build.commitHash"

  cloudflare_secret_name    = var.converge_agent_cloudflare_secret_name
  registry_pull_secret_name = var.ghcr_pull_secret_name

  carrier_liveness_alert_ref = var.converge_agent_liveness_alert_ref # named at activation; the detector must exist first

  state_backend = { bucket = "tofu-state", key = "massageithaca/application/production.tfstate", region = "us-east-1", endpoint = var.state_backend_endpoint }
}
```

### Input reference (the ones a two-repository tenant needs)

| Input | Default | What it changes |
| --- | --- | --- |
| `enabled` | `true` | `count` gate: `false` composes no carrier resource at all |
| `overlay_branch` | `"main"` | The clone ref. The default is pinned by contract — this input names an integration branch, it does not license a second history |
| `enabled_flag_pointer` | `"/enabled"` | RFC 6901 pointer to the reviewed kill-switch boolean |
| `source_repository_url` / `source_branch` | `""` / `"main"` | The APPLICATION repository whose head is the served sha and the image sha |
| `served_sha_field` | `".sha"` | jq path into the health payload. A default, not a law — MMS serves `.build.commitHash` |
| `image_tag_template` | `""` | `{sha}` (40-hex) or `{short7}` (the form `docker/metadata-action` publishes for `type=sha`) |
| `backend_config_path` | `""` | Reviewed backend hcl from the clone, applied to `init` BEFORE the module's flags so the validated key wins |
| `var_file_path` | `""` | Reviewed tfvars from the clone, passed as `-var-file` at plan |
| `apply_variable_overrides` | `{}` | Additional `-var` pairs; values may carry `{digest}`, `{image}`, `{sha}`, `{short7}` |
| `application_image_variable` | `"application_image"` | Set to `""` when the overrides carry the digest instead |
| `carrier_liveness_alert_ref` | — (required) | The NAMED §1 carrier-liveness detector (suspend + staleness) covering this instantiation. No default, empty refused: a carrier nobody watches for suspension is the un-detected halt surface the doctrine forbids. Rendered as the CronJob's `tinyland.dev/carrier-liveness-alert` annotation |
| `cloudflare_secret_name` | `""` | Projects `CLOUDFLARE_API_TOKEN` + `TF_VAR_cloudflare_api_token` from a named Secret |
| `registry_pull_secret_name` | `""` | Projects a `dockerconfigjson` Secret as `/secrets/registry/config.json` + `DOCKER_CONFIG` for private-registry digest resolution |
| `deploy_key_path` | `"/secrets/deploy-key/id_ed25519"` | Where the OVERLAY key is projected. The directory is `deploy_key_secret_name`'s mountPath; the file name is the Secret key. The default reproduces the previously hard-coded path exactly |
| `application_deploy_key_secret_name` | `""` | The APPLICATION repository's own read-only deploy key — see "Reading a private application repository" below. Empty renders no second mount and no second identity |
| `application_deploy_key_path` | `"/secrets/application-deploy-key/id_ed25519"` | Same one-input rule as `deploy_key_path`, for the second key. Its directory must differ from `deploy_key_path`'s: two Secrets cannot share one mountPath |

### Reading a private application repository (the two-credential seam)

A deploy key authorizes exactly **one** repository. The loop reads **two**:
it clones the OVERLAY repository (§2.1) and resolves the APPLICATION
repository's branch head with `git ls-remote` (§2.2a). With one key, that
second read is either unauthenticated — which only ever worked while the
application repository was public — or it presents the overlay's key to the
application repository and is refused.

Setting `application_deploy_key_secret_name` turns on a second identity. The
loop then generates an ssh config with **one Host alias per role**, each
carrying its own `HostName` and its own `IdentityFile`, and routes each
remote through its own alias:

```
Host converge-agent-overlay        Host converge-agent-application
  HostName github.com               HostName github.com
  IdentityFile <deploy_key_path>    IdentityFile <application_deploy_key_path>
  IdentitiesOnly yes                IdentitiesOnly yes
```

**Why aliases and not two `IdentityFile` lines under one `Host`**: every
tenant in the estate keeps both repositories on the same host, so
`Host github.com` cannot discriminate between them — and stacking identities
does not help, because the server **accepts** the first key it can
authenticate and then refuses the repository, which is an authorization
failure ssh has no reason to retry another identity against. The aliases are
internal to the generated config; receipts keep printing the tenant's real
remotes.

Three mis-instantiations fail closed, at plan time by precondition and again
at tick time before any clone:

- a second key with `source_repository_url = ""` — a credential with no reader;
- a second key with an **https** `source_repository_url` — an https remote
  presents no ssh identity, so the key would be mounted, never used, and the
  private repository still unreadable (a failure that looks like a credential
  problem and is an addressing one);
- both key paths in one directory — two Secrets cannot share a mountPath, so
  exactly one key would actually be mounted.

**Operator ceremony** (this module creates none of it — names and paths in
git, key material only in the cluster):

1. Mint a read-only deploy key for the APPLICATION repository:
   `ssh-keygen -t ed25519 -N "" -C converge-agent@<tenant> -f <path>`.
2. Add the **public** half to that repository's Deploy keys with write access
   **off** (GitHub → Settings → Deploy keys). The loop only ever runs
   `git ls-remote`; write access is never needed and never granted.
3. Put the **private** half into the lab's SOPS custody, then create the
   Secret in the tenant's namespace with the key stored under the file name
   `application_deploy_key_path` ends in (default `id_ed25519`).
4. Declare `application_deploy_key_secret_name` in the tenant's
   instantiation, and give `source_repository_url` its SSH form
   (`git@github.com:<org>/<repo>.git`). Apply plan-first.
5. Delete the local private half. The next tick's receipt line
   (`ssh_identities=overlay+application`) is the evidence it landed.

### The stateful contract inputs (addendum "Machine-readable contract")

| Input | Default | What it changes |
| --- | --- | --- |
| `armed_flag_pointer` | `"/armed"` | RFC 6901 pointer to the ARMING boolean — §10's complement to the kill switch, never the same flag. A precondition forbids aliasing it onto `enabled_flag_pointer` |
| `durable_data_addresses` | `[]` | The addresses §4 refuses to destroy. Empty is legitimate for a stateless tenant and a lie for any other — `contract/tenant_contract.py` is what stops a stack with a PVC in it from declaring none |
| `destroy_admission_pointer` | `"/destroy_admission"` | Where the reviewed `{addresses, reason}` admission lives. Absent is the normal value |
| `ephemeral` | `false` | §7.2 rule 5: `true` is the standing admission to destroy this stack's durable data. A precondition forbids it on a `production.tfstate` key |

**`armed` is the one input whose default does NOT reproduce prior behaviour,
deliberately.** An absent flag HALTS: the reviewed default is unarmed, so a
document whose arming ceremony never happened must not converge. The two halts
carry different receipts — `halted=not-armed` versus
`halted=reviewed-enabled-false` — because collapsing them makes "stop the
runaway carrier" and "never started it" indistinguishable in history.

Every other default reproduces the behaviour the module had before the input
existed, so adopting a new input is opt-in and adding one was additive.

The design intended this input set to be the complete per-site authority and
for every adopter to instantiate the same module. That adoption direction was
superseded before publication; future needs belong in the canonical
GF/controller/owner-executor contracts, not new inputs here.

Not created by this module (operator-minted, separately reviewed, custody
stays in the stack): the namespace, the `converge-agent` ServiceAccount + RBAC,
the read-only deploy-key Secret (and, when the two-credential seam is on, the
application repository's own deploy-key Secret), and the state-backend
credential Secret.

## Historical registry-consumer shape — no release exists

The following was the planned graph shape. There is no authorized
`tinyland_converge_agent` registry release, so consumers must not add it.

```starlark
bazel_dep(name = "tinyland_converge_agent", version = "0.1.0")
```

then materialize `@tinyland_converge_agent//:module_srcs` into the
consuming stack (`copy_to_directory` from aspect_bazel_lib, or `pkg_tar`),
and point the `module` block's `source` at the materialized path — the same
graph-materialization idiom the scaffold uses for its `@tummycrypt/*`
packages. Checking the module body into a site repository is drift; a forked
loop body is a second authority wearing the first one's name.

## Contract test

```sh
python3 tests/test_converge_agent_contract.py   # or: bazel test //:contract_test
```

Every law is mutation-proven: a dead-conditioned kill switch goes red, a tag
reaching apply goes red, a second declared carrier goes red, a shared state
key or namespace goes red, a workflow naming a converged stack or state key
goes red — and the conforming module plus an N-tenant disjoint fixture stay
green.

The kill-switch law is proven by **execution**, not string shape: the suite
runs the shipped loop body under bash with a stubbed toolchain against
`enabled:true` and `enabled:false` workflow-state fixtures and asserts the
two ticks diverge (quiet `exit 0` touching no registry/plan/apply tool,
versus a full converge). A gate that keeps every §2.2 string while never
gating — `if false && jq ...`, the evasion found in adversarial review —
fails this check.

Standing gates (this directory is `.bazelignore`d from the root graph on
purpose, so the root Bazel lanes never run this suite): the
`carrier-module-contract` job in `.github/workflows/ci.yml` (required via
`merge-gate`) and item 17b of `scripts/check-conformance.sh`
(`just conformance` / `just scaffold-doctor`), plus the
`just converge-agent-module-contract` target for humans.

Tenancy honesty: real tenants are separate repositories, so the cross-repo
checker is `instantiation_set_violations(stacks, workflow_scans)` — it
verifies whatever set of checkouts the caller hands it, and the suite proves
it over the real per-site-repo topology (no `tenants/` wrapper). No standing
cross-repo registry of instantiations exists yet; until an aggregator lane
clones the real tenant repos and drives that function, fixture green means
"the checker is self-consistent", never "GFTB/MMS/tinyland.dev cannot
collide". State-key/namespace collision across live repos remains an
operator-reviewed property, exactly as the Non-authorization section says.

## Registry publication — HISTORICAL, NOT AUTHORIZED

The following is retained to explain the pre-supersession publication design.
It is not a ceremony to execute. No module or carrier image was published, and
the canonical successor does not consume this shell implementation.

1. **RESOLVED IN SOURCE, NOT RUNTIME — MMS
   #69.** The addendum promises every site "the same QA LOOK PR-env setup"
   before merge and a `main`-only agent after. This module is the second
   mechanism. As of MMS #69 (`medical-massage-specialists-infra`, merged
   2026-08-10) it is no longer true that "there is no
   published PR-env producer/reaper anywhere in the estate": MMS's
   `config/pr-env-lifecycle.json` no longer records "the reusable piece
   does not exist yet anywhere" — it now documents an authored, reviewed,
   merged producer (`scripts/reconcile-pr-env-lanes.sh` driving the
   existing `scripts/application-plan-binding.py` `pr-upsert`/`pr-destroy`
   action classes, called from the rewritten
   `.github/workflows/pr-env-lifecycle.yml`). Current MMS `main` records the
   preview backend and App-permission gaps closed, while
   `config/workflow-state/pr-env-lifecycle.json` remains `enabled: false` with
   null runtime receipts. Independently unverified here:
   MassageIthaca's `.github/workflows/pr-env-lanes.yml` structural-no-op
   claim, GFTB's parked schema, and `ci-templates`' deprecated
   `spoke-lane-env` family. The production carrier is `main`==prod per
   §7.1: the state-key validation admits `<site>/<stack>/production.tfstate`
   plus the documented spoke PR-lane shape
   (`spokes/<site>/pr/<n>/lanes/<lane>/opentofu.tfstate`, blahaj
   `tofu/intent/spoke-managed-state.schema.json`), both tenant-scoped —
   which is the part of this gate's original prediction MMS #69 actually
   reused. It did **not** instantiate this module: the producer calls
   `application-plan-binding.py` directly and composes no shell-CronJob
   loop, so it is outside this module's supersession. Scaffold #143 and #145
   later landed narrow external-consumer and credential mechanics, while the
   image carrier #144 closed preserved at its pull ref after failed runtime
   proof.
   None of those events published or adopted the module. Shipping this module
   with release language implying the other two mechanisms (GFTB,
   ci-templates) exist would still be false, and — independent of this
   gate — publication of the shell-CronJob loop itself is retired under the
   GF-I09 successor.
2. **RESOLVED 2026-08-07 — site.scaffold#128 landed.** The declaration schema
   now admits the index-suffixed carrier address this module emits. Kept for
   the record; no longer a gate.
3. **RESOLVED IN SOURCE — GFTB site #164.** The application `/health` response
   now includes the existing build `sha`. That repair closed the historical
   `served_sha_field` source blocker; it did not authorize or instantiate this
   shell carrier. No shell-carrier alignment remains pending because the
   adoption path itself is retired.
4. **RESOLVED 2026-08-08 — the source-home is settled by R0**
   ([docs/decisions/tofu-carrier-module-home.md](../../docs/decisions/tofu-carrier-module-home.md),
   merged via #132): this repository is the module home; GloriousFlywheel is
   not and carries no converge-agent module. **The residue this line used to
   name is also resolved**: the 2026-08-07 MMS rename to
   `tofu/stacks/application/converge-agent.tf` (from `tofu-agent.tf`, matching
   this module's #129 de-collision sweep) left the MMS overlay's
   `converge_agent_module_home` local reading
   `"tinyland-inc/site.scaffold//modules/converge_agent"` — it no longer
   names the nonexistent GloriousFlywheel path. Verified on MMS `main` after
   #69: no `tofu-agent.tf` file remains and no
   `module_home_expected`/GloriousFlywheel-path reference exists anywhere
   under `tofu/`. No residue is left for the MMS lane to re-point. The former
   interface stub is now paired with `converge-agent-module.tf`, whose module
   call remains count-zero under `enabled = false`. Both paths are inert
   historical evidence; repo-root `docs/convergence-map.md` supersedes their
   activation with the canonical GF/controller/owner-executor workstreams.

The retired mechanical steps were:

1. Land this module on `main`, then tag the release:
   `git tag converge-agent/v0.1.0 && git push origin converge-agent/v0.1.0`
   (annotated + signed per house practice).
2. Compute the source archive integrity from the tag:
   `curl -fsSL https://github.com/tinyland-inc/site.scaffold/archive/refs/tags/converge-agent/v0.1.0.tar.gz | openssl dgst -sha256 -binary | openssl base64 -A`
3. In `tinyland-inc/bazel-registry`, mint
   `modules/tinyland_converge_agent/0.1.0/` containing:
   - `MODULE.bazel` — byte-identical copy of this module's `MODULE.bazel`;
   - `source.json` — the tag tarball URL above,
     `"strip_prefix": "site.scaffold-converge-agent-v0.1.0/modules/converge_agent"`
     (GitHub replaces `/` with `-` in the archive prefix), and the
     `sha256-…` integrity from step 2;
   and append `0.1.0` to `modules/tinyland_converge_agent/metadata.json`
   (homepage: this directory's URL on `main`).
4. Open the registry PR; the immutability gate
   (`scripts/check-immutable-versions.sh`) treats the minted version
   directory as frozen forever after — fixes are new versions, never edits.
5. Before the first registry mint, resolve the source-home boundary flag:
   `tinyland.repo.json` currently declares
   `owns_bazel_module_authority: false` for this repository. Either flip it
   in a reviewed change that names this module as the exception, or relocate
   the module source to a dedicated repository (the registry's existing
   one-repo-per-module convention) and publish from there. That decision is
   the operator's; this package is buildable from either home.

## Historical MMS coordination record

This section records the pre-supersession mismatch audit; it is not current MMS
implementation guidance. Current MMS `main` contains `converge-agent.tf` plus
a count-zero `converge-agent-module.tf`, and that inert shell-module path is
not the canonical successor.

At the time of the audit, the MMS interface and this unpublished module used
different instance names, module-home fields, tenant/backend inputs, image
variable names, digest placeholders, and liveness-detector declarations. Those
were risks in the retired activation design, not work the MMS lane still owes.
MMS subsequently corrected the source-home/filename residue and retained the
path inert. GFTB infra #103, which carried a different SHA placeholder, is
preserved-closed under TIN-2609; no shell-carrier alignment or instantiation is
pending there either.

### Historical MMS contract-test disposition

MMS #59 renamed the historical tenant suite to
`scripts/test-converge-agent-contract.py`. The pre-supersession disposition was
to replace reusable loop laws with this package's tenant-contract functions
while retaining only MMS-specific source facts. Current MMS `main` already
records `armed: false`, `ephemeral: false`, and `durable_data_addresses`; those
are completed source facts, not remaining shell-module activation work. The
suite and inert declarations remain historical evidence until their owner lane
retires them through its own reviewed change.

## Non-authorization

This package does not create a CronJob, provision a deploy key,
state-backend credential, or edge-probe service token, apply infrastructure,
publish itself to any registry, enumerate the estate's real instantiations,
or prove any tenant converges or is isolated. Runtime truth — lock behavior
under contention, actual cross-tenant isolation, whether a converge happened
— lives in receipts emitted by running carriers, never in source assertions.
