#!/usr/bin/env python3
"""Adversarial contract for the published converge-agent carrier module.

Contract statement: docs/patterns/converge-agent.md and
docs/patterns/stateful-workload-convergence.md (TIN-489 / TIN-3293 /
TIN-2030). Unlike scripts/test-converge-agent-contract.example.py (the
copy-in template an adopting REPOSITORY instantiates), this file is the
contract of the MODULE itself: it pins the shipped loop body and manifest
template, and it pins the multi-tenancy rules an instantiation set must
satisfy. Checks are BEHAVIORAL where behavior is the law (the kill-switch
gate is EXECUTED against enabled:true/enabled:false workflow-state fixtures
with a stubbed toolchain — TIN-3457: assert behavior, not strings) and
text-level where shape is the law; no YAML/HCL parser dependency, no cluster
access; runtime truth stays in receipts.

Two layers:

1. Module-source laws (the shipped files in this package):
   a. kill-switch-read: the loop reads the checked-in `enabled` flag before
      any registry read, plan, or apply, and halts quietly (§2.2, §5).
      Proven by EXECUTION: an enabled:false tick must exit 0 having touched
      no registry/plan/apply tool; an enabled:true tick must proceed through
      digest resolution, apply, rollout wait, and the edge assert. A
      dead-condition gate (`if false && jq ...`) keeps the text shape and
      fails this check.
   b. digest-not-tag: an explicit tag->digest resolution exists and the value
      handed to apply carries the resolved digest; a moving tag never reaches
      apply (§2.3). Template mode (sites publishing no moving tag) derives
      the tag from the resolved main SHA BEFORE digest resolution (§2.3a),
      proven by execution.
   c. main-only: the loop clones exactly `main`; any other ref is a second
      history (addendum §3).
   d. two-locks: `concurrencyPolicy: Forbid` on the schedule half and
      `use_lockfile=true` on the state half (§2.4, addendum §1).
   e. no-trigger-surface: no push/dispatch trigger literal in uncommented
      module text (§3).
   f. evidence: rollout wait, real-edge served-sha assert, and runtime
      receipts on stdout (§2.5, §2.6, production-convergence §3). The edge
      probe optionally presents a Cloudflare Access service-token header
      pair; the credential arrives only by Secret NAME (secretKeyRef).

2. Tenancy laws (an instantiation set of N tenants):
   g. one-carrier-per-stack: exactly one carrier per converged stack; a
      second declared carrier — module block or raw CronJob — is two
      authorities and therefore none (§3).
   h. isolation: N tenants converge N disjoint state keys and N disjoint
      namespaces; the key is `<site>/<stack>/production.tfstate` prefixed by
      its tenant (addendum §2).
   i. no-workflow-reach: no workflow's uncommented text names a converged
      stack directory or its state key, regardless of verb (§3).

Tenancy honesty: real tenants are SEPARATE repositories (GFTB, MMS,
tinyland.dev), not a single-repo `tenants/` tree. The public checker is
`instantiation_set_violations`, which takes one checkout per tenant — an
aggregator lane with the real checkouts is what turns "fixtures verified"
into "the estate verified"; no standing cross-repo registry exists yet, and
nothing here claims otherwise. The single-root `tenants/` fixture layout is
an adapter over the same checker, kept for hermetic mutation proofs.

Every law is MUTATION-PROVEN below: a conforming fixture goes green, then a
single mutation (a dead-conditioned kill switch, tag reaching apply, a
second carrier, a shared key, ...) flips the same checker red.
"""

from __future__ import annotations

import dataclasses
import json
import os
import re
import shutil
import stat
import subprocess
import sys
import tempfile
import textwrap
import unittest
from pathlib import Path


def module_root() -> Path:
    test_srcdir = os.environ.get("TEST_SRCDIR")
    test_workspace = os.environ.get("TEST_WORKSPACE")
    if test_srcdir and test_workspace:
        candidate = Path(test_srcdir) / test_workspace
        if (candidate / "carrier").is_dir():
            return candidate
    return Path(__file__).resolve().parent.parent


MODULE_ROOT = module_root()

# The tenant-side laws live ONCE, in the shipped library, and are imported by
# both call sites: this suite (against fixtures, with mutation proofs below)
# and the adopter's copy of scripts/test-converge-agent-contract.example.py
# (against a real checkout). A checker reimplemented in either place is a
# forked law — see ConsolidationTests, which fails if one reappears.
sys.path.insert(0, str(MODULE_ROOT / "contract"))
import tenant_contract  # noqa: E402  (path established immediately above)

CARRIER_SCRIPT = "carrier/converge-agent.sh"
CRONJOB_TEMPLATE = "templates/converge-agent-cronjob.yaml.tftpl"
TOFU_DIR = "tofu"

COMMENT = re.compile(r"(?m)(?<!\S)#.*$")
DISPATCH_TRIGGER = re.compile(r"workflow_dispatch|repository_dispatch|workflow_call")
PUSH_TRIGGER = re.compile(r"^\s*push\s*:", re.MULTILINE)
CRONJOB_KIND = re.compile(r"^\s*kind:\s*CronJob\s*$", re.MULTILINE)
FORBID = re.compile(r"^\s*concurrencyPolicy:\s*Forbid\s*(?:#.*)?$", re.MULTILINE)
CLONE_BRANCH = re.compile(r"git clone[^\n]*--branch\s+(\S+)")
OVERLAY_BRANCH_DEFAULT = re.compile(
    r'variable\s+"overlay_branch"\s*\{[^}]*?default\s*=\s*"main"', re.DOTALL
)
ENABLED_READ = re.compile(
    r'jq -e "\$\{ENABLED_FLAG_FILTER\}\s*==\s*true"|\.enabled\s*==\s*true'
)
# A constant short-circuit ahead of the gate keeps the text shape while
# making the conditional's truth table degenerate (`if false && jq ...`
# never halts; `if true || jq ...` never proceeds). The behavioral check
# below is the real law; this text check merely names the trick.
DEAD_GATE_PREFIX = re.compile(r"(?:if|elif|while)\s+(?:!\s*)?(?:false|true|:)\s*(?:&&|\|\|)")
DIGEST_RESOLUTION = re.compile(
    r"crane digest|imagetools inspect|regctl image digest|skopeo inspect"
)
APPLIED_DIGEST = re.compile(r"-var\s+\"[^\"\n]*@\$\{DIGEST\}")
BARE_TAG_APPLIED = re.compile(r"-var\s+\"[^\"\n=]*=\$\{APPLICATION_IMAGE_TAG\}\"")
USE_LOCKFILE = re.compile(r"use_lockfile=true")
ROLLOUT_WAIT = re.compile(r"rollout status|wait --for")
# The served sha must be DERIVED from the edge: an assignment that never
# curls the health URL (e.g. SERVED_SHA="${APPLICATION_SHA}") is a
# self-satisfying assert, not evidence.
EDGE_ASSERT = re.compile(r"SERVED_SHA=\"\$\(curl[^\n]*EDGE_HEALTH_URL[^\n]*\)\"")
# The health field is a TENANT fact, never a module constant: MassageIthaca
# serves .build.commitHash and GFTB serves neither. A loop that hard-codes any
# jq path reads null at some real edge and fails every tick after a successful
# apply — the worst failure shape there is, because the apply already happened.
EDGE_FIELD_PARAMETERIZED = re.compile(r'jq -r "\$\{SERVED_SHA_FIELD\}"')
HARDCODED_EDGE_FIELD = re.compile(r"\|\s*jq -r\s+\.[A-Za-z_][\w.]*")
# The served sha is compared to the APPLICATION sha. Comparing it to the
# overlay sha is the two-repository defect: both tenants in the estate split
# app repo from overlay repo, so the two shas are never equal and the assert
# can never pass.
SERVED_COMPARE = re.compile(
    r"SERVED_SHA[^\n]*APPLICATION_SHA|APPLICATION_SHA[^\n]*SERVED_SHA"
)
SERVED_COMPARED_TO_OVERLAY = re.compile(
    r'\[\s*"\$\{SERVED_SHA\}"\s*!=\s*"\$\{OVERLAY_SHA\}"\s*\]'
)
# The application remote reaches git either directly, or through
# APPLICATION_REMOTE — the one variable the D1 credential seam may rewrite
# (host -> ssh config alias, so a second deploy key can authenticate a PRIVATE
# application repository). The indirection is admitted here and PINNED by
# APPLICATION_REMOTE_BINDING below: a rewrite is allowed, an unrelated remote
# is not.
SOURCE_SHA_RESOLUTION = re.compile(
    r"git ls-remote[^\n]*(?:SOURCE_REPOSITORY_URL|APPLICATION_REMOTE)"
)
SOURCE_CLONE = re.compile(r"git clone[^\n]*(?:SOURCE_REPOSITORY_URL|APPLICATION_REMOTE)")
# Whatever git is handed for the application must originate in the tenant's
# declared SOURCE_REPOSITORY_URL, and the overlay's in OVERLAY_REPO_SSH. This
# is what keeps the alias rewrite an ADDRESSING change rather than a second
# history: a loop that seeds APPLICATION_REMOTE from anything else is reading
# a repository the instantiation never declared.
APPLICATION_REMOTE_BINDING = re.compile(
    r'APPLICATION_REMOTE="\$\{SOURCE_REPOSITORY_URL:?-?[^"]*\}"'
)
OVERLAY_REMOTE_BINDING = re.compile(r'OVERLAY_REMOTE="\$\{OVERLAY_REPO_SSH\}"')
TAG_FROM_APPLICATION_SHA = re.compile(r"RENDERED_IMAGE_TAG//\\\{sha\\\}/\$\{APPLICATION_SHA\}")
SHORT7_SUBSTITUTION = re.compile(
    r"RENDERED_IMAGE_TAG//\\\{short7\\\}/\$\{APPLICATION_SHA:0:7\}"
)
CARRIER_ADDRESS_OUTPUT = re.compile(
    r'output\s+"carrier_resource_suffix'
    r'"\s*\{.*?value\s*=\s*"([^"]+)"',
    re.DOTALL,
)
RECEIPT_LINE = re.compile(r"^echo \"receipt ", re.MULTILINE)
TENANT_MODULE_SOURCE = re.compile(r"converge_agent")
STATE_KEY_SHAPE = re.compile(r"^[a-z0-9-]+/[a-z0-9-]+/production\.tfstate$")

# Inputs the module must thread end to end: declared as a tofu variable,
# rendered into the CronJob environment, and read by the loop. The audit that
# produced this list found nine of them dropped on the floor — a tenant
# declaring them got a loop that silently ignored every one.
THREADED_ENV_INPUTS = (
    "TENANT",
    "NAMESPACE",
    "OVERLAY_REPO_SSH",
    "OVERLAY_BRANCH",
    "WORKFLOW_STATE_DOCUMENT",
    "ENABLED_FLAG_POINTER",
    "ARMED_FLAG_POINTER",
    "DESTROY_ADMISSION_POINTER",
    "DURABLE_DATA_ADDRESSES",
    "EPHEMERAL",
    "SOURCE_REPOSITORY_URL",
    "SOURCE_BRANCH",
    "STACK_DIR",
    "BACKEND_CONFIG_PATH",
    "VAR_FILE_PATH",
    "APPLY_VARIABLE_OVERRIDES",
    "APPLICATION_IMAGE_TAG",
    "APPLICATION_IMAGE_REPOSITORY",
    "IMAGE_TAG_TEMPLATE",
    "APPLICATION_IMAGE_VARIABLE",
    "EDGE_HEALTH_URL",
    "SERVED_SHA_FIELD",
    "ROLLOUT_TARGET",
    "ROLLOUT_TIMEOUT",
    "STATE_BACKEND_BUCKET",
    "STATE_BACKEND_KEY",
    "STATE_BACKEND_REGION",
    "STATE_BACKEND_ENDPOINT",
    # D1 — the two-credential seam. Both paths are threaded so the loop never
    # rediscovers a mount location the manifest chose.
    "OVERLAY_DEPLOY_KEY_PATH",
    "APPLICATION_DEPLOY_KEY_PATH",
)

REQUIRED_VARIABLES = (
    "enabled",
    "tenant",
    "namespace",
    "overlay_repo_ssh",
    "overlay_branch",
    "workflow_state_document",
    "enabled_flag_pointer",
    "armed_flag_pointer",
    "destroy_admission_pointer",
    "durable_data_addresses",
    "ephemeral",
    "source_repository_url",
    "source_branch",
    "stack_dir",
    "backend_config_path",
    "var_file_path",
    "apply_variable_overrides",
    "application_image_tag",
    "application_image_repository",
    "image_tag_template",
    "application_image_variable",
    "edge_health_url",
    "served_sha_field",
    "rollout_target",
    "carrier_image",
    "carrier_liveness_alert_ref",
    "state_backend",
    "edge_probe_token_secret_name",
    "deploy_key_secret_name",
    "deploy_key_path",
    "application_deploy_key_secret_name",
    "application_deploy_key_path",
    "state_credentials_secret_name",
    "cloudflare_secret_name",
    "registry_pull_secret_name",
    "service_account_name",
)


def read(root: Path, relative: str) -> str:
    path = root / relative
    return path.read_text(encoding="utf-8") if path.is_file() else ""


def uncommented(text: str) -> str:
    """Prose about a banned literal is not the banned literal."""

    return COMMENT.sub("", text)


# ------------------------------------------------- behavioral gate harness --
#
# The kill switch is a BEHAVIOR, not a string (TIN-3457): the checker below
# runs the shipped loop body under bash with a stubbed toolchain (git, crane,
# tofu, kubectl, curl record their invocations; jq is real) against
# enabled:true and enabled:false workflow-state fixtures and asserts the two
# ticks DIVERGE — quiet exit 0 with no registry/plan/apply reach versus a
# full converge. A dead-conditioned gate (`if false && jq ...`) passes every
# text-shape check and fails here.

# TWO shas, deliberately. The previous fixture used one sha for the overlay
# clone AND for the health payload, which made the overlay-vs-application
# identity true by construction and the two-repository defect unobservable in
# principle. Every tenant in the estate splits app repo from overlay repo, so
# the fixture does too: a loop that compares the wrong pair goes RED here.
STUB_OVERLAY_SHA = "aaaaaaaa11112222333344445555666677778888"
STUB_SOURCE_SHA = "bbbbbbbb99998888777766665555444433332222"
STUB_DIGEST = "sha256:" + "ab" * 32
STUBBED_TOOLS = ("git", "crane", "tofu", "kubectl", "curl")

GIT_STUB = """#!/usr/bin/env bash
echo "git $*" >> "${CARRIER_TEST_CALLS}"
# D1 — capture the ssh config git was actually handed, so the credential-seam
# laws can be proven on the REAL generated file rather than on the source text
# that generates it. A tick without the seam sets no -F and copies nothing,
# which is itself the observation that the default path is untouched.
if [ -n "${GIT_SSH_COMMAND:-}" ]; then
  echo "git-ssh-command $*: ${GIT_SSH_COMMAND}" >> "${CARRIER_TEST_CALLS}"
  case "${GIT_SSH_COMMAND}" in
    *" -F "*)
      ssh_config="${GIT_SSH_COMMAND##*-F }"
      ssh_config="${ssh_config%% *}"
      [ -f "${ssh_config}" ] && cp "${ssh_config}" "${CARRIER_TEST_SSH_CONFIG_COPY}"
      ;;
  esac
fi
if [ "$1" = "clone" ]; then
  for dest in "$@"; do :; done
  mkdir -p "${dest}"
  cp -R "${CARRIER_TEST_OVERLAY}/." "${dest}/"
elif [ "$1" = "rev-parse" ]; then
  echo "${CARRIER_TEST_OVERLAY_SHA}"
elif [ "$1" = "ls-remote" ]; then
  printf '%s\\t%s\\n' "${CARRIER_TEST_SOURCE_SHA}" "$3"
fi
"""

CRANE_STUB = """#!/usr/bin/env bash
echo "crane $*" >> "${CARRIER_TEST_CALLS}"
echo "${CARRIER_TEST_DIGEST}"
"""

# `tofu show -json <plan>` is how the §4 classifier learns what the plan would
# do. The stub serves whatever plan the test declares; the default is the
# ordinary case, a plan that destroys nothing.
TOFU_STUB = """#!/usr/bin/env bash
echo "tofu $*" >> "${CARRIER_TEST_CALLS}"
if [ "$1" = "show" ]; then
  cat "${CARRIER_TEST_PLAN_JSON}"
fi
"""

KUBECTL_STUB = """#!/usr/bin/env bash
echo "kubectl $*" >> "${CARRIER_TEST_CALLS}"
"""

# The health payload is FIXTURE DATA, not a module constant: each test states
# the shape its tenant actually serves. The old stub hard-coded a top-level
# `.sha` that no tenant in the estate serves, which is how the module shipped
# with `jq -r .sha` green.
CURL_STUB = """#!/usr/bin/env bash
echo "curl $*" >> "${CARRIER_TEST_CALLS}"
cat "${CARRIER_TEST_HEALTH_BODY}"
"""


@dataclasses.dataclass
class CarrierRun:
    returncode: int
    stdout: str
    stderr: str
    calls: list[str]
    # The ssh config git was handed, verbatim; empty when the loop set none
    # (the default, one-identity path).
    ssh_config: str = ""

    def called(self, tool: str) -> list[str]:
        return [line for line in self.calls if line.startswith(f"{tool} ")]


