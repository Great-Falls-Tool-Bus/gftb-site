#!/usr/bin/env bash
# converge-agent loop — the pull-shaped converge, authored once and
# instantiated per tenant.
#
# Pattern SSOT (reference, never duplicate):
#   docs/patterns/converge-agent.md                §2 (the loop, in order)
#   docs/patterns/production-convergence.md        §3 (one carrier), §5 (kill switch)
#   docs/patterns/stateful-workload-convergence.md §1 (state backend), §2 (N tenants)
#
# Every tenant-specific value below arrives from the CronJob environment
# (rendered by ../tofu from the instantiation's input set). Nothing per-site
# lives in this body: a per-site behavioral difference is either an input or
# a reviewed upstream change here — never a fork.
#
# TWO REPOSITORIES, TWO SHAS. The overlay repository carries the tofu the
# agent plans/applies; the APPLICATION repository carries the code the edge
# serves. At every tenant in the estate they are different repositories, so
# the sha the edge reports can never equal the overlay sha. The image tag and
# the served-sha assert are both APPLICATION-repository facts; the overlay
# sha is only the provenance of the plan.
set -euo pipefail

require() {
  local name
  for name in "$@"; do
    if [ -z "${!name:-}" ]; then
      echo "converge-agent: required environment variable ${name} is unset" >&2
      exit 1
    fi
  done
}

# RFC 6901 JSON pointer -> jq path, so the reviewed flags may live at any key
# of the workflow-state document (MMS keeps the kill switch at /enabled of
# config/production-convergence.json; a nested document is equally valid).
pointer_to_jq() {
  local pointer="${1}" segment filter=""
  local -a segments=()
  if [ "${pointer#/}" = "${pointer}" ] && [ -n "${pointer}" ]; then
    echo "converge-agent: ${2:-ENABLED_FLAG_POINTER} must be an RFC 6901 pointer starting with / (got ${pointer})" >&2
    exit 1
  fi
  pointer="${pointer#/}"
  if [ -z "${pointer}" ]; then
    echo "converge-agent: ${2:-ENABLED_FLAG_POINTER} must name a field, not the whole document" >&2
    exit 1
  fi
  local IFS='/'
  read -r -a segments <<<"${pointer}"
  for segment in "${segments[@]}"; do
    segment="${segment//"~1"/"/"}"
    segment="${segment//"~0"/"~"}"
    filter+=".\"${segment}\""
  done
  printf '%s' "${filter}"
}

require TENANT NAMESPACE OVERLAY_REPO_SSH WORKFLOW_STATE_DOCUMENT STACK_DIR \
  EDGE_HEALTH_URL \
  STATE_BACKEND_BUCKET STATE_BACKEND_KEY STATE_BACKEND_REGION \
  STATE_BACKEND_ENDPOINT ROLLOUT_TARGET

# Inputs whose defaults reproduce the pre-input behaviour exactly: a tenant
# that sets none of them gets the same loop it got before they existed.
OVERLAY_BRANCH="${OVERLAY_BRANCH:-main}"
SOURCE_BRANCH="${SOURCE_BRANCH:-main}"
ENABLED_FLAG_POINTER="${ENABLED_FLAG_POINTER:-/enabled}"
# Addendum §10 — the arming gate is the kill switch's complement, NOT the same
# flag: unarmed means "never started", killed means "stop what is running".
# Its reviewed default is unarmed, so an ABSENT flag halts. Fail-closed is the
# whole point: a document with no `armed` key is a document whose arming
# ceremony never happened.
ARMED_FLAG_POINTER="${ARMED_FLAG_POINTER:-/armed}"
# Addendum §4 — the destructive-plan admission, read from the SAME reviewed
# document as the kill switch, consumed by one converge.
DESTROY_ADMISSION_POINTER="${DESTROY_ADMISSION_POINTER:-/destroy_admission}"
# Addendum §3 — the tenant's durable-data resource addresses. Empty means the
# tenant declares no durable data; the tenant-side contract
# (contract/tenant_contract.py) is what stops that from being a lie.
DURABLE_DATA_ADDRESSES="${DURABLE_DATA_ADDRESSES:-[]}"
# Addendum §7.2 rule 5 — `ephemeral: true` is the standing admission to
# destroy the durable data this stack owns, declared at birth. A production
# stack declares false and can never carry it.
EPHEMERAL="${EPHEMERAL:-false}"
SERVED_SHA_FIELD="${SERVED_SHA_FIELD:-.sha}"
APPLY_VARIABLE_OVERRIDES="${APPLY_VARIABLE_OVERRIDES:-}"
[ -n "${APPLY_VARIABLE_OVERRIDES}" ] || APPLY_VARIABLE_OVERRIDES='{}'
ROLLOUT_TIMEOUT="${ROLLOUT_TIMEOUT:-5m}"