def execute_carrier(
    root: Path,
    *,
    enabled: bool,
    extra_env: dict[str, str] | None = None,
    health_body: str | None = None,
    workflow_state: dict | None = None,
    source_sha: str = STUB_SOURCE_SHA,
    plan_json: dict | None = None,
) -> CarrierRun:
    """Run the carrier script for one tick against a fixture overlay.

    ``health_body`` is the raw bytes the fixture edge serves. It defaults to
    the pre-input shape (top-level ``sha`` carrying the OVERLAY sha), which is
    correct only for a single-repository tenant; any test that points the loop
    at a separate application repository must state the payload its tenant
    actually serves, because that is the whole defect class.
    """

    bash = shutil.which("bash")
    jq = shutil.which("jq")
    if not bash or not jq:
        raise RuntimeError(
            "behavioral gate check requires bash and jq on PATH; refusing to"
            " skip — an unexecutable check must fail loudly, not pass quietly"
        )
    script = root / CARRIER_SCRIPT
    if not script.is_file():
        raise RuntimeError(f"carrier script missing: {script}")
    with tempfile.TemporaryDirectory() as scratch:
        work = Path(scratch)
        overlay = work / "overlay-fixture"
        state = overlay / "config" / "workflow-state" / "production-converge.json"
        state.parent.mkdir(parents=True)
        # `armed` defaults to true in the fixture because the fixture models a
        # tenant whose arming ceremony has HAPPENED. The unarmed cases are
        # their own tests: the module's reviewed default is unarmed, and an
        # absent flag halts.
        document = (
            {"armed": True, "enabled": enabled} if workflow_state is None else workflow_state
        )
        state.write_text(json.dumps(document), encoding="utf-8")
        plan = work / "plan.json"
        plan.write_text(
            json.dumps({"resource_changes": []} if plan_json is None else plan_json),
            encoding="utf-8",
        )
        (overlay / "tofu" / "stacks" / "application").mkdir(parents=True)
        (overlay / "tofu" / "backend").mkdir(parents=True)
        (overlay / "tofu" / "backend" / "application-production.s3.hcl").write_text(
            'bucket = "reviewed-from-the-clone"\n', encoding="utf-8"
        )
        (overlay / "tofu" / "stacks" / "application" / "production.tfvars.json").write_text(
            json.dumps({"image_tag": "sha-0000000"}), encoding="utf-8"
        )
        health = work / "health.json"
        health.write_text(
            json.dumps({"sha": STUB_OVERLAY_SHA}) if health_body is None else health_body,
            encoding="utf-8",
        )
        stubs = work / "bin"
        stubs.mkdir()
        for name, body in zip(
            STUBBED_TOOLS, (GIT_STUB, CRANE_STUB, TOFU_STUB, KUBECTL_STUB, CURL_STUB)
        ):
            stub = stubs / name
            stub.write_text(body, encoding="utf-8")
            stub.chmod(stub.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)
        calls = work / "calls.log"
        calls.write_text("", encoding="utf-8")
        ssh_config_copy = work / "ssh-config-as-given-to-git"
        env = {
            "PATH": f"{stubs}{os.pathsep}{os.environ.get('PATH', '')}",
            "HOME": str(work),
            "TMPDIR": str(work),
            "CARRIER_TEST_CALLS": str(calls),
            "CARRIER_TEST_SSH_CONFIG_COPY": str(ssh_config_copy),
            "CARRIER_TEST_OVERLAY": str(overlay),
            "CARRIER_TEST_OVERLAY_SHA": STUB_OVERLAY_SHA,
            "CARRIER_TEST_SOURCE_SHA": source_sha,
            "CARRIER_TEST_HEALTH_BODY": str(health),
            "CARRIER_TEST_PLAN_JSON": str(plan),
            "CARRIER_TEST_DIGEST": STUB_DIGEST,
            "TENANT": "fixture",
            "NAMESPACE": "fixture-production",
            "OVERLAY_REPO_SSH": "git@github.com:example/fixture-infra.git",
            "WORKFLOW_STATE_DOCUMENT": "config/workflow-state/production-converge.json",
            "STACK_DIR": "tofu/stacks/application",
            "APPLICATION_IMAGE_TAG": "ghcr.io/example/fixture:main",
            "APPLICATION_IMAGE_VARIABLE": "application_image",
            "EDGE_HEALTH_URL": "https://www.fixture.example.com/api/health",
            "ROLLOUT_TARGET": "deployment/fixture",
            "STATE_BACKEND_BUCKET": "tofu-state",
            "STATE_BACKEND_KEY": "fixture/application/production.tfstate",
            "STATE_BACKEND_REGION": "us-east-1",
            "STATE_BACKEND_ENDPOINT": "https://state.internal.example",
        }
        env.update(extra_env or {})
        completed = subprocess.run(
            [bash, str(script)],
            env=env,
            capture_output=True,
            text=True,
            timeout=120,
        )
        recorded = [
            line for line in calls.read_text(encoding="utf-8").splitlines() if line
        ]
        given_ssh_config = (
            ssh_config_copy.read_text(encoding="utf-8") if ssh_config_copy.is_file() else ""
        )
    return CarrierRun(
        completed.returncode,
        completed.stdout,
        completed.stderr,
        recorded,
        given_ssh_config,
    )


def kill_switch_behavior_violations(root: Path) -> list[str]:
    """§2.2/§5 by EXECUTION: the two enabled states must diverge."""

    violations: list[str] = []
    halted = execute_carrier(root, enabled=False)
    if halted.returncode != 0:
        violations.append(
            f"{CARRIER_SCRIPT}: enabled:false tick exited"
            f" {halted.returncode}; a halted tick is a successful tick —"
            " exit 0, quietly (§2.2)"
        )
    if "halted=reviewed-enabled-false" not in halted.stdout:
        violations.append(
            f"{CARRIER_SCRIPT}: enabled:false tick emitted no halt receipt"
        )
    if not halted.called("git"):
        violations.append(
            f"{CARRIER_SCRIPT}: enabled:false tick never cloned main — the"
            " harness could not even reach the gate; check is void"
        )
    for tool in ("crane", "tofu", "kubectl", "curl"):
        if halted.called(tool):
            violations.append(
                f"{CARRIER_SCRIPT}: enabled:false tick still invoked {tool} —"
                " the kill switch is inert (a dead-conditioned or bypassed"
                " gate), violating §2.2/§5"
            )
    live = execute_carrier(root, enabled=True)
    if live.returncode != 0:
        violations.append(
            f"{CARRIER_SCRIPT}: conforming enabled:true tick failed"
            f" (exit {live.returncode}): {live.stderr.strip()[:200]}"
        )
    if "halted=reviewed-enabled-false" in live.stdout:
        violations.append(
            f"{CARRIER_SCRIPT}: enabled:true tick halted — the gate never"
            " proceeds, which is a kill switch stuck on"
        )
    for tool in ("crane", "tofu", "kubectl", "curl"):
        if not live.called(tool):
            violations.append(
                f"{CARRIER_SCRIPT}: enabled:true tick never invoked {tool} —"
                " the loop does not actually converge when enabled"
            )
    return violations


def arming_gate_behavior_violations(root: Path) -> list[str]:
    """Addendum §10 by EXECUTION: two flags, two receipts, unarmed by default.

    The machine-readable contract says the checked-in default of `armed` is
    false. A source check of a tenant document cannot prove that — a tenant
    that has armed legitimately carries true. What proves it is the module's
    behavior on a document that never had the ceremony: an ABSENT flag must
    halt. This is also the anti-collapse proof: an unarmed tick and a killed
    tick must be distinguishable in history, so their receipts differ.
    """

    violations: list[str] = []
    absent = execute_carrier(root, enabled=True, workflow_state={"enabled": True})
    if absent.returncode != 0:
        violations.append(
            f"{CARRIER_SCRIPT}: a document with no `armed` key exited"
            f" {absent.returncode}; an unarmed carrier is inert, not failing"
        )
    if "halted=not-armed" not in absent.stdout:
        violations.append(
            f"{CARRIER_SCRIPT}: an ABSENT `armed` flag did not halt — the"
            " reviewed default is unarmed (§10), so a document whose arming"
            " ceremony never happened must not converge"
        )
    for tool in ("crane", "tofu", "kubectl", "curl"):
        if absent.called(tool):
            violations.append(
                f"{CARRIER_SCRIPT}: unarmed tick still invoked {tool} — the"
                " arming gate is inert"
            )

    unarmed = execute_carrier(
        root, enabled=True, workflow_state={"armed": False, "enabled": True}
    )
    if "halted=not-armed" not in unarmed.stdout:
        violations.append(
            f"{CARRIER_SCRIPT}: `armed: false` with `enabled: true` converged —"
            " the arming gate is collapsed into the kill switch"
        )

    killed = execute_carrier(
        root, enabled=False, workflow_state={"armed": True, "enabled": False}
    )
    if "halted=reviewed-enabled-false" not in killed.stdout:
        violations.append(
            f"{CARRIER_SCRIPT}: `armed: true` with `enabled: false` did not"
            " emit the kill-switch receipt"
        )
    if "halted=not-armed" in killed.stdout:
        violations.append(
            f"{CARRIER_SCRIPT}: a killed tick reported itself as unarmed — the"
            " two halts are indistinguishable in history, which is exactly the"
            " collapse §10 forbids"
        )
    return violations


# A plan that would delete the tenant's declared durable data. `delete` also
# covers a REPLACE, whose actions are ["delete", "create"].
DESTRUCTIVE_PLAN = {
    "resource_changes": [
        {
            "address": "kubernetes_persistent_volume_claim.data",
            "change": {"actions": ["delete", "create"]},
        },
        {
            "address": "kubernetes_deployment.app",
            "change": {"actions": ["update"]},
        },
    ]
}
DURABLE_ADDRESS = "kubernetes_persistent_volume_claim.data"

# The same replace, as a `count`-gated instance plans it: the address carries an
# index suffix the declaration's base form does not. The tenant laws normalize
# that suffix away (tenant_contract strips `\[..\]$` before validating), and
# MMS's inert-gate law makes counted addresses the NORMAL case — so a classifier
# that exact-matches is bypassed by every gated tenant's durable data.
INDEXED_DESTRUCTIVE_PLAN = {
    "resource_changes": [
        {
            "address": f"{DURABLE_ADDRESS}[0]",
            "change": {"actions": ["delete", "create"]},
        },
    ]
}


def destructive_plan_behavior_violations(root: Path) -> list[str]:
    """Addendum §4 by EXECUTION: classify, then refuse — applying nothing.

    "The plan contains a destroy or a replace of any §3 durable-data resource
    -> halt, non-zero, apply nothing. Emit a receipt naming the exact resource
    addresses the plan would have destroyed, and page."
    """

    violations: list[str] = []
    durable = {"DURABLE_DATA_ADDRESSES": json.dumps([DURABLE_ADDRESS])}

    refused = execute_carrier(
        root, enabled=True, extra_env=durable, plan_json=DESTRUCTIVE_PLAN
    )
    if refused.returncode == 0:
        violations.append(
            f"{CARRIER_SCRIPT}: a plan replacing {DURABLE_ADDRESS} exited 0 —"
            " a refused destroy is a non-zero tick that pages (§4)"
        )
    if f"halted=destructive-plan refused={DURABLE_ADDRESS}" not in refused.stdout:
        violations.append(
            f"{CARRIER_SCRIPT}: no receipt naming the exact addresses the plan"
            " would have destroyed"
        )
    if any(call.startswith("tofu apply") for call in refused.calls):
        violations.append(
            f"{CARRIER_SCRIPT}: apply ran anyway after a destructive plan —"
            " 'halt, non-zero, apply nothing' is the whole rule"
        )

    admitted = execute_carrier(
        root,
        enabled=True,
        extra_env=durable,
        plan_json=DESTRUCTIVE_PLAN,
        workflow_state={
            "armed": True,
            "enabled": True,
            "destroy_admission": {
                "addresses": [DURABLE_ADDRESS],
                "reason": "TIN-0000 reviewed storage-class migration",
            },
        },
    )
    if not any(call.startswith("tofu apply") for call in admitted.calls):
        violations.append(
            f"{CARRIER_SCRIPT}: an explicit destroy_admission naming"
            f" {DURABLE_ADDRESS} did not unblock the apply — the admission is"
            " inert, and the source act that is supposed to unblock a halt"
            " does nothing"
        )

    unrelated = execute_carrier(
        root,
        enabled=True,
        extra_env=durable,
        plan_json=DESTRUCTIVE_PLAN,
        workflow_state={
            "armed": True,
            "enabled": True,
            "destroy_admission": {
                "addresses": ["kubernetes_config_map.other"],
                "reason": "an admission for a different resource",
            },
        },
    )
    if unrelated.returncode == 0:
        violations.append(
            f"{CARRIER_SCRIPT}: an admission naming a DIFFERENT address"
            " unblocked the destroy — an admission is per-address, never a"
            " blanket"
        )

    ephemeral = execute_carrier(
        root,
        enabled=True,
        extra_env={**durable, "EPHEMERAL": "true"},
        plan_json=DESTRUCTIVE_PLAN,
    )
    if not any(call.startswith("tofu apply") for call in ephemeral.calls):
        violations.append(
            f"{CARRIER_SCRIPT}: `EPHEMERAL=true` did not act as the standing"
            " admission (§7.2 rule 5); a PR environment's reap would halt"
        )

    ordinary = execute_carrier(root, enabled=True, extra_env=durable)
    if ordinary.returncode != 0:
        violations.append(
            f"{CARRIER_SCRIPT}: a non-destructive plan failed for a tenant that"
            f" declares durable data (exit {ordinary.returncode}):"
            f" {ordinary.stderr.strip()[:200]}"
        )
    return violations


# ------------------------------------------------------- module-source laws --


STATEFUL_SOURCE_LAWS = (
    ("ARMED_FLAG_POINTER", CARRIER_SCRIPT, "the arming gate (§10) is never read"),
    (
        "DESTROY_ADMISSION_POINTER",
        CARRIER_SCRIPT,
        "the destroy admission (§4) is never read",
    ),
    (
        "DURABLE_DATA_ADDRESSES",
        CARRIER_SCRIPT,
        "the durable-data address set (§3) is never read",
    ),
    ("EPHEMERAL", CARRIER_SCRIPT, "the ephemeral declaration (§7.2) is never read"),
    ("tofu show -json", CARRIER_SCRIPT, "the plan is never classified before apply"),
)


def stateful_source_violations(root: Path) -> list[str]:
    """The addendum's structural laws, where shape is the law.

    The behavioral checks above prove the gates WORK. These prove the module
    cannot be quietly returned to a shape where a tenant declares them and the
    loop ignores them — the dropped-input defect class, applied to the four
    stateful contract terms.
    """

    script = read(root, CARRIER_SCRIPT)
    main = read(root, f"{TOFU_DIR}/main.tf")
    violations: list[str] = []
    for needle, relative, complaint in STATEFUL_SOURCE_LAWS:
        if needle not in script:
            violations.append(f"{relative}: {complaint} ({needle} absent)")
    if script.find("tofu show -json") > script.find("tofu apply"):
        violations.append(
            f"{CARRIER_SCRIPT}: the plan is classified AFTER apply; §4 halts"
            " before applying, or it halts nothing"
        )
    if "var.armed_flag_pointer != var.enabled_flag_pointer" not in main:
        violations.append(
            f"{TOFU_DIR}/main.tf: no precondition keeping the arming gate and"
            " the kill switch apart; aliasing both pointers onto one key is the"
            " collapse §10 forbids"
        )
    if not re.search(r"condition\s*=\s*!\(var\.ephemeral\s*&&", main):
        violations.append(
            f"{TOFU_DIR}/main.tf: no precondition forbidding"
            " `ephemeral = true` on a production state key (§7.2 rule 5)"
        )
    return violations


def kill_switch_violations(root: Path) -> list[str]:
    script = read(root, CARRIER_SCRIPT)
    violations: list[str] = []
    if "WORKFLOW_STATE_DOCUMENT" not in script:
        violations.append(
            f"{CARRIER_SCRIPT}: loop never references the workflow-state document"
        )
    enabled = ENABLED_READ.search(script)
    if not enabled:
        violations.append(
            f"{CARRIER_SCRIPT}: loop does not read the reviewed enabled flag"
        )
        return violations
    if DEAD_GATE_PREFIX.search(uncommented(script)):
        violations.append(
            f"{CARRIER_SCRIPT}: a constant short-circuit precedes a"
            " conditional — a dead-conditioned gate keeps the text shape of"
            " §2.2 while never (or always) halting"
        )
    for later, label in (
        (DIGEST_RESOLUTION.search(script), "registry read"),
        (re.search(r"tofu init", script), "backend init"),
        (re.search(r"tofu apply", script), "apply"),
    ):
        if later and later.start() < enabled.start():
            violations.append(
                f"{CARRIER_SCRIPT}: {label} happens before the enabled-flag read;"
                " the kill switch must be read first (§2.2)"
            )
    return violations


def digest_violations(root: Path) -> list[str]:
    script = read(root, CARRIER_SCRIPT)
    violations: list[str] = []
    if not DIGEST_RESOLUTION.search(script):
        violations.append(
            f"{CARRIER_SCRIPT}: no tag -> digest resolution step; a moving tag"
            " must never reach apply"
        )
    if not APPLIED_DIGEST.search(script):
        violations.append(
            f"{CARRIER_SCRIPT}: the value passed to apply carries no resolved digest"
        )
    if BARE_TAG_APPLIED.search(script):
        violations.append(
            f"{CARRIER_SCRIPT}: the moving tag is passed to apply directly"
        )
    return violations


def main_only_violations(root: Path) -> list[str]:
    """Exactly one history. The branch is an input so a tenant can NAME its
    integration branch; the module pins main as the default, and the clone
    must read that one input — never a literal fork, never an unpinned ref."""

    script = read(root, CARRIER_SCRIPT)
    variables = read(root, f"{TOFU_DIR}/variables.tf")
    violations: list[str] = []
    clones = CLONE_BRANCH.findall(script)
    if not clones:
        violations.append(
            f"{CARRIER_SCRIPT}: clone does not pin a branch; the carrier"
            " converges exactly one history"
        )
    for ref in clones:
        if ref not in ('"${OVERLAY_BRANCH}"', "main", '"main"'):
            violations.append(
                f"{CARRIER_SCRIPT}: loop clones {ref}; the clone ref must be"
                " the reviewed overlay_branch input (default main), never a"
                " second history baked into the loop"
            )
    if variables and not OVERLAY_BRANCH_DEFAULT.search(variables):
        violations.append(
            f"{TOFU_DIR}/variables.tf: overlay_branch must default to main;"
            " an input without that default turns 'exactly one history' into"
            " an opinion"
        )
    if SOURCE_CLONE.search(script):
        violations.append(
            f"{CARRIER_SCRIPT}: the application repository is CLONED; its head"
            " is resolved with ls-remote — a clone of the served code is a"
            " second working tree the carrier never needs"
        )
    return violations


def sha_provenance_violations(root: Path) -> list[str]:
    """Two repositories, two shas (the defect this module shipped with).

    The overlay repository carries the tofu; the application repository
    carries the code the edge serves. The image tag and the served-sha assert
    are APPLICATION facts. A loop that derives either from the overlay sha
    fails on every tick at every tenant that splits the two — which is every
    tenant in the estate.
    """

    script = read(root, CARRIER_SCRIPT)
    violations: list[str] = []
    if not SOURCE_SHA_RESOLUTION.search(script):
        violations.append(
            f"{CARRIER_SCRIPT}: no application-sha resolution from"
            " SOURCE_REPOSITORY_URL; the loop can only ever compare the"
            " overlay sha to what the application serves"
        )
    # The D1 seam may rewrite the remote's HOST to a config alias; it may
    # never change WHICH repository the tenant declared.
    if not APPLICATION_REMOTE_BINDING.search(script):
        violations.append(
            f"{CARRIER_SCRIPT}: APPLICATION_REMOTE is not seeded from"
            " SOURCE_REPOSITORY_URL — the remote handed to git must originate"
            " in the tenant's declared application repository, or the"
            " credential seam has become a second history"
        )
    if not OVERLAY_REMOTE_BINDING.search(script):
        violations.append(
            f"{CARRIER_SCRIPT}: OVERLAY_REMOTE is not seeded from"
            " OVERLAY_REPO_SSH — the clone must originate in the tenant's"
            " declared overlay repository"
        )
    if not SERVED_COMPARE.search(script):
        violations.append(
            f"{CARRIER_SCRIPT}: served sha is never compared to the"
            " application sha"
        )
    if SERVED_COMPARED_TO_OVERLAY.search(script):
        violations.append(
            f"{CARRIER_SCRIPT}: served sha is compared to the OVERLAY sha —"
            " the two-repository defect: those shas are never equal at a"
            " tenant whose app repo differs from its overlay repo"
        )
    if not TAG_FROM_APPLICATION_SHA.search(script):
        violations.append(
            f"{CARRIER_SCRIPT}: template-mode image tag is not derived from"
            " APPLICATION_SHA; CI tags with the application repo's sha, so an"
            " overlay-derived tag names an image that was never published"
        )
    if not SHORT7_SUBSTITUTION.search(script):
        violations.append(
            f"{CARRIER_SCRIPT}: no {{short7}} substitution; docker/metadata"
            " -action publishes type=sha as a 7-hex short tag, so a"
            " full-40-hex-only template cannot name a real image"
        )
    return violations


def gate_violations(root: Path) -> list[str]:
    """The inert gate (addendum + MMS L15): a tenant must be able to declare
    the carrier without composing it, and the instance address must not change
    shape when the gate flips."""

    main = read(root, f"{TOFU_DIR}/main.tf")
    variables = read(root, f"{TOFU_DIR}/variables.tf")
    outputs = read(root, f"{TOFU_DIR}/outputs.tf")
    violations: list[str] = []
    if 'variable "enabled"' not in variables:
        violations.append(f"{TOFU_DIR}/variables.tf: no enabled gate variable")
    for resource in ("converge_agent_script", "converge_agent"):
        block = re.search(
            r'resource\s+"[a-z_0-9]+"\s+"' + resource + r'"\s*\{(.*?)\n\}',
            main,
            re.DOTALL,
        )
        if not block:
            violations.append(f"{TOFU_DIR}/main.tf: resource {resource} missing")
            continue
        if not re.search(r"count\s*=\s*var\.enabled\s*\?\s*1\s*:\s*0", block.group(1)):
            violations.append(
                f"{TOFU_DIR}/main.tf: {resource} is not count-gated on"
                " var.enabled; a tenant under an inert-gate law cannot declare"
                " this module at all"
            )
    address = CARRIER_ADDRESS_OUTPUT.search(outputs)
    if not address:
        violations.append(f"{TOFU_DIR}/outputs.tf: no carrier_resource_suffix output")
    elif address.group(1) != "kubernetes_manifest.converge_agent[0]":
        violations.append(
            f"{TOFU_DIR}/outputs.tf: carrier_resource_suffix must carry the"
            " [0] index — a count-gated resource has an indexed address, and a"
            " bare address is a declaration that names nothing"
        )
    return violations


def input_surface_violations(root: Path) -> list[str]:
    """Every input is threaded end to end, or it is not an input.

    The dropped-input defect class: a tenant declares `var_file_path`, the
    module accepts the declaration, and the loop never passes `-var-file`. The
    three surfaces must agree — tofu variable, CronJob env, loop read.
    """

    script = read(root, CARRIER_SCRIPT)
    template = read(root, CRONJOB_TEMPLATE)
    variables = read(root, f"{TOFU_DIR}/variables.tf")
    main = read(root, f"{TOFU_DIR}/main.tf")
    violations: list[str] = []

    for name in THREADED_ENV_INPUTS:
        if f"- name: {name}\n" not in template:
            violations.append(
                f"{CRONJOB_TEMPLATE}: input {name} is never rendered into the"
                " CronJob environment"
            )
        if name not in script:
            violations.append(f"{CARRIER_SCRIPT}: input {name} is never read")

    for name in REQUIRED_VARIABLES:
        if f'variable "{name}"' not in variables:
            violations.append(f"{TOFU_DIR}/variables.tf: no variable {name!r}")

    # Every placeholder the template uses must be supplied by the templatefile
    # call; a missing key is a render-time error at the tenant, not here.
    call = re.search(r"templatefile\((.*?)\n  \)\)", main, re.DOTALL)
    if not call:
        violations.append(f"{TOFU_DIR}/main.tf: templatefile call not found")
    else:
        supplied = set(re.findall(r"(?m)^\s{6}(\w+)\s*=", call.group(1)))
        used = set(re.findall(r"\$\{(\w+)\}", template))
        used |= set(re.findall(r"%\{\s*if\s+(\w+)\s*!=", template))
        for missing in sorted(used - supplied):
            violations.append(
                f"{TOFU_DIR}/main.tf: template placeholder ${{{missing}}} is"
                " not supplied by the templatefile call"
            )
    return violations


def apply_surface_violations(root: Path) -> list[str]:
    """The reviewed plan surface: an optional backend hcl, an optional
    var-file, and more than one -var. The module previously passed exactly one
    -var and no file of any kind, so a tenant whose stack needs two variables
    could not use it."""

    script = read(root, CARRIER_SCRIPT)
    violations: list[str] = []
    if "-var-file=" not in script:
        violations.append(f"{CARRIER_SCRIPT}: no -var-file support")
    if "BACKEND_CONFIG_PATH" not in script:
        violations.append(f"{CARRIER_SCRIPT}: no reviewed backend-config file support")
    if "APPLY_VARIABLE_OVERRIDES" not in script:
        violations.append(
            f"{CARRIER_SCRIPT}: no support for more than one -var; a stack"
            " needing to blank a mutable image_tag AND pin a digest cannot be"
            " served"
        )
    if "{digest}" not in script:
        violations.append(
            f"{CARRIER_SCRIPT}: override values cannot reference the resolved"
            " {digest}; the digest would have to be guessed by the tenant"
        )
    return violations


def two_locks_violations(root: Path) -> list[str]:
    script = read(root, CARRIER_SCRIPT)
    template = read(root, CRONJOB_TEMPLATE)
    violations: list[str] = []
    if not USE_LOCKFILE.search(script):
        violations.append(
            f"{CARRIER_SCRIPT}: backend init lacks use_lockfile=true (state half"
            " of the two-lock rule)"
        )
    if not CRONJOB_KIND.search(template):
        violations.append(f"{CRONJOB_TEMPLATE}: carrier is not a CronJob declaration")
    if not FORBID.search(template):
        violations.append(
            f"{CRONJOB_TEMPLATE}: concurrencyPolicy must be Forbid (schedule half"
            " of the two-lock rule)"
        )
    return violations


def trigger_surface_violations(root: Path) -> list[str]:
    violations: list[str] = []
    for relative in (CARRIER_SCRIPT, CRONJOB_TEMPLATE):
        text = uncommented(read(root, relative))
        if DISPATCH_TRIGGER.search(text) or PUSH_TRIGGER.search(text):
            violations.append(
                f"{relative}: serving loop carries an external trigger; the"
                " carrier pulls on its schedule and nothing fires it"
            )
    return violations


def evidence_violations(root: Path) -> list[str]:
    script = read(root, CARRIER_SCRIPT)
    violations: list[str] = []
    if not ROLLOUT_WAIT.search(script):
        violations.append(f"{CARRIER_SCRIPT}: no rollout wait — pinned is not running")
    if not EDGE_ASSERT.search(script):
        violations.append(f"{CARRIER_SCRIPT}: no real-edge assert — running is not served")
    if not EDGE_FIELD_PARAMETERIZED.search(script):
        violations.append(
            f"{CARRIER_SCRIPT}: the health field is not read from"
            " SERVED_SHA_FIELD; the payload shape is a tenant fact"
        )
    if HARDCODED_EDGE_FIELD.search(script):
        violations.append(
            f"{CARRIER_SCRIPT}: the health field is hard-coded"
            f" ({HARDCODED_EDGE_FIELD.search(script).group(0).strip()}); no"
            " tenant in the estate serves a top-level .sha, so a constant here"
            " reads null and fails every tick AFTER a successful apply"
        )
    if not SERVED_COMPARE.search(script):
        violations.append(
            f"{CARRIER_SCRIPT}: served sha is never compared to the"
            " application sha"
        )
    if len(RECEIPT_LINE.findall(script)) < 3:
        violations.append(
            f"{CARRIER_SCRIPT}: converge receipts (resolved commit, applied"
            " digest, served evidence) must be emitted to stdout"
        )
    return violations


def module_violations(root: Path) -> list[str]:
    return (
        kill_switch_violations(root)
        + kill_switch_behavior_violations(root)
        + digest_violations(root)
        + main_only_violations(root)
        + two_locks_violations(root)
        + trigger_surface_violations(root)
        + evidence_violations(root)
        + sha_provenance_violations(root)
        + apply_surface_violations(root)
        + arming_gate_behavior_violations(root)
        + destructive_plan_behavior_violations(root)
    )


# ---------------------------------------------- state-key scope, by shapes --
#
# The module admits exactly two state-key shapes — production
# (<site>/<stack>/production.tfstate, §7.1 main==prod) and the documented
# spoke PR-lane layout (blahaj tofu/intent/spoke-managed-state.schema.json:
# spokes/<site>/pr/<n>/lanes/<lane>/opentofu.tfstate) — and BOTH are
# tenant-scoped. The evaluator below reads the shape regexes and the scoping
# prefixes out of the shipped variables.tf rather than reimplementing them, so
# narrowing a shape, widening one, or un-scoping either branch from its tenant
# flips the quadrant checks red. (tofu itself is not available to the hermetic
# suite; the HCL regex/startswith subset used here evaluates identically.)

STATE_BACKEND_VARIABLE = re.compile(r'(?m)^variable\s+"state_backend"\s*\{')
KEY_SHAPE_REGEX = re.compile(r'can\(regex\("([^"]+)",\s*var\.state_backend\.key\)\)')
KEY_PREFIX = re.compile(r'startswith\(var\.state_backend\.key,\s*"([^"]+)"\)')

# The four ratified quadrants (both valid shapes pass; a foreign-tenant key of
# each shape fails) plus the non-state artifact from the same spoke layout.
STATE_KEY_QUADRANTS = (
    ("fixture", "fixture/application/production.tfstate", True, "own-tenant production shape"),
    ("fixture", "spokes/fixture/pr/123/lanes/qa/opentofu.tfstate", True, "own-tenant spoke PR-lane shape"),
    ("fixture", "intruder/application/production.tfstate", False, "foreign-tenant production shape"),
    ("fixture", "spokes/intruder/pr/123/lanes/qa/opentofu.tfstate", False, "foreign-tenant spoke PR-lane shape"),
    ("fixture", "spokes/fixture/pr/123/lanes/qa/metadata.json", False, "spoke metadata artifact (not a state key)"),
)


def state_backend_key_admitted(variables_text: str, tenant: str, key: str) -> bool:
    """Evaluate the module's own state-key admission for one candidate key.

    The law is READ OUT of the shipped source (shape regexes from the
    can(regex(...)) validation, tenant scoping from the startswith(...)
    prefixes), never forked: a checker carrying its own copy of the grammar
    would go green while the module drifted.
    """

    blocks = _blocks(variables_text, STATE_BACKEND_VARIABLE)
    if not blocks:
        raise AssertionError("variables.tf declares no state_backend variable")
    block = blocks[0]
    shapes = [pattern.replace("\\\\", "\\") for pattern in KEY_SHAPE_REGEX.findall(block)]
    if not shapes:
        raise AssertionError("state_backend carries no key-shape validation")
    if not any(re.search(shape, key) for shape in shapes):
        return False
    prefixes = [
        prefix.replace("${var.tenant}", tenant) for prefix in KEY_PREFIX.findall(block)
    ]
    scoped = [prefix for prefix in prefixes if tenant in prefix]
    if key.startswith("spokes/"):
        branch = [prefix for prefix in scoped if prefix.startswith("spokes/")]
    else:
        branch = [prefix for prefix in scoped if not prefix.startswith("spokes/")]
    return any(key.startswith(prefix) for prefix in branch)


def state_key_scope_violations(root: Path) -> list[str]:
    """All quadrants, judged against the shipped validation source."""

    variables = read(root, f"{TOFU_DIR}/variables.tf")
    violations: list[str] = []
    for tenant, key, admitted, label in STATE_KEY_QUADRANTS:
        try:
            actual = state_backend_key_admitted(variables, tenant, key)
        except AssertionError as complaint:
            return [f"{TOFU_DIR}/variables.tf: {complaint}"]
        if actual != admitted:
            violations.append(
                f"{TOFU_DIR}/variables.tf: {label} ({key!r}, tenant {tenant!r})"
                f" is {'admitted' if actual else 'refused'} but must be"
                f" {'admitted' if admitted else 'refused'} — both shapes pass"
                " only under their own tenant"
            )
    return violations


# ------------------------------------------- carrier-liveness detector ref --
#
# converge-agent.md §1: adoption REQUIRES a named carrier-liveness detector
# (suspend + last-success staleness), because suspend/delete of the carrier is
# the residual halt surface nothing structural heals — and §4 leans on that
# detector. The module refuses an instantiation without a NAMED detector:
# required input, no default, empty refused, and the name rides the CronJob
# as an annotation so the running object carries its own detector's identity.

LIVENESS_VARIABLE = re.compile(r'(?m)^variable\s+"carrier_liveness_alert_ref"\s*\{')
LIVENESS_NONEMPTY = "length(trimspace(var.carrier_liveness_alert_ref)) > 0"
LIVENESS_ANNOTATION = re.compile(
    r'tinyland\.dev/carrier-liveness-alert:\s*"\$\{carrier_liveness_alert_ref\}"'
)


def liveness_ref_violations(root: Path) -> list[str]:
    variables = read(root, f"{TOFU_DIR}/variables.tf")
    template = read(root, CRONJOB_TEMPLATE)
    violations: list[str] = []
    blocks = _blocks(variables, LIVENESS_VARIABLE)
    if not blocks:
        violations.append(
            f"{TOFU_DIR}/variables.tf: no carrier_liveness_alert_ref variable —"
            " adoption REQUIRES a named carrier-liveness detector"
            " (converge-agent.md §1), so an instantiation that names none must"
            " be refused, not composed"
        )
        return violations
    block = blocks[0]
    if re.search(r"(?m)^\s*default\s*=", block):
        violations.append(
            f"{TOFU_DIR}/variables.tf: carrier_liveness_alert_ref carries a"
            " default — a defaulted detector is a name nobody chose; the input"
            " must be required"
        )
    if LIVENESS_NONEMPTY not in block:
        violations.append(
            f"{TOFU_DIR}/variables.tf: carrier_liveness_alert_ref does not"
            " refuse the empty string — an instantiation without a NAMED"
            " detector must not compose"
        )
    if not LIVENESS_ANNOTATION.search(template):
        violations.append(
            f"{CRONJOB_TEMPLATE}: the detector ref is not threaded onto the"
            " CronJob as the tinyland.dev/carrier-liveness-alert annotation —"
            " the receipt trail must carry the detector's name"
        )
    return violations


def module_package_violations(root: Path) -> list[str]:
    """Laws that need the tofu/ package, not just the two shipped text files
    (the mutation fixtures copy only the script and template)."""

    return (
        gate_violations(root)
        + input_surface_violations(root)
        + stateful_source_violations(root)
        + state_key_scope_violations(root)
        + liveness_ref_violations(root)
    )


# --------------------------------------------------------------- tenancy laws --


def _blocks(text: str, opener: re.Pattern[str]) -> list[str]:
    """Extract brace-balanced blocks that begin at each opener match."""

    blocks: list[str] = []
    for match in opener.finditer(text):
        depth = 0
        for index in range(match.end() - 1, len(text)):
            if text[index] == "{":
                depth += 1
            elif text[index] == "}":
                depth -= 1
                if depth == 0:
                    blocks.append(text[match.start() : index + 1])
                    break
    return blocks


MODULE_BLOCK = re.compile(r"(?m)^\s*module\s+\"[^\"]+\"\s*\{")
ATTRIBUTE = {
    "tenant": re.compile(r"(?m)^\s*tenant\s*=\s*\"([^\"]+)\""),
    "namespace": re.compile(r"(?m)^\s*namespace\s*=\s*\"([^\"]+)\""),
    "key": re.compile(r"(?m)^\s*key\s*=\s*\"([^\"]+)\""),
}


def stack_carriers(stack_dir: Path) -> list[dict[str, str]]:
    """Every carrier declared in one stack: module instantiations plus any raw
    CronJob manifest dropped beside them."""

    carriers: list[dict[str, str]] = []
    for path in sorted(stack_dir.rglob("*.tf")):
        text = path.read_text(encoding="utf-8")
        for block in _blocks(uncommented(text), MODULE_BLOCK):
            if not TENANT_MODULE_SOURCE.search(block):
                continue
            carrier = {"declared_in": str(path)}
            for name, pattern in ATTRIBUTE.items():
                match = pattern.search(block)
                if match:
                    carrier[name] = match.group(1)
            carriers.append(carrier)
    for path in sorted(stack_dir.rglob("*.y*ml")):
        if CRONJOB_KIND.search(uncommented(path.read_text(encoding="utf-8"))):
            carriers.append({"declared_in": str(path), "raw_cronjob": "true"})
    return carriers


def instantiation_set_violations(
    stacks: dict[str, Path],
    workflow_scans: tuple[tuple[Path, Path], ...] = (),
) -> list[str]:
    """The instantiation-set contract over REAL topology.

    ``stacks`` maps each tenant name to that tenant's converged stack
    directory — in the estate, one checkout per tenant repository (GFTB,
    MMS, tinyland.dev), each stack at ``<checkout>/tofu/stacks/application``.
    ``workflow_scans`` is ``(repo_root, workflows_dir)`` per checkout: every
    workflow's uncommented text is checked for that checkout's converged
    stack path and for ANY tenant's state key (the backend is shared, so a
    workflow in one repo naming another tenant's key is the same reach).

    HONEST LIMIT: this function verifies whatever set the caller hands it.
    Nothing in this repository enumerates the real checkouts — cross-repo
    collision is mechanically checked only when an aggregator lane clones
    the real tenant repos and drives this function over them. Fixture green
    is checker self-consistency, not estate truth.
    """

    violations: list[str] = []
    seen_keys: dict[str, str] = {}
    seen_namespaces: dict[str, str] = {}
    for tenant in sorted(stacks):
        stack_dir = stacks[tenant]
        carriers = stack_carriers(stack_dir)
        if len(carriers) != 1:
            violations.append(
                f"{tenant}: {len(carriers)} carriers declared in one stack —"
                " one converge carrier per stack; two authorities is none"
            )
            continue
        carrier = carriers[0]
        key = carrier.get("key", "")
        namespace = carrier.get("namespace", "")
        if not STATE_KEY_SHAPE.match(key):
            violations.append(
                f"{tenant}: state key {key!r} is not <site>/<stack>/production.tfstate"
            )
        elif not key.startswith(f"{carrier.get('tenant', tenant)}/"):
            violations.append(
                f"{tenant}: state key {key!r} is not prefixed by its tenant"
            )
        if key in seen_keys:
            violations.append(
                f"{tenant}: state key {key!r} already written by"
                f" {seen_keys[key]} — two tenants, one state, two writers"
            )
        if namespace in seen_namespaces:
            violations.append(
                f"{tenant}: namespace {namespace!r} already owned by"
                f" {seen_namespaces[namespace]} — tenants own disjoint namespaces"
            )
        seen_keys[key] = tenant
        seen_namespaces[namespace] = tenant
    for repo_root, workflows in workflow_scans:
        if not workflows.is_dir():
            continue
        needles = [
            str(stack.relative_to(repo_root))
            for stack in stacks.values()
            if stack.is_relative_to(repo_root)
        ] + list(seen_keys)
        for path in sorted(workflows.rglob("*.y*ml")):
            body = uncommented(path.read_text(encoding="utf-8"))
            for needle in needles:
                if needle and needle in body:
                    violations.append(
                        f"{path.relative_to(repo_root)}: workflow references"
                        f" a converged stack ({needle}) — regardless of verb,"
                        " that is a second carrier surface, therefore none"
                    )
    return violations


def tenancy_violations(fixture_root: Path) -> list[str]:
    """Single-root ``tenants/<name>/...`` fixture adapter over the same
    checker — hermetic mutation proofs only; real tenants are separate
    repositories fed to instantiation_set_violations directly."""

    tenants_dir = fixture_root / "tenants"
    stacks = {
        tenant_dir.name: tenant_dir / "tofu" / "stacks" / "application"
        for tenant_dir in sorted(p for p in tenants_dir.iterdir() if p.is_dir())
    }
    return instantiation_set_violations(
        stacks, ((fixture_root, fixture_root / ".github" / "workflows"),)
    )


# ------------------------------------------------------- manifest rendering --
#
# The credential-custody inputs (Cloudflare token, registry pull secret) are
# MANIFEST behavior, not loop behavior: setting them must change what the
# CronJob declares. tofu is not available to a hermetic stdlib suite, so the
# tftpl subset the template actually uses — `${name}` and
# `%{ if name != "" }` … `%{ endif }` — is rendered here. The renderer is
# deliberately strict: an unsupported directive or an unsupplied placeholder
# raises rather than silently rendering an empty string.

TFTPL_IF = re.compile(r'%\{ if (\w+) != "" \}\n(.*?)%\{ endif \}\n', re.DOTALL)
TFTPL_VAR = re.compile(r"\$\{(\w+)\}")