case "${SERVED_SHA_FIELD}" in
  .*) ;;
  *)
    echo "converge-agent: SERVED_SHA_FIELD must be a jq path beginning with '.' (e.g. .sha or .build.commitHash)" >&2
    exit 1
    ;;
esac

if ! printf '%s' "${APPLY_VARIABLE_OVERRIDES}" | jq -e 'type == "object"' >/dev/null 2>&1; then
  echo "converge-agent: APPLY_VARIABLE_OVERRIDES must be a JSON object of tofu variable name -> value" >&2
  exit 1
fi

if ! printf '%s' "${DURABLE_DATA_ADDRESSES}" | jq -e 'type == "array" and all(type == "string")' >/dev/null 2>&1; then
  echo "converge-agent: DURABLE_DATA_ADDRESSES must be a JSON array of tofu resource addresses" >&2
  exit 1
fi

case "${EPHEMERAL}" in
  true | false) ;;
  *)
    echo "converge-agent: EPHEMERAL must be exactly true or false — the declaration that decides whether a reap is a lifecycle or an incident is not a fuzzy value" >&2
    exit 1
    ;;
esac

# The resolved digest must reach apply through SOME reviewed channel: either
# the module's own -var (APPLICATION_IMAGE_VARIABLE), or an override value
# carrying the {digest}/{image} placeholder (the MMS shape, where the stack
# takes image_repository + image_digest and the mutable image_tag is emptied).
# Neither is a moving tag reaching apply by omission.
if [ -z "${APPLICATION_IMAGE_VARIABLE:-}" ] &&
  ! printf '%s' "${APPLY_VARIABLE_OVERRIDES}" | jq -e '[.[] | strings | test("\\{digest\\}|\\{image\\}")] | any' >/dev/null; then
  echo "converge-agent: with APPLICATION_IMAGE_VARIABLE unset, APPLY_VARIABLE_OVERRIDES must carry {digest} or {image}; otherwise the resolved digest never reaches apply" >&2
  exit 1
fi

# Exactly one image mode, validated before any work happens (§2.3a):
#   moving-tag mode    — APPLICATION_IMAGE_TAG names which line to follow;
#   template mode      — sites whose CI publishes no moving tag (only
#                        sha-<commit> tags: the GFTB and MassageIthaca shape)
#                        set IMAGE_TAG_TEMPLATE + APPLICATION_IMAGE_REPOSITORY,
#                        and the tag is derived from the resolved APPLICATION
#                        sha below, BEFORE digest resolution.
if [ -n "${IMAGE_TAG_TEMPLATE:-}" ]; then
  require APPLICATION_IMAGE_REPOSITORY
  if [ -n "${APPLICATION_IMAGE_TAG:-}" ]; then
    echo "converge-agent: set APPLICATION_IMAGE_TAG or IMAGE_TAG_TEMPLATE, never both — two image authorities is none" >&2
    exit 1
  fi
  case "${IMAGE_TAG_TEMPLATE}" in
    *"{sha}"* | *"{short7}"*) ;;
    *)
      echo "converge-agent: IMAGE_TAG_TEMPLATE must carry the {sha} or {short7} placeholder (e.g. sha-{short7}); a template that ignores the resolved SHA is a moving tag wearing a template's name" >&2
      exit 1
      ;;
  esac
elif [ -z "${APPLICATION_IMAGE_TAG:-}" ]; then
  echo "converge-agent: one of APPLICATION_IMAGE_TAG (moving-tag mode) or IMAGE_TAG_TEMPLATE with APPLICATION_IMAGE_REPOSITORY (template mode) is required" >&2
  exit 1
fi

WORK="$(mktemp -d)"
trap 'rm -rf "${WORK}"' EXIT
OVERLAY_DIR="${WORK}/overlay"

# ------------------------------------------------ application credential --
#
# TWO REPOSITORIES, TWO CREDENTIALS (operator ruling 2026-08-13, D1). The
# overlay clone (§2.1) and the application ls-remote (§2.2a) read two
# DIFFERENT repositories, and a deploy key authorizes exactly ONE repository.
# So a tenant whose APPLICATION repository is private cannot be served by the
# overlay's key alone: the ls-remote either goes out unauthenticated (which
# only ever worked because the application repository was public) or presents
# the overlay key to the application repository and is refused.
#
# The seam is a SECOND KEY PATH, never a second mechanism. Empty
# APPLICATION_DEPLOY_KEY_PATH — the default, and what every existing
# instantiation renders — leaves GIT_SSH_COMMAND exactly as the manifest set
# it: one identity, the pre-input behaviour byte for byte.
#
# WHY HOST ALIASES rather than plain per-host blocks: every tenant in the
# estate keeps both repositories on the SAME host (github.com), so a
# `Host github.com` block cannot discriminate between them, and stacking two
# IdentityFile lines under one Host does not work either — the server accepts
# the FIRST key it can authenticate and then refuses the repository, which is
# an authorization failure ssh has no reason to retry another identity
# against. One Host ALIAS per role, each carrying its own HostName and its own
# IdentityFile, is the only shape that routes two credentials to one host. The
# aliases are internal to this generated config; receipts keep printing the
# tenant's real remotes.
OVERLAY_DEPLOY_KEY_PATH="${OVERLAY_DEPLOY_KEY_PATH:-/secrets/deploy-key/id_ed25519}"
APPLICATION_DEPLOY_KEY_PATH="${APPLICATION_DEPLOY_KEY_PATH:-}"
OVERLAY_SSH_ALIAS="converge-agent-overlay"
APPLICATION_SSH_ALIAS="converge-agent-application"
# What git is actually handed. Identical to the tenant's declared remotes
# unless the seam is configured below.
OVERLAY_REMOTE="${OVERLAY_REPO_SSH}"
APPLICATION_REMOTE="${SOURCE_REPOSITORY_URL:-}"

# Host of an ssh remote in either canonical form; empty for anything else
# (an https remote, which carries no ssh identity to route).
ssh_remote_host() {
  local url="${1}"
  case "${url}" in
    ssh://*)
      url="${url#ssh://}"
      url="${url#*@}"
      url="${url%%/*}"
      printf '%s' "${url}"
      ;;
    *@*:*)
      url="${url#*@}"
      printf '%s' "${url%%:*}"
      ;;
    *)
      printf ''
      ;;
  esac
}

# The same remote with its host replaced by a config alias.
ssh_remote_alias() {
  local url="${1}" host_alias="${2}" user=""
  case "${url}" in
    ssh://*)
      url="${url#ssh://}"
      case "${url}" in
        *@*) user="${url%%@*}" ;;
      esac
      url="${url#*@}"
      printf 'ssh://%s%s/%s' "${user:+${user}@}" "${host_alias}" "${url#*/}"
      ;;
    *@*:*)
      printf '%s@%s:%s' "${url%%@*}" "${host_alias}" "${url#*:}"
      ;;
    *)
      # Unreachable: both remotes are proven ssh-shaped by ssh_remote_host
      # before this is called. Echoing the input unchanged rather than
      # nothing keeps a future caller from silently handing git an empty
      # remote.
      printf '%s' "${url}"
      ;;
  esac
}