def render_template(text: str, values: dict[str, str]) -> str:
    def branch(match: re.Match[str]) -> str:
        name, body = match.group(1), match.group(2)
        if name not in values:
            raise KeyError(f"conditional on unsupplied value {name!r}")
        return body if values[name] != "" else ""

    rendered = TFTPL_IF.sub(branch, text)

    def substitute(match: re.Match[str]) -> str:
        name = match.group(1)
        if name not in values:
            raise KeyError(f"unsupplied template placeholder {name!r}")
        return str(values[name])

    rendered = TFTPL_VAR.sub(substitute, rendered)
    leftover = re.search(r"%\{|\$\{", rendered)
    if leftover:
        raise AssertionError(
            f"unrendered template directive at offset {leftover.start()}:"
            f" {rendered[leftover.start():leftover.start() + 60]!r}"
        )
    return rendered


BASE_TEMPLATE_VALUES: dict[str, str] = {
    "tenant": "fixture",
    "namespace": "fixture-production",
    "schedule": "*/10 * * * *",
    "overlay_repo_ssh": "git@github.com:example/fixture-infra.git",
    "overlay_branch": "main",
    "workflow_state_document": "config/workflow-state/production-converge.json",
    "enabled_flag_pointer": "/enabled",
    "armed_flag_pointer": "/armed",
    "destroy_admission_pointer": "/destroy_admission",
    "durable_data_addresses_json": '"[]"',
    "ephemeral": "false",
    "source_repository_url": "",
    "source_branch": "main",
    "stack_dir": "tofu/stacks/application",
    "backend_config_path": "",
    "var_file_path": "",
    "apply_variable_overrides_json": '"{}"',
    "application_image_tag": "ghcr.io/example/fixture:main",
    "application_image_repository": "",
    "image_tag_template": "",
    "application_image_variable": "application_image",
    "edge_probe_token_secret_name": "",
    "edge_health_url": "https://www.fixture.example.com/api/health",
    "served_sha_field": ".sha",
    "rollout_target": "deployment/fixture",
    "rollout_timeout": "5m",
    "carrier_image": "ghcr.io/example-publisher/converge-agent@sha256:" + "0" * 64,
    "carrier_liveness_alert_ref": "grafana-alert:converge-agent-liveness-fixture",
    "state_backend_bucket": "tofu-state",
    "state_backend_key": "fixture/application/production.tfstate",
    "state_backend_region": "us-east-1",
    "state_backend_endpoint": "https://state.internal.example",
    "deploy_key_secret_name": "converge-agent-deploy-key",
    "deploy_key_path": "/secrets/deploy-key/id_ed25519",
    "deploy_key_mount": "/secrets/deploy-key",
    # D1 defaults: the seam is OFF, which is what every pre-D1 instantiation
    # renders. The seam-on renders are their own tests.
    "application_deploy_key_secret_name": "",
    "application_deploy_key_path": "/secrets/application-deploy-key/id_ed25519",
    "application_deploy_key_mount": "/secrets/application-deploy-key",
    "state_credentials_secret_name": "converge-agent-state",
    "cloudflare_secret_name": "",
    "registry_pull_secret_name": "",
    "service_account_name": "converge-agent",
}


def render_cronjob(root: Path = MODULE_ROOT, **overrides: str) -> str:
    values = dict(BASE_TEMPLATE_VALUES)
    values.update(overrides)
    return render_template(read(root, CRONJOB_TEMPLATE), values)


# ------------------------------------------------------------------ fixtures --


def instantiation(tenant: str) -> str:
    return textwrap.dedent(
        f"""\
        module "converge_agent" {{
          # Materialized from the registry package tinyland_converge_agent
          # (bazel_dep + copy_to_directory; see the module README) — referenced,
          # never copied.
          source = "./modules/converge_agent/tofu"

          tenant                = "{tenant}"
          namespace             = "{tenant}-production"
          overlay_repo_ssh      = "git@github.com:example/{tenant}-infra.git"
          application_image_tag = "ghcr.io/example/{tenant}:main"
          edge_health_url       = "https://www.{tenant}.example.com/api/health"
          rollout_target        = "deployment/{tenant}"
          carrier_image         = "ghcr.io/example-publisher/converge-agent@sha256:{'0' * 64}"

          carrier_liveness_alert_ref = "grafana-alert:{tenant}-converge-agent-liveness"

          state_backend = {{
            bucket   = "tofu-state"
            key      = "{tenant}/application/production.tfstate"
            region   = "us-east-1"
            endpoint = "https://state.internal.example"
          }}
        }}
        """
    )


def build_tenant_fixture(root: Path, tenants: tuple[str, ...] = ("alpha", "beta")) -> None:
    for tenant in tenants:
        stack = root / "tenants" / tenant / "tofu" / "stacks" / "application"
        stack.mkdir(parents=True, exist_ok=True)
        (stack / "carrier.tf").write_text(instantiation(tenant), encoding="utf-8")
    workflows = root / ".github" / "workflows"
    workflows.mkdir(parents=True, exist_ok=True)
    (workflows / "ci.yml").write_text(
        "jobs:\n  test:\n    steps:\n      - run: echo unit tests only\n",
        encoding="utf-8",
    )


class ModuleConformanceTests(unittest.TestCase):
    """The shipped module must satisfy its own contract."""

    def test_shipped_module_conforms(self) -> None:
        self.assertEqual([], module_violations(MODULE_ROOT))

    def test_template_parameterizes_the_full_input_set(self) -> None:
        # Addendum §2: the input set is the complete per-site authority.
        template = read(MODULE_ROOT, CRONJOB_TEMPLATE)
        for placeholder in (
            "${tenant}",
            "${namespace}",
            "${overlay_repo_ssh}",
            "${stack_dir}",
            "${application_image_tag}",
            "${application_image_repository}",
            "${image_tag_template}",
            "${edge_health_url}",
            "${edge_probe_token_secret_name}",
            "${state_backend_key}",
            "${state_backend_endpoint}",
        ):
            self.assertIn(placeholder, template)

    def test_tofu_module_declares_the_carrier_resource(self) -> None:
        main = read(MODULE_ROOT, f"{TOFU_DIR}/main.tf")
        self.assertIn('resource "kubernetes_manifest" "converge_agent"', main)

    def test_variables_declare_both_image_modes_and_the_probe_token(self) -> None:
        # GFTB interface requirements (great-falls-tool-bus-infra#103
        # PROVISIONAL markers): a template input deriving the tag from the
        # resolved main SHA, and a names-only CF Access service-token pair
        # for the edge probe.
        variables = read(MODULE_ROOT, f"{TOFU_DIR}/variables.tf")
        for declaration in (
            'variable "application_image_tag"',
            'variable "application_image_repository"',
            'variable "image_tag_template"',
            'variable "edge_probe_token_secret_name"',
        ):
            self.assertIn(declaration, variables)
        # The template variable's own validation must demand the {sha}
        # placeholder — a template ignoring the resolved SHA is a moving tag.
        self.assertIn("{sha}", variables)
        main = read(MODULE_ROOT, f"{TOFU_DIR}/main.tf")
        self.assertIn("precondition", main)

    def test_probe_token_is_name_only_secret_ref(self) -> None:
        # The Access credential may appear ONLY as a secretKeyRef name; a
        # value-shaped env entry for either header half is custody leakage.
        template = read(MODULE_ROOT, CRONJOB_TEMPLATE)
        self.assertIn("secretKeyRef", template)
        for leak in (
            re.compile(r"CF_ACCESS_CLIENT_ID\s*\n\s*value:"),
            re.compile(r"CF_ACCESS_CLIENT_SECRET\s*\n\s*value:"),
        ):
            self.assertIsNone(leak.search(template))


class CarrierBehaviorTests(unittest.TestCase):
    """The gate and the GFTB interface features, proven by EXECUTION of the
    shipped loop body under a stubbed toolchain — behavior, not strings."""

    def test_shipped_gate_diverges_on_the_enabled_flag(self) -> None:
        self.assertEqual([], kill_switch_behavior_violations(MODULE_ROOT))

    def test_halted_tick_is_quiet_and_touches_nothing(self) -> None:
        halted = execute_carrier(MODULE_ROOT, enabled=False)
        self.assertEqual(0, halted.returncode)
        self.assertIn("halted=reviewed-enabled-false", halted.stdout)
        for tool in ("crane", "tofu", "kubectl", "curl"):
            self.assertEqual([], halted.called(tool))

    def test_enabled_tick_converges_in_order(self) -> None:
        live = execute_carrier(MODULE_ROOT, enabled=True)
        self.assertEqual(0, live.returncode, live.stderr)
        self.assertIn("converge=ok", live.stdout)
        # Digest resolution precedes plan; the plan variable carries the
        # resolved digest, never the moving tag.
        self.assertTrue(live.called("crane"))
        plan_calls = [c for c in live.called("tofu") if c.startswith("tofu plan")]
        self.assertTrue(plan_calls)
        self.assertIn(f"@{STUB_DIGEST}", plan_calls[0])
        self.assertNotIn("application_image=ghcr.io/example/fixture:main", plan_calls[0])

    def test_template_mode_derives_tag_from_resolved_sha_before_digest(self) -> None:
        # GFTB requirement (a): sites publishing no moving tag derive the
        # image ref from the resolved main SHA via the template, BEFORE
        # digest resolution — proven by what crane was handed.
        live = execute_carrier(
            MODULE_ROOT,
            enabled=True,
            extra_env={
                "APPLICATION_IMAGE_TAG": "",
                "APPLICATION_IMAGE_REPOSITORY": "ghcr.io/example/fixture",
                "IMAGE_TAG_TEMPLATE": "sha-{sha}",
            },
        )
        self.assertEqual(0, live.returncode, live.stderr)
        derived = f"ghcr.io/example/fixture:sha-{STUB_OVERLAY_SHA}"
        self.assertIn(f"crane digest {derived}", live.calls)
        self.assertIn(f"derived_image_tag={derived}", live.stdout)
        plan_calls = [c for c in live.called("tofu") if c.startswith("tofu plan")]
        self.assertTrue(plan_calls)
        self.assertIn(f"@{STUB_DIGEST}", plan_calls[0])

    def test_template_mode_still_halts_on_the_kill_switch(self) -> None:
        halted = execute_carrier(
            MODULE_ROOT,
            enabled=False,
            extra_env={
                "APPLICATION_IMAGE_TAG": "",
                "APPLICATION_IMAGE_REPOSITORY": "ghcr.io/example/fixture",
                "IMAGE_TAG_TEMPLATE": "sha-{sha}",
            },
        )
        self.assertEqual(0, halted.returncode)
        self.assertIn("halted=reviewed-enabled-false", halted.stdout)
        for tool in ("crane", "tofu", "kubectl", "curl"):
            self.assertEqual([], halted.called(tool))

    def test_template_without_sha_placeholder_refuses_to_run(self) -> None:
        run = execute_carrier(
            MODULE_ROOT,
            enabled=True,
            extra_env={
                "APPLICATION_IMAGE_TAG": "",
                "APPLICATION_IMAGE_REPOSITORY": "ghcr.io/example/fixture",
                "IMAGE_TAG_TEMPLATE": "sha-latest",
            },
        )
        self.assertNotEqual(0, run.returncode)
        self.assertIn("{sha}", run.stderr)
        self.assertEqual([], run.called("crane"))

    def test_both_image_modes_set_refuses_to_run(self) -> None:
        run = execute_carrier(
            MODULE_ROOT,
            enabled=True,
            extra_env={
                "APPLICATION_IMAGE_REPOSITORY": "ghcr.io/example/fixture",
                "IMAGE_TAG_TEMPLATE": "sha-{sha}",
            },
        )
        self.assertNotEqual(0, run.returncode)
        self.assertIn("never both", run.stderr)

    def test_neither_image_mode_set_refuses_to_run(self) -> None:
        run = execute_carrier(
            MODULE_ROOT, enabled=True, extra_env={"APPLICATION_IMAGE_TAG": ""}
        )
        self.assertNotEqual(0, run.returncode)
        self.assertEqual([], run.called("crane"))

    def test_edge_probe_presents_access_headers_when_credentialed(self) -> None:
        # GFTB requirement (b): the edge probe presents the CF Access
        # service-token header pair when the CronJob injects the credential.
        live = execute_carrier(
            MODULE_ROOT,
            enabled=True,
            extra_env={
                "CF_ACCESS_CLIENT_ID": "fixture-client-id",
                "CF_ACCESS_CLIENT_SECRET": "fixture-client-secret",
            },
        )
        self.assertEqual(0, live.returncode, live.stderr)
        probe = live.called("curl")
        self.assertTrue(probe)
        self.assertIn("CF-Access-Client-Id: fixture-client-id", probe[0])
        self.assertIn("CF-Access-Client-Secret: fixture-client-secret", probe[0])

    def test_edge_probe_sends_no_access_headers_by_default(self) -> None:
        live = execute_carrier(MODULE_ROOT, enabled=True)
        self.assertEqual(0, live.returncode, live.stderr)
        probe = live.called("curl")
        self.assertTrue(probe)
        self.assertNotIn("CF-Access", probe[0])


class ModuleMutationTests(unittest.TestCase):
    """Each law goes red under exactly the mutation it exists to catch."""

    def setUp(self) -> None:
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        for relative in (CARRIER_SCRIPT, CRONJOB_TEMPLATE):
            destination = self.root / relative
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(MODULE_ROOT / relative, destination)

    def mutate(self, relative: str, old: str, new: str) -> None:
        path = self.root / relative
        text = path.read_text(encoding="utf-8")
        self.assertIn(old, text, f"mutation anchor missing from {relative}: {old!r}")
        path.write_text(text.replace(old, new), encoding="utf-8")

    def test_copied_module_conforms(self) -> None:
        self.assertEqual([], module_violations(self.root))

    def test_kill_switch_not_read_fails(self) -> None:
        self.mutate(
            CARRIER_SCRIPT,
            'if ! jq -e "${ENABLED_FLAG_FILTER} == true" "${WORKFLOW_STATE_DOCUMENT}" >/dev/null; then',
            "if false; then",
        )
        self.assertTrue(kill_switch_violations(self.root))

    def test_kill_switch_read_after_registry_read_fails(self) -> None:
        script_path = self.root / CARRIER_SCRIPT
        text = script_path.read_text(encoding="utf-8")
        gate = re.search(
            r'if ! jq -e "\$\{ENABLED_FLAG_FILTER\} == true".*?\nfi\n', text, re.DOTALL
        )
        assert gate is not None
        moved = text.replace(gate.group(0), "") + "\n" + gate.group(0)
        script_path.write_text(moved, encoding="utf-8")
        self.assertTrue(kill_switch_violations(self.root))

    def test_dead_condition_kill_switch_fails(self) -> None:
        # THE demonstrated evasion (adversarial review of PR #129): prefixing
        # the gate with `false &&` keeps every §2.2 string in place while the
        # switch never halts. Text-shape matching alone passed this; the
        # behavioral check executes the gate and catches it.
        self.mutate(
            CARRIER_SCRIPT,
            'if ! jq -e "${ENABLED_FLAG_FILTER} == true"',
            'if false && ! jq -e "${ENABLED_FLAG_FILTER} == true"',
        )
        behavioral = kill_switch_behavior_violations(self.root)
        self.assertTrue(any("kill switch is inert" in v for v in behavioral))
        # Belt and braces: the strengthened text check names the trick too.
        self.assertTrue(kill_switch_violations(self.root))
        self.assertTrue(module_violations(self.root))

    def test_stuck_on_kill_switch_fails(self) -> None:
        # The mirror evasion: `true ||` makes the gate ALWAYS halt — a
        # carrier that never converges while every receipt string survives.
        self.mutate(
            CARRIER_SCRIPT,
            'if ! jq -e "${ENABLED_FLAG_FILTER} == true"',
            'if true || ! jq -e "${ENABLED_FLAG_FILTER} == true"',
        )
        behavioral = kill_switch_behavior_violations(self.root)
        self.assertTrue(any("never" in v for v in behavioral))
        self.assertTrue(kill_switch_violations(self.root))

    def test_gate_reading_the_wrong_document_fails(self) -> None:
        # Behavior divergence must come from the REVIEWED document: a gate
        # reading some other always-true source ignores enabled:false.
        self.mutate(
            CARRIER_SCRIPT,
            'jq -e "${ENABLED_FLAG_FILTER} == true" "${WORKFLOW_STATE_DOCUMENT}"',
            'test -d "${WORK}"',
        )
        behavioral = kill_switch_behavior_violations(self.root)
        self.assertTrue(any("kill switch is inert" in v for v in behavioral))

    def test_tag_not_digest_fails(self) -> None:
        self.mutate(CARRIER_SCRIPT, "crane digest", "echo skip-resolution")
        self.mutate(
            CARRIER_SCRIPT,
            '-var "${APPLICATION_IMAGE_VARIABLE}=${APPLICATION_IMAGE_TAG%%:*}@${DIGEST}"',
            '-var "${APPLICATION_IMAGE_VARIABLE}=${APPLICATION_IMAGE_TAG}"',
        )
        violations = digest_violations(self.root)
        self.assertTrue(violations)
        self.assertTrue(any("passed to apply directly" in v for v in violations))

    def test_non_main_ref_fails(self) -> None:
        self.mutate(
            CARRIER_SCRIPT, '--branch "${OVERLAY_BRANCH}"', "--branch serving"
        )
        self.assertTrue(main_only_violations(self.root))

    def test_lockfile_removed_fails(self) -> None:
        self.mutate(
            CARRIER_SCRIPT, '-backend-config="use_lockfile=true"', ""
        )
        self.assertTrue(two_locks_violations(self.root))

    def test_forbid_relaxed_fails(self) -> None:
        self.mutate(
            CRONJOB_TEMPLATE, "concurrencyPolicy: Forbid", "concurrencyPolicy: Allow"
        )
        self.assertTrue(two_locks_violations(self.root))

    def test_trigger_added_fails(self) -> None:
        for trigger in ("workflow_dispatch:", "repository_dispatch:", "\npush:\n"):
            with self.subTest(trigger=trigger):
                path = self.root / CRONJOB_TEMPLATE
                original = path.read_text(encoding="utf-8")
                path.write_text(original + trigger, encoding="utf-8")
                self.assertTrue(trigger_surface_violations(self.root))
                path.write_text(original, encoding="utf-8")

    def test_commented_trigger_prose_passes(self) -> None:
        path = self.root / CRONJOB_TEMPLATE
        path.write_text(
            path.read_text(encoding="utf-8") + "# no workflow_dispatch here\n",
            encoding="utf-8",
        )
        self.assertEqual([], trigger_surface_violations(self.root))

    def test_missing_rollout_wait_fails(self) -> None:
        self.mutate(CARRIER_SCRIPT, "rollout status", "echo skipped")
        self.assertTrue(evidence_violations(self.root))

    def test_missing_edge_assert_fails(self) -> None:
        self.mutate(
            CARRIER_SCRIPT,
            'SERVED_SHA="$(curl -fsS ${EDGE_PROBE_HEADER_ARGS[@]+"${EDGE_PROBE_HEADER_ARGS[@]}"} "${EDGE_HEALTH_URL}" | jq -r "${SERVED_SHA_FIELD}")"',
            'SERVED_SHA="${APPLICATION_SHA}"',
        )
        self.assertTrue(evidence_violations(self.root))

    def test_hardcoded_health_field_fails(self) -> None:
        # THE defect the previous suite pinned in place: the loop read
        # `jq -r .sha`, the fixture served a top-level `.sha` no tenant
        # serves, and correcting the field broke the test that guarded it.
        self.mutate(
            CARRIER_SCRIPT,
            'jq -r "${SERVED_SHA_FIELD}"',
            "jq -r .sha",
        )
        violations = evidence_violations(self.root)
        self.assertTrue(any("hard-coded" in v for v in violations))

    def test_receipts_removed_fails(self) -> None:
        path = self.root / CARRIER_SCRIPT
        text = re.sub(r'(?m)^echo "receipt [^\n]*\n', "", path.read_text(encoding="utf-8"))
        path.write_text(text, encoding="utf-8")
        self.assertTrue(evidence_violations(self.root))