if [ -n "${APPLICATION_DEPLOY_KEY_PATH}" ]; then
  if [ -z "${APPLICATION_REMOTE}" ]; then
    echo "converge-agent: APPLICATION_DEPLOY_KEY_PATH is set but SOURCE_REPOSITORY_URL is empty — a credential minted for a repository the loop never reads is a mis-instantiation, not a default" >&2
    exit 1
  fi
  OVERLAY_SSH_HOST="$(ssh_remote_host "${OVERLAY_REMOTE}")"
  APPLICATION_SSH_HOST="$(ssh_remote_host "${APPLICATION_REMOTE}")"
  if [ -z "${OVERLAY_SSH_HOST}" ]; then
    echo "converge-agent: OVERLAY_REPO_SSH (${OVERLAY_REMOTE}) is not an ssh remote this loop can route a key to (git@host:path or ssh://[user@]host/path)" >&2
    exit 1
  fi
  if [ -z "${APPLICATION_SSH_HOST}" ]; then
    echo "converge-agent: an application deploy key is configured but SOURCE_REPOSITORY_URL (${APPLICATION_REMOTE}) is not an ssh remote — an https remote presents no ssh identity, so the key would be silently unused and a private repository would still be unreadable" >&2
    exit 1
  fi
  for key_path in "${OVERLAY_DEPLOY_KEY_PATH}" "${APPLICATION_DEPLOY_KEY_PATH}"; do
    if [ ! -r "${key_path}" ]; then
      echo "converge-agent: deploy key unreadable at ${key_path} — the operator-minted Secret is absent, misnamed, or projected under a different filename; refusing to tick with one identity when two were declared" >&2
      exit 1
    fi
  done
  SSH_CONFIG="${WORK}/ssh_config"
  cat >"${SSH_CONFIG}" <<EOF
Host ${OVERLAY_SSH_ALIAS}
  HostName ${OVERLAY_SSH_HOST}
  IdentityFile ${OVERLAY_DEPLOY_KEY_PATH}
  IdentitiesOnly yes
  StrictHostKeyChecking accept-new

Host ${APPLICATION_SSH_ALIAS}
  HostName ${APPLICATION_SSH_HOST}
  IdentityFile ${APPLICATION_DEPLOY_KEY_PATH}
  IdentitiesOnly yes
  StrictHostKeyChecking accept-new
EOF
  chmod 600 "${SSH_CONFIG}"
  export GIT_SSH_COMMAND="ssh -F ${SSH_CONFIG} -o IdentitiesOnly=yes"
  OVERLAY_REMOTE="$(ssh_remote_alias "${OVERLAY_REMOTE}" "${OVERLAY_SSH_ALIAS}")"
  APPLICATION_REMOTE="$(ssh_remote_alias "${APPLICATION_REMOTE}" "${APPLICATION_SSH_ALIAS}")"
  echo "receipt tenant=${TENANT} ssh_identities=overlay+application overlay_host=${OVERLAY_SSH_HOST} application_host=${APPLICATION_SSH_HOST}"
fi

# §2.1 — clone the overlay's integration branch over the read-only deploy key.
# OVERLAY_BRANCH defaults to main and the module pins that default: the branch
# is an input so a tenant can NAME its integration branch, never so a tick can
# follow a second history.
git clone --depth 1 --branch "${OVERLAY_BRANCH}" "${OVERLAY_REMOTE}" "${OVERLAY_DIR}"
cd "${OVERLAY_DIR}"
OVERLAY_SHA="$(git rev-parse HEAD)"
echo "receipt tenant=${TENANT} overlay_sha=${OVERLAY_SHA} overlay_branch=${OVERLAY_BRANCH}"

# Addendum §10 — the ARMING gate, read first and kept distinct from the kill
# switch. Two flags, two meanings, two receipts: collapsing them makes "stop
# the runaway carrier" and "never started it" indistinguishable in history.
# Unarmed halts at exit 0 for the same reason a killed tick does — an inert
# mechanism is not a failing one — but under its own receipt.
ARMED_FLAG_FILTER="$(pointer_to_jq "${ARMED_FLAG_POINTER}" ARMED_FLAG_POINTER)"
if ! jq -e "${ARMED_FLAG_FILTER} == true" "${WORKFLOW_STATE_DOCUMENT}" >/dev/null; then
  echo "receipt tenant=${TENANT} halted=not-armed"
  exit 0
fi

# §2.2 — the reviewed kill switch is read before any registry read, remote
# resolution, plan, or apply. A halted tick is a successful tick: exit 0,
# quietly.
ENABLED_FLAG_FILTER="$(pointer_to_jq "${ENABLED_FLAG_POINTER}")"
if ! jq -e "${ENABLED_FLAG_FILTER} == true" "${WORKFLOW_STATE_DOCUMENT}" >/dev/null; then
  echo "receipt tenant=${TENANT} halted=reviewed-enabled-false"
  exit 0
fi

# Addendum §4 — the destroy admission is read from the SAME reviewed document,
# here, while the clone is still the working directory. Absent is the normal
# value; an admission is consumed by one converge and the next tick reads a
# document without it.
DESTROY_ADMISSION_FILTER="$(pointer_to_jq "${DESTROY_ADMISSION_POINTER}" DESTROY_ADMISSION_POINTER)"
ADMITTED_ADDRESSES="$(jq -r "${DESTROY_ADMISSION_FILTER} // empty | .addresses[]? // empty" "${WORKFLOW_STATE_DOCUMENT}")"

# §2.2a — resolve the APPLICATION sha. This is the sha the edge serves and the
# sha the image tag is built from; it comes from the application repository,
# never from the overlay. ls-remote needs no clone and no working tree.
# Unset SOURCE_REPOSITORY_URL keeps the pre-input behaviour (single-repository
# tenants, where the two shas genuinely coincide).
if [ -n "${SOURCE_REPOSITORY_URL:-}" ]; then
  APPLICATION_SHA="$(git ls-remote "${APPLICATION_REMOTE}" "refs/heads/${SOURCE_BRANCH}" | awk 'NR==1{print $1}')"
  if ! printf '%s' "${APPLICATION_SHA}" | grep -Eq '^[0-9a-f]{40}$'; then
    echo "converge-agent: could not resolve refs/heads/${SOURCE_BRANCH} at ${SOURCE_REPOSITORY_URL}" >&2
    exit 1
  fi
else
  APPLICATION_SHA="${OVERLAY_SHA}"
fi
echo "receipt tenant=${TENANT} application_sha=${APPLICATION_SHA} source=${SOURCE_REPOSITORY_URL:-<overlay>}@${SOURCE_BRANCH}"

# §2.3a — template mode: derive the tag to follow from the resolved
# APPLICATION sha, BEFORE digest resolution. {short7} is the 7-hex short form
# docker/metadata-action publishes by default (type=sha); {sha} is the full
# 40-hex. The template names which line to follow, never what gets applied —
# the derived ref is still resolved to an immutable digest immediately below.
if [ -n "${IMAGE_TAG_TEMPLATE:-}" ]; then
  RENDERED_IMAGE_TAG="${IMAGE_TAG_TEMPLATE}"
  RENDERED_IMAGE_TAG="${RENDERED_IMAGE_TAG//\{sha\}/${APPLICATION_SHA}}"
  RENDERED_IMAGE_TAG="${RENDERED_IMAGE_TAG//\{short7\}/${APPLICATION_SHA:0:7}}"
  APPLICATION_IMAGE_TAG="${APPLICATION_IMAGE_REPOSITORY}:${RENDERED_IMAGE_TAG}"
  echo "receipt tenant=${TENANT} derived_image_tag=${APPLICATION_IMAGE_TAG}"