class TenancyMutationTests(unittest.TestCase):
    """N instantiations of the one module; every isolation law mutation-proven."""

    def setUp(self) -> None:
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        build_tenant_fixture(self.root)

    def stack(self, tenant: str) -> Path:
        return self.root / "tenants" / tenant / "tofu" / "stacks" / "application"

    def test_two_disjoint_tenants_pass(self) -> None:
        self.assertEqual([], tenancy_violations(self.root))

    def test_many_disjoint_tenants_pass(self) -> None:
        build_tenant_fixture(self.root, ("alpha", "beta", "gamma", "delta", "epsilon"))
        self.assertEqual([], tenancy_violations(self.root))

    def test_second_carrier_module_declared_fails(self) -> None:
        carrier = self.stack("alpha") / "carrier.tf"
        second = instantiation("alpha").replace(
            'module "converge_agent"', 'module "converge_agent_shadow"'
        )
        carrier.write_text(
            carrier.read_text(encoding="utf-8") + "\n" + second, encoding="utf-8"
        )
        violations = tenancy_violations(self.root)
        self.assertTrue(any("2 carriers" in v for v in violations))

    def test_raw_cronjob_beside_the_module_fails(self) -> None:
        (self.stack("alpha") / "hand-rolled.yaml").write_text(
            "apiVersion: batch/v1\nkind: CronJob\nmetadata:\n  name: shadow\n",
            encoding="utf-8",
        )
        violations = tenancy_violations(self.root)
        self.assertTrue(any("2 carriers" in v for v in violations))

    def test_commented_cronjob_prose_is_not_a_carrier(self) -> None:
        (self.stack("alpha") / "notes.yaml").write_text(
            "# the carrier is declared via the module, not as kind: CronJob here\n"
            "config: true\n",
            encoding="utf-8",
        )
        self.assertEqual([], tenancy_violations(self.root))

    def test_shared_state_key_fails(self) -> None:
        carrier = self.stack("beta") / "carrier.tf"
        carrier.write_text(
            carrier.read_text(encoding="utf-8").replace(
                "beta/application/production.tfstate",
                "alpha/application/production.tfstate",
            ),
            encoding="utf-8",
        )
        violations = tenancy_violations(self.root)
        self.assertTrue(any("two tenants, one state" in v or "not prefixed" in v for v in violations))

    def test_shared_namespace_fails(self) -> None:
        carrier = self.stack("beta") / "carrier.tf"
        carrier.write_text(
            carrier.read_text(encoding="utf-8").replace(
                'namespace             = "beta-production"',
                'namespace             = "alpha-production"',
            ),
            encoding="utf-8",
        )
        violations = tenancy_violations(self.root)
        self.assertTrue(any("disjoint namespaces" in v for v in violations))

    def test_malformed_state_key_fails(self) -> None:
        carrier = self.stack("alpha") / "carrier.tf"
        carrier.write_text(
            carrier.read_text(encoding="utf-8").replace(
                "alpha/application/production.tfstate", "shared.tfstate"
            ),
            encoding="utf-8",
        )
        self.assertTrue(tenancy_violations(self.root))

    def test_workflow_naming_a_stack_fails(self) -> None:
        (self.root / ".github" / "workflows" / "converge.yml").write_text(
            "jobs:\n  go:\n    steps:\n"
            "      - run: just production-converge\n"
            "        working-directory: tenants/alpha/tofu/stacks/application\n",
            encoding="utf-8",
        )
        violations = tenancy_violations(self.root)
        self.assertTrue(any("second carrier surface" in v for v in violations))

    def test_workflow_naming_a_state_key_fails(self) -> None:
        (self.root / ".github" / "workflows" / "peek.yml").write_text(
            "jobs:\n  go:\n    steps:\n"
            "      - run: tofu init -backend-config=key=alpha/application/production.tfstate\n",
            encoding="utf-8",
        )
        violations = tenancy_violations(self.root)
        self.assertTrue(any("second carrier surface" in v for v in violations))

    def test_commented_workflow_prose_passes(self) -> None:
        (self.root / ".github" / "workflows" / "notes.yml").write_text(
            "# the old carrier applied tenants/alpha/tofu/stacks/application\n"
            "jobs:\n  go:\n    steps:\n      - run: echo ok\n",
            encoding="utf-8",
        )
        self.assertEqual([], tenancy_violations(self.root))


def build_site_checkout(root: Path, tenant: str) -> None:
    """One tenant repository checkout in the REAL topology: the stack at
    tofu/stacks/application and the repo's own workflow surface — no
    tenants/ wrapper directory exists anywhere in the estate."""

    stack = root / "tofu" / "stacks" / "application"
    stack.mkdir(parents=True, exist_ok=True)
    (stack / "carrier.tf").write_text(instantiation(tenant), encoding="utf-8")
    workflows = root / ".github" / "workflows"
    workflows.mkdir(parents=True, exist_ok=True)
    (workflows / "ci.yml").write_text(
        "jobs:\n  test:\n    steps:\n      - run: echo unit tests only\n",
        encoding="utf-8",
    )


class CrossRepoTenancyTests(unittest.TestCase):
    """instantiation_set_violations over the real per-site-repo topology:
    separate checkouts (GFTB / MMS / tinyland.dev shape), shared state
    backend, per-repo workflow surfaces. This is the checker an aggregator
    lane drives over real clones; these tests prove it works on that layout
    (no tenants/ wrapper) and that every cross-repo collision law is
    mutation-proven there too."""

    def setUp(self) -> None:
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        base = Path(temporary.name)
        self.checkouts = {
            "gftb": base / "great-falls-tool-bus-infra",
            "mms": base / "medical-massage-specialists-infra",
            "tinyland": base / "tinyland-dev-infra",
        }
        for tenant, checkout in self.checkouts.items():
            build_site_checkout(checkout, tenant)

    def stacks(self) -> dict[str, Path]:
        return {
            tenant: checkout / "tofu" / "stacks" / "application"
            for tenant, checkout in self.checkouts.items()
        }

    def scans(self) -> tuple[tuple[Path, Path], ...]:
        return tuple(
            (checkout, checkout / ".github" / "workflows")
            for checkout in self.checkouts.values()
        )

    def carrier(self, tenant: str) -> Path:
        return self.checkouts[tenant] / "tofu" / "stacks" / "application" / "carrier.tf"

    def test_disjoint_site_repos_pass(self) -> None:
        self.assertEqual(
            [], instantiation_set_violations(self.stacks(), self.scans())
        )

    def test_cross_repo_shared_state_key_fails(self) -> None:
        carrier = self.carrier("mms")
        carrier.write_text(
            carrier.read_text(encoding="utf-8").replace(
                "mms/application/production.tfstate",
                "gftb/application/production.tfstate",
            ),
            encoding="utf-8",
        )
        violations = instantiation_set_violations(self.stacks(), self.scans())
        self.assertTrue(
            any("two tenants, one state" in v or "not prefixed" in v for v in violations)
        )

    def test_cross_repo_shared_namespace_fails(self) -> None:
        carrier = self.carrier("mms")
        carrier.write_text(
            carrier.read_text(encoding="utf-8").replace(
                'namespace             = "mms-production"',
                'namespace             = "gftb-production"',
            ),
            encoding="utf-8",
        )
        violations = instantiation_set_violations(self.stacks(), self.scans())
        self.assertTrue(any("disjoint namespaces" in v for v in violations))

    def test_own_workflow_naming_own_stack_fails(self) -> None:
        workflows = self.checkouts["gftb"] / ".github" / "workflows"
        (workflows / "converge.yml").write_text(
            "jobs:\n  go:\n    steps:\n"
            "      - run: just production-converge\n"
            "        working-directory: tofu/stacks/application\n",
            encoding="utf-8",
        )
        violations = instantiation_set_violations(self.stacks(), self.scans())
        self.assertTrue(any("second carrier surface" in v for v in violations))

    def test_workflow_in_one_repo_naming_another_tenants_key_fails(self) -> None:
        # The backend is shared: repo A's workflow initializing repo B's
        # state key is the cross-repo reach the doctrine names.
        workflows = self.checkouts["tinyland"] / ".github" / "workflows"
        (workflows / "peek.yml").write_text(
            "jobs:\n  go:\n    steps:\n"
            "      - run: tofu init"
            " -backend-config=key=gftb/application/production.tfstate\n",
            encoding="utf-8",
        )
        violations = instantiation_set_violations(self.stacks(), self.scans())
        self.assertTrue(any("second carrier surface" in v for v in violations))

    def test_second_raw_cronjob_in_one_repo_fails(self) -> None:
        stack = self.checkouts["mms"] / "tofu" / "stacks" / "application"
        (stack / "hand-rolled.yaml").write_text(
            "apiVersion: batch/v1\nkind: CronJob\nmetadata:\n  name: shadow\n",
            encoding="utf-8",
        )
        violations = instantiation_set_violations(self.stacks(), self.scans())
        self.assertTrue(any("2 carriers" in v for v in violations))


class ShaProvenanceTests(unittest.TestCase):
    """Two repositories, two shas — proven by execution against a fixture
    whose overlay sha and application sha DIFFER, which is the estate's real
    shape (MMS overlay `medical-massage-specialists-infra` vs application
    `Jesssullivan/MassageIthaca`; GFTB `great-falls-tool-bus-infra` vs
    `greatfallstoolbus.org`)."""

    def test_module_source_laws_hold(self) -> None:
        self.assertEqual([], sha_provenance_violations(MODULE_ROOT))

    def test_edge_is_compared_to_the_application_sha_not_the_overlay(self) -> None:
        live = execute_carrier(
            MODULE_ROOT,
            enabled=True,
            extra_env={"SOURCE_REPOSITORY_URL": "https://github.com/example/app"},
            health_body=json.dumps({"sha": STUB_SOURCE_SHA}),
        )
        self.assertEqual(0, live.returncode, live.stderr)
        self.assertIn("converge=ok", live.stdout)
        self.assertIn(f"application_sha={STUB_SOURCE_SHA}", live.stdout)
        self.assertIn(f"overlay_sha={STUB_OVERLAY_SHA}", live.stdout)
        self.assertTrue(
            any(c.startswith("git ls-remote") for c in live.calls), live.calls
        )
        # ls-remote, never a second clone: exactly one `git clone` all tick.
        self.assertEqual(1, len([c for c in live.calls if c.startswith("git clone")]))

    def test_overlay_sha_at_the_edge_is_a_failure_when_repos_differ(self) -> None:
        # The pre-fix behavior, stated as a failing expectation: an edge that
        # serves the OVERLAY sha while a separate application repo is declared
        # must fail, because that edge is not serving the application's main.
        run = execute_carrier(
            MODULE_ROOT,
            enabled=True,
            extra_env={"SOURCE_REPOSITORY_URL": "https://github.com/example/app"},
            health_body=json.dumps({"sha": STUB_OVERLAY_SHA}),
        )
        self.assertNotEqual(0, run.returncode)
        self.assertIn(STUB_SOURCE_SHA, run.stderr)

    def test_unset_source_repository_keeps_the_previous_behaviour(self) -> None:
        # Additive-by-default: a tenant that declares no application
        # repository gets exactly the loop it had before the input existed.
        live = execute_carrier(MODULE_ROOT, enabled=True)
        self.assertEqual(0, live.returncode, live.stderr)
        self.assertIn(f"application_sha={STUB_OVERLAY_SHA}", live.stdout)
        self.assertEqual([], [c for c in live.calls if c.startswith("git ls-remote")])

    def test_template_tag_uses_the_application_sha_short7(self) -> None:
        # The MassageIthaca shape end to end: MI's docker-ghcr.yml publishes
        # `type=sha,prefix=sha-` (7-hex), tagged with the APPLICATION repo's
        # github.sha. An overlay-derived, 40-hex tag names nothing.
        live = execute_carrier(
            MODULE_ROOT,
            enabled=True,
            extra_env={
                "APPLICATION_IMAGE_TAG": "",
                "APPLICATION_IMAGE_REPOSITORY": "ghcr.io/jesssullivan/massageithaca",
                "IMAGE_TAG_TEMPLATE": "sha-{short7}",
                "SOURCE_REPOSITORY_URL": "https://github.com/Jesssullivan/MassageIthaca",
            },
            health_body=json.dumps({"sha": STUB_SOURCE_SHA}),
        )
        self.assertEqual(0, live.returncode, live.stderr)
        expected = f"ghcr.io/jesssullivan/massageithaca:sha-{STUB_SOURCE_SHA[:7]}"
        self.assertIn(f"crane digest {expected}", live.calls)
        self.assertNotIn(STUB_OVERLAY_SHA[:7], "".join(live.calls))

    def test_source_branch_selects_the_ref(self) -> None:
        live = execute_carrier(
            MODULE_ROOT,
            enabled=True,
            extra_env={
                "SOURCE_REPOSITORY_URL": "https://github.com/example/app",
                "SOURCE_BRANCH": "release",
            },
            health_body=json.dumps({"sha": STUB_SOURCE_SHA}),
        )
        self.assertEqual(0, live.returncode, live.stderr)
        self.assertIn(
            "git ls-remote https://github.com/example/app refs/heads/release",
            live.calls,
        )

    def test_unresolvable_source_ref_fails_before_apply(self) -> None:
        run = execute_carrier(
            MODULE_ROOT,
            enabled=True,
            extra_env={"SOURCE_REPOSITORY_URL": "https://github.com/example/app"},
            source_sha="",
        )
        self.assertNotEqual(0, run.returncode)
        self.assertEqual([], run.called("crane"))
        self.assertEqual([], [c for c in run.called("tofu") if "apply" in c])


class ServedShaFieldTests(unittest.TestCase):
    """The health field is a tenant fact. MMS serves `.build.commitHash`."""

    def test_default_field_reads_the_top_level_sha(self) -> None:
        live = execute_carrier(MODULE_ROOT, enabled=True)
        self.assertEqual(0, live.returncode, live.stderr)

    def test_mms_payload_shape_needs_the_input(self) -> None:
        mms_payload = json.dumps(
            {
                "status": "ok",
                "build": {"commitHash": STUB_SOURCE_SHA, "commitShort": STUB_SOURCE_SHA[:7]},
            }
        )
        env = {"SOURCE_REPOSITORY_URL": "https://github.com/Jesssullivan/MassageIthaca"}
        # Without the input the loop reads null at this real payload shape.
        blind = execute_carrier(
            MODULE_ROOT, enabled=True, extra_env=env, health_body=mms_payload
        )
        self.assertNotEqual(0, blind.returncode)
        self.assertIn("edge serves null", blind.stderr)
        # With it, the same payload converges.
        live = execute_carrier(
            MODULE_ROOT,
            enabled=True,
            extra_env={**env, "SERVED_SHA_FIELD": ".build.commitHash"},
            health_body=mms_payload,
        )
        self.assertEqual(0, live.returncode, live.stderr)
        self.assertIn(f"served_sha={STUB_SOURCE_SHA}", live.stdout)

    def test_non_jq_path_refuses_to_run(self) -> None:
        run = execute_carrier(
            MODULE_ROOT, enabled=True, extra_env={"SERVED_SHA_FIELD": "build.commitHash"}
        )
        self.assertNotEqual(0, run.returncode)
        self.assertEqual([], run.called("crane"))


class EnabledFlagPointerTests(unittest.TestCase):
    """The kill switch may live at any reviewed key."""

    # `armed` rides every explicit document now: a tenant whose arming
    # ceremony has happened is the only tenant that reaches the kill switch.
    NESTED = {"armed": True, "enabled": True, "convergence": {"enabled": False}}

    def test_default_pointer_reads_the_top_level_flag(self) -> None:
        live = execute_carrier(
            MODULE_ROOT, enabled=True, workflow_state=self.NESTED
        )
        self.assertEqual(0, live.returncode, live.stderr)
        self.assertNotIn("halted=", live.stdout)

    def test_pointer_selects_a_nested_flag(self) -> None:
        halted = execute_carrier(
            MODULE_ROOT,
            enabled=True,
            workflow_state=self.NESTED,
            extra_env={"ENABLED_FLAG_POINTER": "/convergence/enabled"},
        )
        self.assertEqual(0, halted.returncode)
        self.assertIn("halted=reviewed-enabled-false", halted.stdout)
        for tool in ("crane", "tofu", "kubectl", "curl"):
            self.assertEqual([], halted.called(tool))

    def test_pointer_to_a_missing_key_halts_rather_than_converging(self) -> None:
        halted = execute_carrier(
            MODULE_ROOT,
            enabled=True,
            extra_env={"ENABLED_FLAG_POINTER": "/does/not/exist"},
        )
        self.assertEqual(0, halted.returncode)
        self.assertIn("halted=reviewed-enabled-false", halted.stdout)

    def test_malformed_pointer_refuses_to_run(self) -> None:
        run = execute_carrier(
            MODULE_ROOT, enabled=True, extra_env={"ENABLED_FLAG_POINTER": "enabled"}
        )
        self.assertNotEqual(0, run.returncode)
        self.assertIn("RFC 6901", run.stderr)


class OverlayBranchTests(unittest.TestCase):
    def test_default_clones_main(self) -> None:
        live = execute_carrier(MODULE_ROOT, enabled=True)
        self.assertTrue(
            any("--branch main" in c for c in live.called("git")), live.calls
        )

    def test_input_selects_the_clone_ref(self) -> None:
        live = execute_carrier(
            MODULE_ROOT, enabled=True, extra_env={"OVERLAY_BRANCH": "trunk"}
        )
        self.assertTrue(any("--branch trunk" in c for c in live.called("git")))
        self.assertIn("overlay_branch=trunk", live.stdout)


class ApplySurfaceTests(unittest.TestCase):
    """backend_config_path, var_file_path, and more than one -var."""

    def plan(self, run: CarrierRun) -> str:
        plans = [c for c in run.called("tofu") if c.startswith("tofu plan")]
        self.assertTrue(plans, run.calls)
        return plans[0]

    def init(self, run: CarrierRun) -> str:
        inits = [c for c in run.called("tofu") if c.startswith("tofu init")]
        self.assertTrue(inits, run.calls)
        return inits[0]

    def test_no_var_file_by_default(self) -> None:
        live = execute_carrier(MODULE_ROOT, enabled=True)
        self.assertEqual(0, live.returncode, live.stderr)
        self.assertNotIn("-var-file", self.plan(live))

    def test_var_file_path_reaches_the_plan(self) -> None:
        live = execute_carrier(
            MODULE_ROOT,
            enabled=True,
            extra_env={
                "VAR_FILE_PATH": "tofu/stacks/application/production.tfvars.json"
            },
        )
        self.assertEqual(0, live.returncode, live.stderr)
        self.assertIn(
            "-var-file=", self.plan(live)
        )
        self.assertIn("tofu/stacks/application/production.tfvars.json", self.plan(live))

    def test_no_backend_config_file_by_default(self) -> None:
        live = execute_carrier(MODULE_ROOT, enabled=True)
        self.assertEqual(0, live.returncode, live.stderr)
        self.assertNotIn(".hcl", self.init(live))

    def test_backend_config_path_reaches_init_before_the_flags(self) -> None:
        live = execute_carrier(
            MODULE_ROOT,
            enabled=True,
            extra_env={
                "BACKEND_CONFIG_PATH": "tofu/backend/application-production.s3.hcl"
            },
        )
        self.assertEqual(0, live.returncode, live.stderr)
        init = self.init(live)
        self.assertIn("application-production.s3.hcl", init)
        # The module's validated key must win the merge, so it comes LAST.
        self.assertLess(init.index(".hcl"), init.index("key="))

    def test_exactly_one_var_by_default(self) -> None:
        live = execute_carrier(MODULE_ROOT, enabled=True)
        self.assertEqual(1, self.plan(live).count("-var "))

    def test_overrides_add_vars_and_resolve_placeholders(self) -> None:
        # The MMS shape: the stack takes image_repository + image_digest, and
        # the mutable image_tag is emptied so the digest is the only image
        # authority the plan composes.
        live = execute_carrier(
            MODULE_ROOT,
            enabled=True,
            extra_env={
                "APPLICATION_IMAGE_VARIABLE": "",
                "APPLY_VARIABLE_OVERRIDES": json.dumps(
                    {"image_tag": "", "image_digest": "{digest}"}
                ),
            },
        )
        self.assertEqual(0, live.returncode, live.stderr)
        plan = self.plan(live)
        self.assertIn("-var image_tag=", plan)
        self.assertIn(f"-var image_digest={STUB_DIGEST}", plan)
        self.assertNotIn("{digest}", plan)
        self.assertNotIn("-var application_image=", plan)

    def test_dropping_every_digest_channel_refuses_to_run(self) -> None:
        run = execute_carrier(
            MODULE_ROOT,
            enabled=True,
            extra_env={
                "APPLICATION_IMAGE_VARIABLE": "",
                "APPLY_VARIABLE_OVERRIDES": json.dumps({"image_tag": ""}),
            },
        )
        self.assertNotEqual(0, run.returncode)
        self.assertEqual([], run.called("crane"))

    def test_malformed_overrides_refuse_to_run(self) -> None:
        run = execute_carrier(
            MODULE_ROOT, enabled=True, extra_env={"APPLY_VARIABLE_OVERRIDES": "[1,2]"}
        )
        self.assertNotEqual(0, run.returncode)
        self.assertEqual([], run.called("crane"))