fi

# §2.3 — resolve the moving tag to an immutable digest at plan time. The tag
# names which line to follow; the digest is what gets applied. A moving tag
# reaching an apply is a defect, not a convenience.
DIGEST="$(crane digest "${APPLICATION_IMAGE_TAG}")"
echo "receipt tenant=${TENANT} applied_digest=${APPLICATION_IMAGE_TAG%%:*}@${DIGEST}"

# Addendum §1 + §2.4 — S3-compatible backend, native lockfile. Two locks,
# two layers: concurrencyPolicy Forbid on the schedule half, use_lockfile on
# the state half. Backend credentials arrive only through the carrier's own
# secretRef inside the stack — CI runners are never provisioned with them.
# An optional reviewed backend hcl from the clone is applied FIRST so the
# module's validated state coordinates always win the merge.
TOFU_INIT_ARGS=(-input=false)
if [ -n "${BACKEND_CONFIG_PATH:-}" ]; then
  TOFU_INIT_ARGS+=(-backend-config="${OVERLAY_DIR}/${BACKEND_CONFIG_PATH}")
fi
TOFU_INIT_ARGS+=(
  -backend-config="bucket=${STATE_BACKEND_BUCKET}"
  -backend-config="key=${STATE_BACKEND_KEY}"
  -backend-config="region=${STATE_BACKEND_REGION}"
  -backend-config="endpoint=${STATE_BACKEND_ENDPOINT}"
  -backend-config="use_lockfile=true"
)

cd "${STACK_DIR}"
tofu init "${TOFU_INIT_ARGS[@]}"

TOFU_PLAN_ARGS=(-input=false -out="${WORK}/tfplan")
if [ -n "${VAR_FILE_PATH:-}" ]; then
  TOFU_PLAN_ARGS+=(-var-file="${OVERLAY_DIR}/${VAR_FILE_PATH}")
fi
if [ -n "${APPLICATION_IMAGE_VARIABLE:-}" ]; then
  TOFU_PLAN_ARGS+=(-var "${APPLICATION_IMAGE_VARIABLE}=${APPLICATION_IMAGE_TAG%%:*}@${DIGEST}")
fi
# Reviewed per-tenant variable overrides. Values may carry the same
# placeholders the loop already resolved, so a stack that takes the digest in
# its own shape (MMS: image_tag emptied, image_digest pinned) needs no fork.
while IFS= read -r override_name; do
  [ -n "${override_name}" ] || continue
  override_value="$(printf '%s' "${APPLY_VARIABLE_OVERRIDES}" | jq -r --arg k "${override_name}" '.[$k]')"
  override_value="${override_value//\{digest\}/${DIGEST}}"
  override_value="${override_value//\{image\}/${APPLICATION_IMAGE_TAG%%:*}@${DIGEST}}"
  override_value="${override_value//\{short7\}/${APPLICATION_SHA:0:7}}"
  override_value="${override_value//\{sha\}/${APPLICATION_SHA}}"
  TOFU_PLAN_ARGS+=(-var "${override_name}=${override_value}")
  echo "receipt tenant=${TENANT} apply_override=${override_name}"
done < <(printf '%s' "${APPLY_VARIABLE_OVERRIDES}" | jq -r 'keys[]')

tofu plan "${TOFU_PLAN_ARGS[@]}"