class ManifestRenderingTests(unittest.TestCase):
    """Credential-custody inputs change what the CronJob DECLARES."""

    def test_base_render_is_complete(self) -> None:
        rendered = render_cronjob()
        self.assertIn("kind: CronJob", rendered)
        self.assertIn("name: converge-agent", rendered)

    def test_cloudflare_secret_absent_by_default(self) -> None:
        rendered = render_cronjob()
        self.assertNotIn("CLOUDFLARE_API_TOKEN", rendered)

    def test_cloudflare_secret_is_a_name_only_reference(self) -> None:
        rendered = render_cronjob(cloudflare_secret_name="converge-agent-cloudflare")
        self.assertIn("CLOUDFLARE_API_TOKEN", rendered)
        self.assertIn("TF_VAR_cloudflare_api_token", rendered)
        self.assertIn("name: converge-agent-cloudflare", rendered)
        self.assertIsNone(
            re.search(r"CLOUDFLARE_API_TOKEN\s*\n\s*value:", rendered)
        )

    def test_registry_pull_secret_absent_by_default(self) -> None:
        rendered = render_cronjob()
        for absent in ("DOCKER_CONFIG", "registry-credentials", "/secrets/registry"):
            self.assertNotIn(absent, rendered)

    def test_registry_pull_secret_projects_a_docker_config(self) -> None:
        rendered = render_cronjob(registry_pull_secret_name="ghcr-pull")
        self.assertIn("DOCKER_CONFIG", rendered)
        self.assertIn("secretName: ghcr-pull", rendered)
        self.assertIn("path: config.json", rendered)
        # Mounted read-only, and the volume appears exactly once.
        self.assertEqual(2, rendered.count("name: registry-credentials"))

    def test_new_inputs_render_into_the_environment(self) -> None:
        rendered = render_cronjob(
            source_repository_url="https://github.com/example/app",
            served_sha_field=".build.commitHash",
            var_file_path="tofu/stacks/application/production.tfvars.json",
            backend_config_path="tofu/backend/application-production.s3.hcl",
            enabled_flag_pointer="/convergence/enabled",
            apply_variable_overrides_json='"{\\"image_tag\\":\\"\\"}"',
        )
        for expected in (
            "https://github.com/example/app",
            ".build.commitHash",
            "tofu/stacks/application/production.tfvars.json",
            "tofu/backend/application-production.s3.hcl",
            "/convergence/enabled",
        ):
            self.assertIn(expected, rendered)


class ApplicationCredentialSeamTests(unittest.TestCase):
    """D1 (operator ruling 2026-08-13) — the application-repository credential
    seam, as a law rather than a conversation.

    A deploy key authorizes exactly ONE repository, so the overlay's key can
    never read a private APPLICATION repository. The seam adds a second key
    path and a generated ssh config that routes each remote to its own
    identity. Four things must hold, and each is proven here by EXECUTION or
    by rendering the real template:

    1. Default OFF is the pre-input behaviour, byte for byte — no second
       mount, no generated config, GIT_SSH_COMMAND exactly as the manifest
       set it, and the tenant's real remotes handed to git unrewritten.
    2. Seam ON routes TWO identities: one Host alias per role, each carrying
       its own HostName and its own IdentityFile, and each remote rewritten
       onto its own alias. (Two IdentityFile lines under one Host does NOT
       work — the server accepts the first key it can authenticate and then
       refuses the repository, which ssh never retries. This is the whole
       reason aliases exist here.)
    3. Mis-instantiations fail CLOSED, before any clone: a key with no
       application repository to read, an https application remote that can
       present no ssh identity, an unreadable key.
    4. Credential custody is unchanged: the manifest carries Secret NAMES and
       in-container PATHS only, never key material.
    """

    OVERLAY_REMOTE = "git@github.com:example/fixture-infra.git"
    APPLICATION_REMOTE = "git@github.com:example/fixture-app.git"

    def setUp(self) -> None:
        self.keys = Path(tempfile.mkdtemp(prefix="converge-agent-keys-"))
        self.addCleanup(shutil.rmtree, self.keys, True)
        self.overlay_key = self.keys / "overlay" / "id_ed25519"
        self.application_key = self.keys / "application" / "id_ed25519"
        for key in (self.overlay_key, self.application_key):
            key.parent.mkdir(parents=True)
            key.write_text("not a real key; the loop only ever reads its PATH\n")

    def seam_env(self, **overrides: str) -> dict[str, str]:
        env = {
            "OVERLAY_REPO_SSH": self.OVERLAY_REMOTE,
            "SOURCE_REPOSITORY_URL": self.APPLICATION_REMOTE,
            "OVERLAY_DEPLOY_KEY_PATH": str(self.overlay_key),
            "APPLICATION_DEPLOY_KEY_PATH": str(self.application_key),
        }
        env.update(overrides)
        return env

    def run_tick(self, **env: str) -> CarrierRun:
        """A full tick for a two-repository tenant: the edge serves the
        APPLICATION sha, so a conforming loop reaches converge=ok."""

        return execute_carrier(
            MODULE_ROOT,
            enabled=True,
            extra_env=env,
            health_body=json.dumps({"sha": STUB_SOURCE_SHA}),
        )

    # ------------------------------------------------------------ default --

    def test_default_tick_generates_no_ssh_config_and_rewrites_nothing(self) -> None:
        # The pre-D1 behaviour, proven by execution: no -F config reaches git,
        # and the remote git is handed is the tenant's own, unaliased.
        live = self.run_tick(SOURCE_REPOSITORY_URL="https://github.com/example/app")
        self.assertEqual(0, live.returncode, live.stderr)
        self.assertEqual("", live.ssh_config)
        self.assertNotIn("converge-agent-overlay", "".join(live.calls))
        self.assertNotIn("converge-agent-application", "".join(live.calls))
        self.assertTrue(
            any("git@github.com:example/fixture-infra.git" in c for c in live.calls),
            live.calls,
        )
        self.assertIn(
            "git ls-remote https://github.com/example/app refs/heads/main", live.calls
        )
        self.assertNotIn("ssh_identities=", live.stdout)

    def test_default_render_carries_one_identity_and_one_mount(self) -> None:
        rendered = render_cronjob()
        self.assertIn("ssh -i /secrets/deploy-key/id_ed25519", rendered)
        self.assertNotIn("APPLICATION_DEPLOY_KEY_PATH", rendered)
        self.assertNotIn("application-deploy-key", rendered)
        # Exactly one deploy-key volume and one mount for it.
        self.assertEqual(2, rendered.count("name: deploy-key"))

    # ---------------------------------------------------------- seam is on --

    def test_seam_routes_each_remote_to_its_own_identity(self) -> None:
        live = self.run_tick(**self.seam_env())
        self.assertEqual(0, live.returncode, live.stderr)

        config = live.ssh_config
        self.assertIn("Host converge-agent-overlay", config)
        self.assertIn("Host converge-agent-application", config)
        # Each alias resolves to the real host AND to its OWN key. A config
        # that stacks both IdentityFiles under one Host would satisfy a naive
        # "both keys present" check and still fail against a real server.
        overlay_block, _, application_block = config.partition(
            "Host converge-agent-application"
        )
        self.assertIn(str(self.overlay_key), overlay_block)
        self.assertNotIn(str(self.application_key), overlay_block)
        self.assertIn(str(self.application_key), application_block)
        self.assertNotIn(str(self.overlay_key), application_block)
        for block in (overlay_block, application_block):
            self.assertIn("HostName github.com", block)
            self.assertIn("IdentitiesOnly yes", block)
            self.assertEqual(1, block.count("IdentityFile"))

        # ...and each git call actually travels through its own alias.
        clones = [c for c in live.calls if c.startswith("git clone")]
        self.assertEqual(1, len(clones), live.calls)
        self.assertIn("git@converge-agent-overlay:example/fixture-infra.git", clones[0])
        self.assertIn(
            "git ls-remote git@converge-agent-application:example/fixture-app.git"
            " refs/heads/main",
            live.calls,
        )
        # The receipt names the real hosts, never the internal aliases.
        self.assertIn("ssh_identities=overlay+application", live.stdout)
        self.assertIn("application_host=github.com", live.stdout)

    def test_seam_supports_the_ssh_url_form(self) -> None:
        live = self.run_tick(
            **self.seam_env(
                SOURCE_REPOSITORY_URL="ssh://git@github.com/example/fixture-app.git"
            )
        )
        self.assertEqual(0, live.returncode, live.stderr)
        self.assertIn(
            "git ls-remote ssh://git@converge-agent-application/example/fixture-app.git"
            " refs/heads/main",
            live.calls,
        )

    def test_seam_render_adds_a_second_mount_and_path(self) -> None:
        rendered = render_cronjob(
            application_deploy_key_secret_name="converge-agent-application-deploy-key",
            source_repository_url="git@github.com:example/fixture-app.git",
        )
        self.assertIn("APPLICATION_DEPLOY_KEY_PATH", rendered)
        self.assertIn("/secrets/application-deploy-key/id_ed25519", rendered)
        self.assertIn("secretName: converge-agent-application-deploy-key", rendered)
        # One volume + one mount, and the two keys never share a mountPath.
        self.assertEqual(2, rendered.count("name: application-deploy-key"))
        self.assertIn("mountPath: /secrets/application-deploy-key", rendered)
        self.assertIn("mountPath: /secrets/deploy-key", rendered)

    def test_key_material_never_appears_in_the_manifest(self) -> None:
        # Custody law: names and paths in git, values only in the Secret.
        rendered = render_cronjob(
            application_deploy_key_secret_name="converge-agent-application-deploy-key",
        )
        self.assertIsNone(
            re.search(r"APPLICATION_DEPLOY_KEY(?:_PATH)?\s*\n\s*valueFrom", rendered)
        )
        for material in ("PRIVATE KEY", "BEGIN OPENSSH"):
            self.assertNotIn(material, rendered)

    # -------------------------------------------------------- fail closed --

    def test_a_key_with_no_application_repository_refuses_the_tick(self) -> None:
        run = execute_carrier(
            MODULE_ROOT,
            enabled=True,
            extra_env=self.seam_env(SOURCE_REPOSITORY_URL=""),
        )
        self.assertNotEqual(0, run.returncode)
        self.assertIn("SOURCE_REPOSITORY_URL is empty", run.stderr)
        self.assertEqual([], run.called("git"))

    def test_an_https_application_remote_refuses_the_tick(self) -> None:
        # The failure this prevents looks like a credential problem and is an
        # addressing one: an https remote presents no ssh identity, so the
        # mounted key is silently unused and the private repo stays unreadable.
        run = execute_carrier(
            MODULE_ROOT,
            enabled=True,
            extra_env=self.seam_env(
                SOURCE_REPOSITORY_URL="https://github.com/example/fixture-app"
            ),
        )
        self.assertNotEqual(0, run.returncode)
        self.assertIn("not an ssh remote", run.stderr)
        self.assertEqual([], run.called("git"))

    def test_an_unreadable_key_refuses_the_tick(self) -> None:
        run = execute_carrier(
            MODULE_ROOT,
            enabled=True,
            extra_env=self.seam_env(
                APPLICATION_DEPLOY_KEY_PATH=str(self.keys / "never-projected")
            ),
        )
        self.assertNotEqual(0, run.returncode)
        self.assertIn("deploy key unreadable", run.stderr)
        self.assertEqual([], run.called("git"))

    # ------------------------------------------------------ declarations --

    def test_variables_and_preconditions_declare_the_seam(self) -> None:
        variables = read(MODULE_ROOT, f"{TOFU_DIR}/variables.tf")
        for declaration in (
            'variable "deploy_key_path"',
            'variable "application_deploy_key_secret_name"',
            'variable "application_deploy_key_path"',
        ):
            self.assertIn(declaration, variables)
        main = read(MODULE_ROOT, f"{TOFU_DIR}/main.tf")
        # The three rulings that must not be re-litigated in conversation.
        self.assertIn("application_deploy_key_secret_name is set but", main)
        self.assertIn("requires an SSH source_repository_url", main)
        self.assertIn("must live in different directories", main)


class ApplicationCredentialSeamMutationTests(unittest.TestCase):
    """The seam's own laws, mutation-proven: each checker must go RED when the
    property it names is removed."""

    def setUp(self) -> None:
        self.root = Path(tempfile.mkdtemp(prefix="converge-agent-seam-mutation-"))
        self.addCleanup(shutil.rmtree, self.root, True)
        for relative in (CARRIER_SCRIPT, CRONJOB_TEMPLATE):
            destination = self.root / relative
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(MODULE_ROOT / relative, destination)
        shutil.copytree(MODULE_ROOT / TOFU_DIR, self.root / TOFU_DIR)

    def mutate(self, relative: str, old: str, new: str) -> None:
        path = self.root / relative
        text = path.read_text(encoding="utf-8")
        self.assertIn(old, text, f"{relative}: mutation target absent")
        path.write_text(text.replace(old, new, 1), encoding="utf-8")

    def test_seeding_the_application_remote_from_elsewhere_fails(self) -> None:
        # The alias rewrite may change a remote's HOST; it may never change
        # WHICH repository the instantiation declared.
        self.mutate(
            CARRIER_SCRIPT,
            'APPLICATION_REMOTE="${SOURCE_REPOSITORY_URL:-}"',
            'APPLICATION_REMOTE="${OVERLAY_REPO_SSH}"',
        )
        violations = sha_provenance_violations(self.root)
        self.assertTrue(
            any("APPLICATION_REMOTE is not seeded" in v for v in violations), violations
        )

    def test_seeding_the_overlay_remote_from_elsewhere_fails(self) -> None:
        self.mutate(
            CARRIER_SCRIPT,
            'OVERLAY_REMOTE="${OVERLAY_REPO_SSH}"',
            'OVERLAY_REMOTE="${SOURCE_REPOSITORY_URL:-}"',
        )
        violations = sha_provenance_violations(self.root)
        self.assertTrue(
            any("OVERLAY_REMOTE is not seeded" in v for v in violations), violations
        )

    def test_dropping_the_threaded_key_paths_fails(self) -> None:
        self.mutate(
            CRONJOB_TEMPLATE,
            "- name: APPLICATION_DEPLOY_KEY_PATH",
            "- name: APPLICATION_DEPLOY_KEY_PATH_UNTHREADED",
        )
        violations = input_surface_violations(self.root)
        self.assertTrue(
            any("APPLICATION_DEPLOY_KEY_PATH" in v for v in violations), violations
        )


class PackageLawTests(unittest.TestCase):
    """Laws over the whole shipped package (tofu/ included)."""

    def test_shipped_package_conforms(self) -> None:
        self.assertEqual([], module_package_violations(MODULE_ROOT))

    def test_every_declared_variable_is_documented(self) -> None:
        variables = read(MODULE_ROOT, f"{TOFU_DIR}/variables.tf")
        for block in _blocks(variables, re.compile(r'(?m)^variable\s+"[^"]+"\s*\{')):
            name = re.search(r'variable\s+"([^"]+)"', block).group(1)
            self.assertIn("description", block, f"variable {name} has no description")


class PackageMutationTests(unittest.TestCase):
    """The package laws go red under exactly the mutation they exist to catch.

    Every mutation below is applied to a COPY of the shipped tofu package;
    the shipped files are never modified.
    """

    def setUp(self) -> None:
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        for relative in (CARRIER_SCRIPT, CRONJOB_TEMPLATE):
            destination = self.root / relative
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(MODULE_ROOT / relative, destination)
        shutil.copytree(MODULE_ROOT / TOFU_DIR, self.root / TOFU_DIR)

    def mutate(self, relative: str, old: str, new: str) -> None:
        path = self.root / relative
        text = path.read_text(encoding="utf-8")
        self.assertIn(old, text, f"mutation anchor missing from {relative}: {old!r}")
        path.write_text(text.replace(old, new), encoding="utf-8")

    def test_copied_package_conforms(self) -> None:
        self.assertEqual([], module_package_violations(self.root))

    def test_ungated_carrier_fails(self) -> None:
        self.mutate(f"{TOFU_DIR}/main.tf", "  count = var.enabled ? 1 : 0\n\n  manifest", "  manifest")
        violations = gate_violations(self.root)
        self.assertTrue(any("count-gated" in v for v in violations))

    def test_bare_carrier_address_output_fails(self) -> None:
        self.mutate(
            f"{TOFU_DIR}/outputs.tf",
            '"kubernetes_manifest.converge_agent[0]"',
            '"kubernetes_manifest.converge_agent"',
        )
        violations = gate_violations(self.root)
        self.assertTrue(any("[0] index" in v for v in violations))

    def test_dropped_variable_fails(self) -> None:
        self.mutate(f"{TOFU_DIR}/variables.tf", 'variable "var_file_path"', 'variable "unused_path"')
        violations = input_surface_violations(self.root)
        self.assertTrue(any("var_file_path" in v for v in violations))

    def test_input_declared_but_never_rendered_fails(self) -> None:
        self.mutate(CRONJOB_TEMPLATE, "                - name: SERVED_SHA_FIELD\n", "")
        violations = input_surface_violations(self.root)
        self.assertTrue(any("SERVED_SHA_FIELD" in v for v in violations))

    def test_input_rendered_but_never_supplied_fails(self) -> None:
        self.mutate(
            f"{TOFU_DIR}/main.tf",
            "      served_sha_field              = var.served_sha_field\n",
            "",
        )
        violations = input_surface_violations(self.root)
        self.assertTrue(any("served_sha_field" in v for v in violations))

    # ---- state-key scope: the four ratified quadrants, then the mutations --

    def test_narrowing_the_key_shape_back_to_production_only_fails(self) -> None:
        # The pre-fix shape: only <site>/<stack>/production.tfstate admitted,
        # which refused the documented spoke PR-lane layout outright.
        self.mutate(
            f"{TOFU_DIR}/variables.tf",
            '      || can(regex("^spokes/[a-z][a-z0-9-]{1,62}/pr/[1-9][0-9]{0,8}/lanes/[a-z][a-z0-9-]{0,62}/opentofu\\\\.tfstate$", var.state_backend.key))\n',
            "",
        )
        violations = state_key_scope_violations(self.root)
        self.assertTrue(any("spoke PR-lane shape" in v for v in violations))

    def test_unscoping_the_spoke_key_from_its_tenant_fails(self) -> None:
        # A spoke branch that checks only the spokes/ literal admits every
        # OTHER tenant's PR-lane state — two writers wearing one prefix. The
        # extraction-based checker fails CLOSED on this mutation (no
        # tenant-scoped spoke prefix remains, so no spoke key is admitted),
        # which still reddens a spoke quadrant.
        self.mutate(
            f"{TOFU_DIR}/variables.tf",
            '? startswith(var.state_backend.key, "spokes/${var.tenant}/pr/")',
            '? startswith(var.state_backend.key, "spokes/")',
        )
        violations = state_key_scope_violations(self.root)
        self.assertTrue(any("spoke PR-lane shape" in v for v in violations))

    def test_unscoping_the_production_key_fails(self) -> None:
        self.mutate(
            f"{TOFU_DIR}/variables.tf",
            ': startswith(var.state_backend.key, "${var.tenant}/")',
            ": true",
        )
        self.assertTrue(state_key_scope_violations(self.root))

    def test_dropping_the_scoping_validation_fails(self) -> None:
        self.mutate(
            f"{TOFU_DIR}/variables.tf",
            '      startswith(var.state_backend.key, "spokes/")\n'
            '      ? startswith(var.state_backend.key, "spokes/${var.tenant}/pr/")\n'
            '      : startswith(var.state_backend.key, "${var.tenant}/")\n',
            "      true\n",
        )
        self.assertTrue(state_key_scope_violations(self.root))

    # ---- carrier-liveness detector ref: required, non-empty, annotated -----

    def test_dropping_the_liveness_ref_variable_fails(self) -> None:
        self.mutate(
            f"{TOFU_DIR}/variables.tf",
            'variable "carrier_liveness_alert_ref"',
            'variable "carrier_liveness_alert_ref_retired"',
        )
        violations = liveness_ref_violations(self.root)
        self.assertTrue(any("no carrier_liveness_alert_ref" in v for v in violations))

    def test_defaulting_the_liveness_ref_fails(self) -> None:
        self.mutate(
            f"{TOFU_DIR}/variables.tf",
            'variable "carrier_liveness_alert_ref" {\n  description',
            'variable "carrier_liveness_alert_ref" {\n  default     = "converge-agent-liveness"\n  description',
        )
        violations = liveness_ref_violations(self.root)
        self.assertTrue(any("default" in v for v in violations))

    def test_unfailable_liveness_validation_fails(self) -> None:
        # TIN-3457's defect class, applied here: `>= 0` keeps the validation
        # block's whole text shape while admitting the empty string.
        self.mutate(
            f"{TOFU_DIR}/variables.tf",
            "length(trimspace(var.carrier_liveness_alert_ref)) > 0",
            "length(trimspace(var.carrier_liveness_alert_ref)) >= 0",
        )
        violations = liveness_ref_violations(self.root)
        self.assertTrue(any("empty string" in v for v in violations))

    def test_dropping_the_liveness_annotation_fails(self) -> None:
        self.mutate(
            CRONJOB_TEMPLATE,
            '    tinyland.dev/carrier-liveness-alert: "${carrier_liveness_alert_ref}"\n',
            "",
        )
        violations = liveness_ref_violations(self.root)
        self.assertTrue(any("annotation" in v for v in violations))

    def test_overlay_branch_default_moved_off_main_fails(self) -> None:
        self.mutate(
            f"{TOFU_DIR}/variables.tf",
            'variable "overlay_branch" {\n  description',
            'variable "overlay_branch" {\n  # default moved off main\n  description',
        )
        self.mutate(
            f"{TOFU_DIR}/variables.tf",
            '  type        = string\n  default     = "main"\n\n  validation {\n    condition     = can(regex("^[A-Za-z0-9][A-Za-z0-9._/-]*$", var.overlay_branch))',
            '  type        = string\n  default     = "serving"\n\n  validation {\n    condition     = can(regex("^[A-Za-z0-9][A-Za-z0-9._/-]*$", var.overlay_branch))',
        )
        violations = main_only_violations(self.root)
        self.assertTrue(any("default to main" in v for v in violations))


class StateKeyScopeTests(unittest.TestCase):
    """Both documented state-key shapes are admitted, and only under their own
    tenant — the four ratified quadrants, judged against the shipped
    validation source (mutations live in PackageMutationTests)."""

    def test_all_quadrants_hold_on_the_shipped_module(self) -> None:
        self.assertEqual([], state_key_scope_violations(MODULE_ROOT))

    def admitted(self, tenant: str, key: str) -> bool:
        return state_backend_key_admitted(
            read(MODULE_ROOT, f"{TOFU_DIR}/variables.tf"), tenant, key
        )

    def test_own_tenant_production_key_is_admitted(self) -> None:
        self.assertTrue(self.admitted("mms", "mms/application/production.tfstate"))

    def test_own_tenant_spoke_pr_lane_key_is_admitted(self) -> None:
        self.assertTrue(self.admitted("mms", "spokes/mms/pr/42/lanes/qa/opentofu.tfstate"))

    def test_foreign_tenant_production_key_is_refused(self) -> None:
        self.assertFalse(self.admitted("mms", "gftb/application/production.tfstate"))

    def test_foreign_tenant_spoke_pr_lane_key_is_refused(self) -> None:
        self.assertFalse(self.admitted("mms", "spokes/gftb/pr/42/lanes/qa/opentofu.tfstate"))

    def test_a_tenant_prefix_collision_is_not_a_scope(self) -> None:
        # "mms-two" starts with "mms" but is a DIFFERENT tenant; the slash in
        # the scoping prefix is what keeps prefix-similar tenants apart.
        self.assertFalse(self.admitted("mms", "mms-two/application/production.tfstate"))
        self.assertFalse(self.admitted("mms", "spokes/mms-two/pr/42/lanes/qa/opentofu.tfstate"))


class LivenessRefTests(unittest.TestCase):
    """converge-agent.md §1: an instantiation without a named carrier-liveness
    detector is refused, and the name rides the CronJob annotation."""

    def test_shipped_module_conforms(self) -> None:
        self.assertEqual([], liveness_ref_violations(MODULE_ROOT))

    def test_the_annotation_renders_the_named_detector(self) -> None:
        rendered = render_cronjob(
            carrier_liveness_alert_ref="grafana-alert:mms-converge-agent-liveness"
        )
        self.assertIn(
            'tinyland.dev/carrier-liveness-alert: "grafana-alert:mms-converge-agent-liveness"',
            rendered,
        )


class ShaProvenanceMutationTests(unittest.TestCase):
    """The two-repository law, mutation-proven on a copy of the loop body."""

    def setUp(self) -> None:
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        for relative in (CARRIER_SCRIPT, CRONJOB_TEMPLATE):
            destination = self.root / relative
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(MODULE_ROOT / relative, destination)

    def mutate(self, relative: str, old: str, new: str) -> None:
        path = self.root / relative
        text = path.read_text(encoding="utf-8")
        self.assertIn(old, text, f"mutation anchor missing from {relative}: {old!r}")
        path.write_text(text.replace(old, new), encoding="utf-8")

    def test_comparing_the_served_sha_to_the_overlay_sha_fails(self) -> None:
        # Exactly the shipped defect: the assert compares what the
        # APPLICATION serves to the sha of the OVERLAY repository.
        self.mutate(
            CARRIER_SCRIPT,
            'if [ "${SERVED_SHA}" != "${APPLICATION_SHA}" ]; then',
            'if [ "${SERVED_SHA}" != "${OVERLAY_SHA}" ]; then',
        )
        violations = sha_provenance_violations(self.root)
        self.assertTrue(any("OVERLAY sha" in v for v in violations))
        # And behaviorally: the tick that used to be green is now red.
        run = execute_carrier(
            self.root,
            enabled=True,
            extra_env={"SOURCE_REPOSITORY_URL": "https://github.com/example/app"},
            health_body=json.dumps({"sha": STUB_SOURCE_SHA}),
        )
        self.assertNotEqual(0, run.returncode)

    def test_deriving_the_image_tag_from_the_overlay_sha_fails(self) -> None:
        self.mutate(
            CARRIER_SCRIPT,
            'RENDERED_IMAGE_TAG="${RENDERED_IMAGE_TAG//\\{sha\\}/${APPLICATION_SHA}}"',
            'RENDERED_IMAGE_TAG="${RENDERED_IMAGE_TAG//\\{sha\\}/${OVERLAY_SHA}}"',
        )
        violations = sha_provenance_violations(self.root)
        self.assertTrue(any("APPLICATION_SHA" in v for v in violations))

    def test_removing_source_resolution_fails(self) -> None:
        self.mutate(CARRIER_SCRIPT, "git ls-remote", "echo skip-resolution")
        violations = sha_provenance_violations(self.root)
        self.assertTrue(any("application-sha resolution" in v for v in violations))

    def test_cloning_the_application_repository_fails(self) -> None:
        self.mutate(
            CARRIER_SCRIPT,
            'APPLICATION_SHA="$(git ls-remote "${APPLICATION_REMOTE}"',
            'APPLICATION_SHA="$(git clone "${APPLICATION_REMOTE}"',
        )
        self.assertTrue(any("CLONED" in v for v in main_only_violations(self.root)))

    def test_dropping_short7_fails(self) -> None:
        # MassageIthaca publishes sha-<7hex>; a full-40-hex-only template
        # names an image that was never pushed.
        self.mutate(
            CARRIER_SCRIPT,
            'RENDERED_IMAGE_TAG="${RENDERED_IMAGE_TAG//\\{short7\\}/${APPLICATION_SHA:0:7}}"',
            'RENDERED_IMAGE_TAG="${RENDERED_IMAGE_TAG}"',
        )
        violations = sha_provenance_violations(self.root)
        self.assertTrue(any("short7" in v for v in violations))

    def test_dropping_var_file_support_fails(self) -> None:
        self.mutate(CARRIER_SCRIPT, '-var-file=', '-nope=')
        self.assertTrue(any("-var-file" in v for v in apply_surface_violations(self.root)))

    def test_dropping_override_support_fails(self) -> None:
        self.mutate(CARRIER_SCRIPT, "{digest}", "{nope}")
        self.assertTrue(
            any("{digest}" in v for v in apply_surface_violations(self.root))
        )


# ------------------------------------------------- the addendum's contract --
#
# docs/patterns/stateful-workload-convergence.md, "Machine-readable contract".
# Four terms are source-checkable and therefore contract-test material. Each
# gets a behavioral proof where behavior is the law, a source proof where shape
# is the law, and a mutation below that turns the proof red.


class ArmingGateTests(unittest.TestCase):
    """§10 — `armed` is a second boolean, unarmed by default, never collapsed."""

    def test_arming_gate_behaves(self) -> None:
        self.assertEqual([], arming_gate_behavior_violations(MODULE_ROOT))

    def test_absent_flag_halts_because_the_reviewed_default_is_unarmed(self) -> None:
        run = execute_carrier(MODULE_ROOT, enabled=True, workflow_state={"enabled": True})
        self.assertEqual(0, run.returncode)
        self.assertIn("halted=not-armed", run.stdout)
        self.assertEqual([], run.called("tofu"))

    def test_the_two_halts_are_distinguishable_in_history(self) -> None:
        unarmed = execute_carrier(
            MODULE_ROOT, enabled=True, workflow_state={"armed": False, "enabled": True}
        )
        killed = execute_carrier(
            MODULE_ROOT, enabled=False, workflow_state={"armed": True, "enabled": False}
        )
        self.assertIn("halted=not-armed", unarmed.stdout)
        self.assertIn("halted=reviewed-enabled-false", killed.stdout)
        self.assertNotIn("halted=not-armed", killed.stdout)
        self.assertNotIn("halted=reviewed-enabled-false", unarmed.stdout)

    def test_a_nested_arming_pointer_is_honoured(self) -> None:
        run = execute_carrier(
            MODULE_ROOT,
            enabled=True,
            extra_env={"ARMED_FLAG_POINTER": "/convergence/armed"},
            workflow_state={"convergence": {"armed": True}, "enabled": True},
        )
        self.assertNotIn("halted=not-armed", run.stdout)

    def test_malformed_arming_pointer_refuses_to_run(self) -> None:
        run = execute_carrier(
            MODULE_ROOT, enabled=True, extra_env={"ARMED_FLAG_POINTER": "armed"}
        )
        self.assertNotEqual(0, run.returncode)
        self.assertIn("ARMED_FLAG_POINTER", run.stderr)

    def test_the_module_forbids_aliasing_the_two_pointers(self) -> None:
        main = read(MODULE_ROOT, f"{TOFU_DIR}/main.tf")
        self.assertIn("var.armed_flag_pointer != var.enabled_flag_pointer", main)


class DestructivePlanTests(unittest.TestCase):
    """§4 — classify, then refuse; §7.2 rule 5 — ephemeral is standing."""

    def test_destructive_plan_behaves(self) -> None:
        self.assertEqual([], destructive_plan_behavior_violations(MODULE_ROOT))

    def test_a_replace_of_durable_data_halts_before_apply(self) -> None:
        run = execute_carrier(
            MODULE_ROOT,
            enabled=True,
            extra_env={"DURABLE_DATA_ADDRESSES": json.dumps([DURABLE_ADDRESS])},
            plan_json=DESTRUCTIVE_PLAN,
        )
        self.assertNotEqual(0, run.returncode)
        self.assertIn(f"halted=destructive-plan refused={DURABLE_ADDRESS}", run.stdout)
        self.assertEqual([], [c for c in run.calls if c.startswith("tofu apply")])

    def test_an_undeclared_address_is_not_the_carriers_business(self) -> None:
        # A destroy of something the tenant never declared durable is an
        # ordinary converge. §4 protects declared durable data, and the
        # tenant-side law is what stops the declaration from being empty.
        run = execute_carrier(
            MODULE_ROOT,
            enabled=True,
            extra_env={"DURABLE_DATA_ADDRESSES": json.dumps(["kubernetes_secret.other"])},
            plan_json=DESTRUCTIVE_PLAN,
        )
        self.assertEqual(0, run.returncode)

    def test_a_counted_instance_of_declared_durable_data_is_refused(self) -> None:
        # D1 (TIN-2030 adversarial verdict, 2026-08-07): the declaration carries
        # the base form, the count-gated plan emits `address[0]`, and an
        # exact-match classifier lets the replace through to apply. The WATCH is
        # base-normalized on both sides; the refusal receipt names the exact
        # planned address so the tenant can copy it into an admission.
        run = execute_carrier(
            MODULE_ROOT,
            enabled=True,
            extra_env={"DURABLE_DATA_ADDRESSES": json.dumps([DURABLE_ADDRESS])},
            plan_json=INDEXED_DESTRUCTIVE_PLAN,
        )
        self.assertNotEqual(0, run.returncode)
        self.assertIn(
            f"halted=destructive-plan refused={DURABLE_ADDRESS}[0]", run.stdout
        )
        self.assertEqual([], [c for c in run.calls if c.startswith("tofu apply")])

    def test_an_indexed_declaration_watches_its_counted_instance(self) -> None:
        run = execute_carrier(
            MODULE_ROOT,
            enabled=True,
            extra_env={
                "DURABLE_DATA_ADDRESSES": json.dumps([f"{DURABLE_ADDRESS}[0]"])
            },
            plan_json=INDEXED_DESTRUCTIVE_PLAN,
        )
        self.assertNotEqual(0, run.returncode)
        self.assertEqual([], [c for c in run.calls if c.startswith("tofu apply")])

    def test_an_exact_indexed_admission_unblocks_the_counted_instance(self) -> None:
        run = execute_carrier(
            MODULE_ROOT,
            enabled=True,
            extra_env={"DURABLE_DATA_ADDRESSES": json.dumps([DURABLE_ADDRESS])},
            plan_json=INDEXED_DESTRUCTIVE_PLAN,
            workflow_state={
                "armed": True,
                "enabled": True,
                "destroy_admission": {
                    "addresses": [f"{DURABLE_ADDRESS}[0]"],
                    "reason": "TIN-0000 reviewed storage-class migration",
                },
            },
        )
        self.assertEqual(0, run.returncode)
        self.assertIn(f"destroy_admitted={DURABLE_ADDRESS}[0]", run.stdout)
        self.assertTrue(any(c.startswith("tofu apply") for c in run.calls))

    def test_a_base_admission_does_not_unblock_a_counted_instance(self) -> None:
        # The watch is base-normalized (fail-closed, broad); the UNLOCK stays
        # exact (narrow). An admission names the address the refusal receipt
        # printed — never a base form that would blanket every instance.
        run = execute_carrier(
            MODULE_ROOT,
            enabled=True,
            extra_env={"DURABLE_DATA_ADDRESSES": json.dumps([DURABLE_ADDRESS])},
            plan_json=INDEXED_DESTRUCTIVE_PLAN,
            workflow_state={
                "armed": True,
                "enabled": True,
                "destroy_admission": {
                    "addresses": [DURABLE_ADDRESS],
                    "reason": "TIN-0000 base-form admission must not blanket instances",
                },
            },
        )
        self.assertNotEqual(0, run.returncode)
        self.assertEqual([], [c for c in run.calls if c.startswith("tofu apply")])

    def test_malformed_durable_address_set_refuses_to_run(self) -> None:
        run = execute_carrier(
            MODULE_ROOT, enabled=True, extra_env={"DURABLE_DATA_ADDRESSES": '"not-a-list"'}
        )
        self.assertNotEqual(0, run.returncode)
        self.assertIn("DURABLE_DATA_ADDRESSES", run.stderr)

    def test_non_boolean_ephemeral_refuses_to_run(self) -> None:
        run = execute_carrier(MODULE_ROOT, enabled=True, extra_env={"EPHEMERAL": "yes"})
        self.assertNotEqual(0, run.returncode)
        self.assertIn("EPHEMERAL", run.stderr)

    def test_the_module_forbids_an_ephemeral_production_stack(self) -> None:
        main = read(MODULE_ROOT, f"{TOFU_DIR}/main.tf")
        self.assertRegex(main, r"condition\s*=\s*!\(var\.ephemeral\s*&&")


# ------------------------------------------------------ the tenant contract --
#
# The shipped library (contract/tenant_contract.py) judged against a
# conforming tenant checkout, then one mutation per law. These are the laws
# that used to live in three places; this is now the only place they are
# proven, and the adopter's importer calls the same functions.


TENANT_CARRIER = {
    "stack_dir": "tofu/stacks/application",
    "carrier_source": "tofu/stacks/application/converge-agent.tf",
    "workflow_state_document": "config/workflow-state/production-converge.json",
    "state_key": "fixture/application/production.tfstate",
    "gate_variable": "enable_converge_agent",
    "durable_data_addresses": ["kubernetes_persistent_volume_claim.data"],
}

TENANT_CARRIER_TF = textwrap.dedent(
    """\
    module "converge_agent" {
      source = "./modules/converge_agent/tofu"

      enabled   = var.enable_converge_agent
      ephemeral = false

      tenant                = "fixture"
      namespace             = "fixture-production"
      overlay_repo_ssh      = "git@github.com:example/fixture-infra.git"
      application_image_tag = "ghcr.io/example/fixture:main"
      edge_health_url       = "https://www.fixture.example.com/api/health"
      rollout_target        = "deployment/fixture"
      carrier_image         = "ghcr.io/example-publisher/converge-agent@sha256:0"

      carrier_liveness_alert_ref = "grafana-alert:fixture-converge-agent-liveness"

      durable_data_addresses = ["kubernetes_persistent_volume_claim.data"]

      state_backend = {
        bucket   = "tofu-state"
        key      = "fixture/application/production.tfstate"
        region   = "us-east-1"
        endpoint = "https://state.internal.example"
      }
    }
    """
)