# Addendum §4 — classify the plan BEFORE applying it. A plan that destroys or
# replaces a declared durable-data resource halts the tick non-zero and applies
# NOTHING, naming the exact addresses it refused. This is not a gate: nothing
# review approved is withheld, because the reviewer approved a source diff and
# a destroy that diff turned out to imply is not the thing that was reviewed.
# The unblock is a source act — a `destroy_admission` in the reviewed
# workflow-state document, or `ephemeral: true` declared at the stack's birth
# (§7.2 rule 5), which is the standing admission a production stack can never
# carry.
if [ "${DURABLE_DATA_ADDRESSES}" != "[]" ]; then
  tofu show -json "${WORK}/tfplan" >"${WORK}/plan.json"
  REFUSED=""
  while IFS= read -r planned_address; do
    [ -n "${planned_address}" ] || continue
    # The WATCH is base-normalized on BOTH sides: a count/for_each-gated
    # durable resource plans as `address[0]` while the declaration carries the
    # base form (the tenant laws strip the same suffix), so an exact match here
    # is a classifier every gated tenant bypasses. The UNLOCK below stays
    # exact: an admission names the address the refusal receipt printed.
    printf '%s' "${DURABLE_DATA_ADDRESSES}" |
      jq -e --arg a "${planned_address}" \
        'def base: sub("\\[[^\\]]*\\]$"; ""); [.[] | base] | index($a | base) != null' >/dev/null || continue
    if [ "${EPHEMERAL}" = "true" ]; then
      echo "receipt tenant=${TENANT} ephemeral_destroy_admitted=${planned_address}"
      continue
    fi
    if printf '%s\n' "${ADMITTED_ADDRESSES}" | grep -Fxq "${planned_address}"; then
      echo "receipt tenant=${TENANT} destroy_admitted=${planned_address}"
      continue
    fi
    REFUSED="${REFUSED}${REFUSED:+,}${planned_address}"
  done < <(jq -r '[.resource_changes[]? | select((.change.actions // []) | index("delete")) | .address] | .[]' "${WORK}/plan.json")
  if [ -n "${REFUSED}" ]; then
    echo "receipt tenant=${TENANT} halted=destructive-plan refused=${REFUSED}"
    echo "converge-agent: plan would destroy or replace declared durable data (${REFUSED}); applying nothing" >&2
    exit 1
  fi
fi

tofu apply -input=false "${WORK}/tfplan"

# §2.5 — pinned is not running.
kubectl -n "${NAMESPACE}" rollout status "${ROLLOUT_TARGET}" \
  --timeout="${ROLLOUT_TIMEOUT}"

# §2.6 — running is not served: assert the sha at the real edge, through the
# public hostname and its full ingress path. A pod curl is not evidence.
# SERVED_SHA_FIELD is the jq path the tenant's health payload actually uses
# (MMS serves .build.commitHash; the default .sha is only a default).
# Edges fronted by Cloudflare Access SSO (GFTB blocker B2) present the
# operator-minted service-token header pair; the credential arrives only via
# the CronJob's secretKeyRef — names in git, values never.
EDGE_PROBE_HEADER_ARGS=()
if [ -n "${CF_ACCESS_CLIENT_ID:-}" ] && [ -n "${CF_ACCESS_CLIENT_SECRET:-}" ]; then
  EDGE_PROBE_HEADER_ARGS+=(-H "CF-Access-Client-Id: ${CF_ACCESS_CLIENT_ID}" -H "CF-Access-Client-Secret: ${CF_ACCESS_CLIENT_SECRET}")
fi
SERVED_SHA="$(curl -fsS ${EDGE_PROBE_HEADER_ARGS[@]+"${EDGE_PROBE_HEADER_ARGS[@]}"} "${EDGE_HEALTH_URL}" | jq -r "${SERVED_SHA_FIELD}")"
if [ "${SERVED_SHA}" != "${APPLICATION_SHA}" ]; then
  echo "converge-agent: edge serves ${SERVED_SHA} at ${SERVED_SHA_FIELD}, application ${SOURCE_BRANCH} is ${APPLICATION_SHA}" >&2
  exit 1
fi
echo "receipt tenant=${TENANT} served_sha=${SERVED_SHA} edge=${EDGE_HEALTH_URL}"
echo "receipt tenant=${TENANT} converge=ok"