TENANT_DATA_TF = textwrap.dedent(
    """\
    resource "kubernetes_persistent_volume_claim" "data" {
      metadata {
        name      = "fixture-data"
        namespace = "fixture-production"
      }

      spec {
        access_modes = ["ReadWriteOnce"]
        resources {
          requests = {
            storage = "10Gi"
          }
        }
      }

      lifecycle {
        prevent_destroy = true
      }
    }
    """
)

TENANT_VARIABLES_TF = textwrap.dedent(
    """\
    variable "enable_converge_agent" {
      description = "Inert gate: the carrier composes only after the reviewed activation ceremony."
      type        = bool
      default     = false
    }
    """
)

TENANT_DOCUMENT = {"armed": False, "enabled": True}


def build_tenant_checkout(root: Path) -> None:
    """A conforming tenant: one instantiation, durable data guarded, both
    flags declared, no bespoke loop, no workflow reaching the stack."""

    stack = root / TENANT_CARRIER["stack_dir"]
    stack.mkdir(parents=True, exist_ok=True)
    (root / TENANT_CARRIER["carrier_source"]).write_text(TENANT_CARRIER_TF, encoding="utf-8")
    (stack / "data.tf").write_text(TENANT_DATA_TF, encoding="utf-8")
    (stack / "variables.tf").write_text(TENANT_VARIABLES_TF, encoding="utf-8")
    document = root / TENANT_CARRIER["workflow_state_document"]
    document.parent.mkdir(parents=True, exist_ok=True)
    document.write_text(json.dumps(TENANT_DOCUMENT, indent=2) + "\n", encoding="utf-8")
    workflows = root / ".github" / "workflows"
    workflows.mkdir(parents=True, exist_ok=True)
    (workflows / "ci.yml").write_text(
        "jobs:\n  test:\n    steps:\n      - run: echo unit tests only\n", encoding="utf-8"
    )


class TenantContractTests(unittest.TestCase):
    def setUp(self) -> None:
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        build_tenant_checkout(self.root)
        self.carrier = dict(TENANT_CARRIER)

    def write_document(self, document: dict) -> None:
        (self.root / self.carrier["workflow_state_document"]).write_text(
            json.dumps(document, indent=2) + "\n", encoding="utf-8"
        )

    def mutate(self, relative: str, old: str, new: str) -> None:
        path = self.root / relative
        text = path.read_text(encoding="utf-8")
        self.assertIn(old, text, f"mutation anchor not found in {relative}: {old!r}")
        path.write_text(text.replace(old, new), encoding="utf-8")

    def test_conforming_tenant_passes(self) -> None:
        self.assertEqual([], tenant_contract.tenant_violations(self.root, self.carrier))

    # ---- law 1: one carrier, inside the stack it converges -----------------

    def test_carrier_outside_the_stack_fails(self) -> None:
        outside = self.root / "deploy" / "converge-agent.tf"
        outside.parent.mkdir(parents=True, exist_ok=True)
        outside.write_text(TENANT_CARRIER_TF, encoding="utf-8")
        self.carrier["carrier_source"] = "deploy/converge-agent.tf"
        self.assertTrue(
            tenant_contract.carrier_inside_stack_violations(self.root, self.carrier)
        )

    def test_a_second_instantiation_fails(self) -> None:
        path = self.root / self.carrier["carrier_source"]
        path.write_text(
            path.read_text(encoding="utf-8")
            + TENANT_CARRIER_TF.replace('module "converge_agent"', 'module "converge_agent_two"'),
            encoding="utf-8",
        )
        self.assertTrue(
            tenant_contract.carrier_inside_stack_violations(self.root, self.carrier)
        )

    def test_commented_instantiation_is_not_a_carrier(self) -> None:
        path = self.root / self.carrier["carrier_source"]
        path.write_text(
            path.read_text(encoding="utf-8")
            + "\n# module \"converge_agent_old\" {\n#   source = \"...converge_agent...\"\n# }\n",
            encoding="utf-8",
        )
        self.assertEqual(
            [], tenant_contract.carrier_inside_stack_violations(self.root, self.carrier)
        )

    # ---- law 2: no bespoke loop --------------------------------------------

    def test_a_hand_written_cronjob_resource_fails(self) -> None:
        (self.root / self.carrier["stack_dir"] / "bespoke.tf").write_text(
            'resource "kubernetes_cron_job_v1" "mine" {\n  metadata {}\n}\n',
            encoding="utf-8",
        )
        self.assertTrue(
            tenant_contract.no_bespoke_loop_violations(self.root, self.carrier)
        )

    def test_a_raw_cronjob_manifest_in_the_stack_fails(self) -> None:
        (self.root / self.carrier["stack_dir"] / "carrier.yaml").write_text(
            "apiVersion: batch/v1\nkind: CronJob\nmetadata:\n  name: mine\n",
            encoding="utf-8",
        )
        self.assertTrue(
            tenant_contract.no_bespoke_loop_violations(self.root, self.carrier)
        )

    def test_a_trigger_on_the_instantiation_fails(self) -> None:
        self.mutate(
            self.carrier["carrier_source"],
            'module "converge_agent" {',
            'module "converge_agent" {\n  # workflow_dispatch\n  trigger = "workflow_dispatch"',
        )
        self.assertTrue(
            tenant_contract.no_bespoke_loop_violations(self.root, self.carrier)
        )

    # ---- law 3: no workflow reach ------------------------------------------

    def test_a_workflow_naming_the_stack_fails(self) -> None:
        (self.root / ".github/workflows/converge.yml").write_text(
            "jobs:\n  go:\n    steps:\n      - run: just converge\n"
            f"        working-directory: {self.carrier['stack_dir']}\n",
            encoding="utf-8",
        )
        self.assertTrue(tenant_contract.workflow_reach_violations(self.root, self.carrier))

    def test_a_workflow_naming_the_state_key_fails(self) -> None:
        (self.root / ".github/workflows/peek.yml").write_text(
            "jobs:\n  go:\n    steps:\n"
            f"      - run: tofu init -backend-config=key={self.carrier['state_key']}\n",
            encoding="utf-8",
        )
        self.assertTrue(tenant_contract.workflow_reach_violations(self.root, self.carrier))

    def test_commented_workflow_prose_passes(self) -> None:
        (self.root / ".github/workflows/notes.yml").write_text(
            f"# the old carrier applied {self.carrier['stack_dir']}\n"
            f"# state lived at {self.carrier['state_key']}\n"
            "jobs:\n  go:\n    steps:\n      - run: echo ok\n",
            encoding="utf-8",
        )
        self.assertEqual([], tenant_contract.workflow_reach_violations(self.root, self.carrier))

    # ---- law 4: the kill switch --------------------------------------------

    def test_non_boolean_enabled_fails(self) -> None:
        self.write_document({"armed": False, "enabled": "yes"})
        self.assertTrue(
            tenant_contract.kill_switch_document_violations(self.root, self.carrier)
        )

    def test_a_duplicated_flag_key_fails(self) -> None:
        (self.root / self.carrier["workflow_state_document"]).write_text(
            '{"armed": false, "enabled": true, "enabled": false}\n', encoding="utf-8"
        )
        self.assertTrue(
            tenant_contract.kill_switch_document_violations(self.root, self.carrier)
        )

    # ---- law 5: the arming gate (addendum contract item 3) -----------------

    def test_missing_armed_flag_fails(self) -> None:
        self.write_document({"enabled": True})
        self.assertTrue(tenant_contract.arming_gate_violations(self.root, self.carrier))

    def test_non_boolean_armed_flag_fails(self) -> None:
        self.write_document({"armed": "no", "enabled": True})
        self.assertTrue(tenant_contract.arming_gate_violations(self.root, self.carrier))

    def test_collapsing_the_two_flags_into_one_fails(self) -> None:
        # The collapse §10 forbids: one key doing both jobs.
        self.write_document({"armed": True})
        self.assertTrue(tenant_contract.arming_gate_violations(self.root, self.carrier))

    def test_an_armed_tenant_still_passes(self) -> None:
        # A check demanding `armed: false` forever would forbid the very
        # ceremony the law exists to require.
        self.write_document({"armed": True, "enabled": True})
        self.assertEqual([], tenant_contract.arming_gate_violations(self.root, self.carrier))

    # ---- law 6: the destroy admission (addendum contract item 4) -----------

    def test_absent_admission_is_the_normal_value(self) -> None:
        self.assertEqual(
            [], tenant_contract.destroy_admission_violations(self.root, self.carrier)
        )

    def test_a_wildcard_admission_fails(self) -> None:
        for address in ("*", "kubernetes_persistent_volume_claim.*", "all", "module.data.*"):
            with self.subTest(address=address):
                self.write_document(
                    {
                        "armed": True,
                        "enabled": True,
                        "destroy_admission": {"addresses": [address], "reason": "because"},
                    }
                )
                self.assertTrue(
                    tenant_contract.destroy_admission_violations(self.root, self.carrier),
                    f"{address!r} was accepted as an admission",
                )

    def test_a_bare_type_prefix_admission_fails(self) -> None:
        self.write_document(
            {
                "armed": True,
                "enabled": True,
                "destroy_admission": {
                    "addresses": ["kubernetes_persistent_volume_claim"],
                    "reason": "because",
                },
            }
        )
        self.assertTrue(
            tenant_contract.destroy_admission_violations(self.root, self.carrier)
        )

    def test_an_admission_without_a_reason_fails(self) -> None:
        self.write_document(
            {
                "armed": True,
                "enabled": True,
                "destroy_admission": {"addresses": ["kubernetes_persistent_volume_claim.data"]},
            }
        )
        self.assertTrue(
            tenant_contract.destroy_admission_violations(self.root, self.carrier)
        )

    def test_an_empty_admission_list_fails(self) -> None:
        self.write_document(
            {
                "armed": True,
                "enabled": True,
                "destroy_admission": {"addresses": [], "reason": "because"},
            }
        )
        self.assertTrue(
            tenant_contract.destroy_admission_violations(self.root, self.carrier)
        )

    def test_an_enumerated_admission_with_a_reason_passes(self) -> None:
        for address in (
            "kubernetes_persistent_volume_claim.data",
            "kubernetes_persistent_volume_claim.data[0]",
            'module.storage.kubernetes_persistent_volume_claim.data["a"]',
        ):
            with self.subTest(address=address):
                self.write_document(
                    {
                        "armed": True,
                        "enabled": True,
                        "destroy_admission": {
                            "addresses": [address],
                            "reason": "TIN-0000 reviewed storage-class migration",
                        },
                    }
                )
                self.assertEqual(
                    [],
                    tenant_contract.destroy_admission_violations(self.root, self.carrier),
                )

    # ---- law 7: ephemeral (addendum contract item 2) -----------------------

    def test_undeclared_ephemeral_fails(self) -> None:
        self.mutate(self.carrier["carrier_source"], "  ephemeral = false\n", "")
        self.assertTrue(
            tenant_contract.ephemeral_declaration_violations(self.root, self.carrier)
        )

    def test_an_ephemeral_production_stack_fails(self) -> None:
        self.mutate(self.carrier["carrier_source"], "ephemeral = false", "ephemeral = true")
        self.assertTrue(
            tenant_contract.ephemeral_declaration_violations(self.root, self.carrier)
        )

    def test_an_ephemeral_pr_stack_passes(self) -> None:
        self.mutate(self.carrier["carrier_source"], "ephemeral = false", "ephemeral = true")
        self.carrier["state_key"] = "fixture/application/pr-1234.tfstate"
        self.assertEqual(
            [], tenant_contract.ephemeral_declaration_violations(self.root, self.carrier)
        )

    # ---- law 8: prevent_destroy (addendum contract item 1) -----------------

    def test_durable_data_without_prevent_destroy_fails(self) -> None:
        self.mutate(
            f"{self.carrier['stack_dir']}/data.tf",
            "  lifecycle {\n    prevent_destroy = true\n  }\n",
            "",
        )
        self.assertTrue(
            tenant_contract.prevent_destroy_violations(self.root, self.carrier)
        )

    def test_prevent_destroy_set_to_false_fails(self) -> None:
        self.mutate(
            f"{self.carrier['stack_dir']}/data.tf",
            "prevent_destroy = true",
            "prevent_destroy = false",
        )
        self.assertTrue(
            tenant_contract.prevent_destroy_violations(self.root, self.carrier)
        )

    def test_declaring_no_durable_data_while_holding_some_fails(self) -> None:
        # The evasion the second half of law 8 exists to close: a stack with a
        # PVC in it that tells the carrier it owns nothing.
        self.carrier["durable_data_addresses"] = []
        violations = tenant_contract.prevent_destroy_violations(self.root, self.carrier)
        self.assertTrue(any("durable_data_addresses" in v for v in violations))

    def test_a_durable_address_naming_nothing_fails(self) -> None:
        self.carrier["durable_data_addresses"] = [
            "kubernetes_persistent_volume_claim.data",
            "kubernetes_persistent_volume_claim.ghost",
        ]
        violations = tenant_contract.prevent_destroy_violations(self.root, self.carrier)
        self.assertTrue(any("ghost" in v for v in violations))

    def test_a_stateless_tenant_declaring_nothing_passes(self) -> None:
        (self.root / self.carrier["stack_dir"] / "data.tf").unlink()
        self.mutate(
            self.carrier["carrier_source"],
            '  durable_data_addresses = ["kubernetes_persistent_volume_claim.data"]\n',
            "",
        )
        self.carrier["durable_data_addresses"] = []
        self.assertEqual(
            [], tenant_contract.prevent_destroy_violations(self.root, self.carrier)
        )

    # ---- law 9: the call-site inert gate -----------------------------------

    def test_unwiring_the_call_site_gate_fails(self) -> None:
        self.mutate(
            self.carrier["carrier_source"],
            "enabled   = var.enable_converge_agent",
            "enabled   = true",
        )
        self.assertTrue(tenant_contract.call_site_gate_violations(self.root, self.carrier))

    def test_a_call_site_gate_defaulting_true_fails(self) -> None:
        self.mutate(
            f"{self.carrier['stack_dir']}/variables.tf", "default     = false", "default     = true"
        )
        self.assertTrue(tenant_contract.call_site_gate_violations(self.root, self.carrier))

    def test_an_ungated_tenant_declares_no_gate_variable(self) -> None:
        self.carrier["gate_variable"] = ""
        self.assertEqual([], tenant_contract.call_site_gate_violations(self.root, self.carrier))


class ConsolidationTests(unittest.TestCase):
    """One loop body, one copy of each law — enforced, not asserted.

    The estate reached three copies of one contract, and the copies disagreed:
    the scaffold template returned NO violations for a loop that hard-coded
    `jq -r .sha` and compared the served sha to the OVERLAY clone's HEAD. These
    tests are what stops a fourth copy from appearing quietly.
    """

    def scaffold_root(self) -> Path | None:
        candidate = MODULE_ROOT.parent.parent
        return candidate if (candidate / "docs" / "patterns").is_dir() else None

    def test_the_package_ships_the_tenant_law_library(self) -> None:
        self.assertTrue((MODULE_ROOT / "contract" / "tenant_contract.py").is_file())
        build = read(MODULE_ROOT, "BUILD.bazel")
        self.assertIn("contract/tenant_contract.py", build)
        self.assertIn(":tenant_contract", build)

    def test_exactly_one_loop_body_ships_in_the_package(self) -> None:
        loops = sorted(p.name for p in (MODULE_ROOT / "carrier").glob("*"))
        self.assertEqual(["converge-agent.sh"], loops)

    def test_the_adopter_template_is_an_importer_not_a_copy(self) -> None:
        root = self.scaffold_root()
        if root is None:
            self.skipTest("module is materialized outside the scaffold checkout")
        template = read(root, "scripts/test-converge-agent-contract.example.py")
        self.assertTrue(template, "adopter template is missing")
        self.assertIn("import tenant_contract", template)
        for forked in (
            "def carrier_inside_stack_violations",
            "def workflow_reach_violations",
            "def digest_not_tag_violations",
            "def edge_assert_violations",
            "def enabled_flag_read_violations",
        ):
            self.assertNotIn(
                forked,
                template,
                f"the adopter template reimplements {forked!r} — that is a"
                " forked law with a tenant's name on it; call the shipped"
                " library instead",
            )

    def test_no_second_loop_body_ships_as_documentation(self) -> None:
        root = self.scaffold_root()
        if root is None:
            self.skipTest("module is materialized outside the scaffold checkout")
        # The deleted illustrative manifest carried an inline loop that
        # hard-coded `jq -r .sha` and compared the served sha to the overlay
        # HEAD — a second loop body that had gone stale against the real one.
        for path in sorted((root / "docs").rglob("*.y*ml")):
            body = path.read_text(encoding="utf-8")
            if CRONJOB_KIND.search(body) and "crane digest" in body:
                self.fail(
                    f"{path.relative_to(root)}: a documentation manifest carries"
                    " an executable loop — that is a second loop body, and the"
                    " last one certified the defects the module had to fix"
                )


class TofuPreconditionCoverageTests(unittest.TestCase):
    """The D1 seam preconditions are judged by the REAL parser, not prose:
    tofu/tests/preconditions.tftest.hcl carries the valid/invalid matrix
    (mocked kubernetes provider, plan-only) and CI's carrier-module-tofu
    gate executes it with the nix devshell's opentofu. The condition LOGIC
    is opentofu's to judge — this class only pins that the coverage exists
    and stays wired, so it cannot quietly become an advertised-but-missing
    guard."""

    TFTEST = "tofu/tests/preconditions.tftest.hcl"

    def setUp(self) -> None:
        candidate = MODULE_ROOT.parent.parent
        if not (candidate / "docs" / "patterns").is_dir():
            self.skipTest(
                "native-tofu coverage pin runs from the module's home"
                " checkout; a Bazel-materialized module_srcs tree ships no"
                " tests"
            )
        self.scaffold = candidate

    def tftest_body(self) -> str:
        body = read(MODULE_ROOT, self.TFTEST)
        self.assertTrue(
            body,
            f"{self.TFTEST} is gone — the D1 precondition matrix has lost"
            " its native-parser coverage",
        )
        return body

    def test_each_seam_condition_has_a_refusal_run(self) -> None:
        body = self.tftest_body()
        for run_name in (
            # D1 condition 1: a second key with no source repository.
            "seam_without_source_repository_refused",
            # D1 condition 2: a second key against an https remote.
            "seam_with_https_source_refused",
            # D1 condition 3: both key paths sharing one mount directory.
            "seam_sharing_the_overlay_mount_refused",
        ):
            self.assertIn(
                f'run "{run_name}"',
                body,
                f"{self.TFTEST}: refusal run {run_name} is missing — one of"
                " the three D1 precondition conditions has lost its"
                " invalid-input row",
            )
        self.assertIn(
            "kubernetes_manifest.converge_agent",
            body,
            f"{self.TFTEST}: no expect_failures against the carrier resource"
            " — the refusal rows are not asserting the preconditions",
        )

    def test_valid_shapes_keep_planning_clean(self) -> None:
        body = self.tftest_body()
        for run_name in (
            "dormant_seam_plans_clean",
            "dormant_seam_with_https_source_plans_clean",
            "active_seam_with_scp_style_source_plans_clean",
            "active_seam_with_ssh_scheme_source_plans_clean",
        ):
            self.assertIn(
                f'run "{run_name}"',
                body,
                f"{self.TFTEST}: valid row {run_name} is missing — refusals"
                " without green rows prove nothing about the conditions'"
                " scoping",
            )

    def test_ci_executes_the_native_tests(self) -> None:
        ci = (self.scaffold / ".github" / "workflows" / "ci.yml").read_text(
            encoding="utf-8"
        )
        for needle in ("carrier-module-tofu", "tofu test", "tofu validate", "tofu fmt -check"):
            self.assertIn(
                needle,
                ci,
                f"ci.yml no longer carries {needle!r} — the native tofu"
                " coverage has lost its CI producer and is an advertised"
                " guard again",
            )


if __name__ == "__main__":
    unittest.main()
