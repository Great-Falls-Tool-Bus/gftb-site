#!/usr/bin/env python3
"""Tenant-side contract laws for a converge-agent instantiation — the ONE copy.

This library ships WITH the module (BUILD.bazel `module_srcs`), so a tenant
that materializes the module also materializes the checkers that judge its own
declarations. It exists because the estate grew three copies of one law:

  A  site.scaffold  scripts/test-converge-agent-contract.example.py   (template)
  B  MMS            scripts/test-tofu-agent-carrier-contract.py       (merged)
  C  this package   tests/test_converge_agent_contract.py             (module)

and the copies had already diverged into disagreement. Copy A returned NO
violations for a loop body that hard-codes `jq -r .sha` and compares the served
sha to `git rev-parse HEAD` of the OVERLAY clone — the two fatals C now forbids
by name. Three tests for one law is not redundancy, it is three answers to one
question, and the stalest answer is the one that certifies the defect.

The split this library establishes:

  * LOOP-BODY laws belong to the module and live in C — digest-not-tag,
    edge-assert shape, kill-switch ordering, two-locks, no-trigger-surface.
    A tenant does not re-verify properties of a loop it did not write, and
    doctrine (addendum §2, §11) forbids it from writing one.
  * TENANT-DECLARATION laws live HERE and are called from both C (against
    fixtures, with mutation proofs) and from the adopter's copy of A (against
    the adopter's real checkout). One implementation, two call sites.

Text-level checks only: no YAML/HCL parser dependency, no cluster access.
Source properties are pinned here; runtime truth stays in receipts.

Contract statement (reference, never duplicate):
  docs/patterns/converge-agent.md
  docs/patterns/stateful-workload-convergence.md   §3, §4, §7.2, §10, §11
  docs/patterns/production-convergence.md          §3, §5
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any, Mapping

__all__ = [
    "CARRIER_TEMPLATE",
    "DuplicateKeyError",
    "tenant_violations",
    "carrier_inside_stack_violations",
    "no_bespoke_loop_violations",
    "workflow_reach_violations",
    "kill_switch_document_violations",
    "arming_gate_violations",
    "destroy_admission_violations",
    "ephemeral_declaration_violations",
    "prevent_destroy_violations",
    "call_site_gate_violations",
]


# The adopter-edited block. An adopting repository copies the importer
# (scripts/test-converge-agent-contract.example.py), edits ONLY a dict of this
# shape, and never copies a checker.
CARRIER_TEMPLATE: dict[str, Any] = {
    # Repo-relative directory of the tofu stack the carrier converges.
    "stack_dir": "tofu/stacks/application",
    # Repo-relative HCL file declaring the module instantiation. Must live
    # under stack_dir: a carrier outside the state it applies can be disabled
    # without a diff.
    "carrier_source": "tofu/stacks/application/converge-agent.tf",
    # The reviewed checked-in document carrying `enabled`, `armed`, and any
    # `destroy_admission`.
    "workflow_state_document": "config/workflow-state/production-converge.json",
    # The production state key exactly as the backend configuration declares it.
    "state_key": "example-application/application/production.tfstate",
    # Call-site inert-gate variable, or "" if the instantiation is ungated.
    "gate_variable": "",
    # Durable-data resource addresses inside the stack (addendum §3). Must
    # match the module's durable_data_addresses input exactly.
    "durable_data_addresses": [],
}

COMMENT = re.compile(r"(?m)(?<!\S)#.*$")
DISPATCH_TRIGGER = re.compile(r"workflow_dispatch|repository_dispatch|workflow_call")
PUSH_TRIGGER = re.compile(r"^\s*push\s*:", re.MULTILINE)
CRONJOB_KIND = re.compile(r"^\s*kind:\s*CronJob\s*$", re.MULTILINE)
CRONJOB_RESOURCE = re.compile(r'^\s*resource\s+"kubernetes_cron_job(_v1)?"', re.MULTILINE)
MODULE_BLOCK = re.compile(r'(?m)^\s*module\s+"[^"]+"\s*\{')
MODULE_SOURCE = re.compile(r"converge[_-]agent")
EPHEMERAL_DECLARED = re.compile(r"(?m)^\s*ephemeral\s*=\s*(true|false)\s*$")
PRODUCTION_STATE_KEY = re.compile(r"/production\.tfstate$")

# A durable-data resource type whose destruction is unrecoverable. This list is
# a FLOOR, not a closure: it exists so that a stack containing an obvious
# durable resource cannot declare `durable_data_addresses = []` and pass. A
# type absent from this list is not thereby safe — it is merely not caught here.
DURABLE_DATA_TYPES = (
    "kubernetes_persistent_volume_claim",
    "kubernetes_persistent_volume_claim_v1",
    "kubernetes_persistent_volume",
    "kubernetes_persistent_volume_v1",
    "kubernetes_stateful_set",
    "kubernetes_stateful_set_v1",
)

# `all`, a bare type, a module prefix, or anything carrying a glob is the rule
# deleted rather than an admission (addendum §4).
ADMISSION_ADDRESS = re.compile(
    r"^(?:module\.[A-Za-z_][\w-]*(?:\[[^\]]+\])?\.)*"
    r"[a-z][a-z0-9_]*\.[A-Za-z_][\w-]*(?:\[[^\]]+\])?$"
)


class DuplicateKeyError(ValueError):
    """A repeated key in the reviewed document: one of the two is unread."""


def _reject_duplicate_keys(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    seen: dict[str, Any] = {}
    for key, value in pairs:
        if key in seen:
            raise DuplicateKeyError(
                f"duplicate key {key!r} — json.loads keeps the last one, a"
                " reviewer reads the first, and the flag that decides whether"
                " a carrier runs is not a place for that ambiguity"
            )
        seen[key] = value
    return seen


def read(root: Path, relative: str) -> str:
    path = root / relative
    return path.read_text(encoding="utf-8") if path.is_file() else ""


def uncommented(text: str) -> str:
    """Prose about a banned literal is not the banned literal."""

    return COMMENT.sub("", text)


def _document(root: Path, carrier: Mapping[str, Any]) -> tuple[dict | None, list[str]]:
    relative = carrier["workflow_state_document"]
    if not (root / relative).is_file():
        return None, [f"{relative}: reviewed workflow-state document is missing"]
    try:
        parsed = json.loads(read(root, relative), object_pairs_hook=_reject_duplicate_keys)
    except (DuplicateKeyError, json.JSONDecodeError) as error:
        return None, [f"{relative}: {error}"]
    if not isinstance(parsed, dict):
        return None, [f"{relative}: reviewed document must be a JSON object"]
    return parsed, []


def _stack_sources(root: Path, carrier: Mapping[str, Any]) -> dict[str, str]:
    stack = root / carrier["stack_dir"]
    if not stack.is_dir():
        return {}
    return {
        str(path.relative_to(root)): path.read_text(encoding="utf-8")
        for path in sorted(stack.rglob("*.tf"))
    }


def _resource_block(sources: Mapping[str, str], type_name: str, name: str) -> str | None:
    opener = re.compile(
        r'(?m)^\s*resource\s+"' + re.escape(type_name) + r'"\s+"' + re.escape(name) + r'"\s*\{'
    )
    for text in sources.values():
        match = opener.search(text)
        if not match:
            continue
        depth = 0
        for index in range(match.end() - 1, len(text)):
            if text[index] == "{":
                depth += 1
            elif text[index] == "}":
                depth -= 1
                if depth == 0:
                    return text[match.start() : index + 1]
    return None


# ------------------------------------------------------------------ law 1 ---
def carrier_inside_stack_violations(root: Path, carrier: Mapping[str, Any]) -> list[str]:
    """One carrier, declared inside the state it applies (§1, §3)."""

    source = carrier["carrier_source"]
    stack = carrier["stack_dir"].rstrip("/") + "/"
    violations: list[str] = []
    if not source.startswith(stack):
        violations.append(
            f"{source}: the carrier is declared outside the stack it converges"
            f" ({stack}); a carrier outside its own state can be disabled"
            " without a diff"
        )
    if not (root / source).is_file():
        violations.append(f"{source}: declared carrier source is missing")
        return violations
    text = uncommented(read(root, source))
    blocks = [
        block
        for block in MODULE_BLOCK.finditer(text)
        if MODULE_SOURCE.search(text[block.start() : block.start() + 800])
    ]
    if len(blocks) != 1:
        violations.append(
            f"{source}: {len(blocks)} converge-agent instantiations declared —"
            " exactly one carrier converges one stack; two authorities is none"
        )
    return violations


# ------------------------------------------------------------------ law 2 ---
def no_bespoke_loop_violations(root: Path, carrier: Mapping[str, Any]) -> list[str]:
    """The loop body is INGESTED, never authored here (addendum §2, §11).

    This inverts what the pre-module template checked. The old template
    verified that a hand-written CronJob's inline loop had a digest step and an
    edge assert — a check that only makes sense in a world where a tenant
    writes its own loop, which doctrine forbids. The tenant-side law is that no
    such loop exists.
    """

    violations: list[str] = []
    for relative, text in _stack_sources(root, carrier).items():
        if relative == carrier["carrier_source"]:
            continue
        if CRONJOB_RESOURCE.search(uncommented(text)):
            violations.append(
                f"{relative}: a CronJob resource is authored inside the stack"
                " beside the instantiation — the serving loop rides the"
                " published module; a second one is a per-tenant fork of the"
                " loop body wearing the first one's name"
            )
    stack = root / carrier["stack_dir"]
    if stack.is_dir():
        for path in sorted(stack.rglob("*.y*ml")):
            if CRONJOB_KIND.search(uncommented(path.read_text(encoding="utf-8"))):
                violations.append(
                    f"{path.relative_to(root)}: a raw CronJob manifest sits in"
                    " the converged stack — that is a second carrier"
                )
    interface = uncommented(read(root, carrier["carrier_source"]))
    if DISPATCH_TRIGGER.search(interface) or PUSH_TRIGGER.search(interface):
        violations.append(
            f"{carrier['carrier_source']}: the instantiation carries an"
            " external trigger surface; the carrier pulls on its schedule and"
            " nothing fires it"
        )
    return violations


# ------------------------------------------------------------------ law 3 ---
def workflow_reach_violations(root: Path, carrier: Mapping[str, Any]) -> list[str]:
    """Verb-blind: naming the stack or its state key IS the reach (§3).

    An apply-verb pin is evaded by indirection — a workflow running
    `just production-converge` carries no apply verb at all. But to reach the
    stack from CI the workflow text still has to name the stack directory or
    the production state key somewhere the static layer can see. The class that
    names neither is bounded by state-credential custody, not by this file.
    """

    violations: list[str] = []
    workflows = root / ".github" / "workflows"
    if not workflows.is_dir():
        return violations
    needles = [carrier["stack_dir"], carrier["state_key"]]
    for path in sorted(workflows.rglob("*.y*ml")):
        body = uncommented(path.read_text(encoding="utf-8"))
        for needle in needles:
            if needle and needle in body:
                violations.append(
                    f"{path.relative_to(root)}: workflow references the carried"
                    f" stack ({needle}) — regardless of verb, that is a second"
                    " carrier surface, therefore none"
                )
    return violations


# ------------------------------------------------------------------ law 4 ---
def kill_switch_document_violations(root: Path, carrier: Mapping[str, Any]) -> list[str]:
    """The reviewed `enabled` flag exists and is a boolean (§2.2, §5)."""

    document, violations = _document(root, carrier)
    if document is None:
        return violations
    if not isinstance(document.get("enabled"), bool):
        violations.append(
            f"{carrier['workflow_state_document']}: `enabled` must exist and be"
            " a boolean — a truthy string is a kill switch nobody can flip"
            " with confidence"
        )
    return violations


# ------------------------------------------------------------------ law 5 ---
def arming_gate_violations(root: Path, carrier: Mapping[str, Any]) -> list[str]:
    """Addendum §10 — `armed` is a SECOND boolean, never the kill switch.

    Machine-readable contract: "the workflow-state document carries a boolean
    `armed` whose checked-in default is `false`, distinct from `enabled`."

    Distinctness is enforced as a key law, not a value law: a tenant that has
    completed its arming ceremony legitimately carries `armed: true`, and a
    check demanding false forever would forbid the ceremony it exists to
    require. The "default is false" half is enforced where defaults live — the
    module halts when the flag is ABSENT (fail-closed), proven by execution in
    the module suite, and the module's two pointers are preconditioned apart so
    the flags cannot be aliased onto one key.
    """

    document, violations = _document(root, carrier)
    if document is None:
        return violations
    relative = carrier["workflow_state_document"]
    if "armed" not in document:
        violations.append(
            f"{relative}: no `armed` flag — the arming gate is REQUIRED for a"
            " converge carrier (addendum §10), and its absence means a first"
            " run whose plan nobody saw"
        )
        return violations
    if not isinstance(document["armed"], bool):
        violations.append(f"{relative}: `armed` must be a boolean")
    if "enabled" not in document:
        violations.append(
            f"{relative}: `armed` is present but `enabled` is not — the two"
            " flags are complements, and one of them alone cannot express both"
            " 'never started' and 'stop what is running'"
        )
    return violations


# ------------------------------------------------------------------ law 6 ---
def destroy_admission_violations(root: Path, carrier: Mapping[str, Any]) -> list[str]:
    """Addendum §4 — an admission enumerates addresses and carries a reason.

    "An admission naming a class rather than addresses is not an admission, it
    is the rule deleted, and the contract test fails it."
    """

    document, violations = _document(root, carrier)
    if document is None:
        return violations
    relative = carrier["workflow_state_document"]
    admission = document.get("destroy_admission")
    if admission is None:
        return violations  # absent is the normal, expected value
    if not isinstance(admission, dict):
        return [
            f"{relative}: destroy_admission must be an object with `addresses`"
            " and `reason`"
        ]
    addresses = admission.get("addresses")
    if not isinstance(addresses, list) or not addresses:
        violations.append(
            f"{relative}: destroy_admission.addresses must be a non-empty list"
            " of exact resource addresses"
        )
    else:
        for address in addresses:
            if not isinstance(address, str) or not ADMISSION_ADDRESS.match(address):
                violations.append(
                    f"{relative}: destroy_admission address {address!r} is not"
                    " an exact resource address — a wildcard, a bare type, or"
                    " `all` is the rule deleted, not an admission"
                )
    reason = admission.get("reason")
    if not isinstance(reason, str) or not reason.strip():
        violations.append(
            f"{relative}: destroy_admission.reason is required — an admission"
            " with no stated reason is an unreviewable destroy"
        )
    return violations


# ------------------------------------------------------------------ law 7 ---
def ephemeral_declaration_violations(root: Path, carrier: Mapping[str, Any]) -> list[str]:
    """Addendum §7.2 rule 5 — declared once, and production declares false."""

    source = carrier["carrier_source"]
    text = uncommented(read(root, source))
    violations: list[str] = []
    declared = EPHEMERAL_DECLARED.search(text)
    if not declared:
        violations.append(
            f"{source}: the instantiation does not declare `ephemeral` — one"
            " boolean, declared at birth, decides whether reaping this stack's"
            " durable data is a lifecycle or an incident, and leaving it"
            " implicit decides it by accident"
        )
        return violations
    if declared.group(1) == "true" and PRODUCTION_STATE_KEY.search(carrier["state_key"]):
        violations.append(
            f"{source}: `ephemeral = true` on a production state key"
            f" ({carrier['state_key']}) — that is the STANDING admission to"
            " destroy this stack's durable data, and a production stack can"
            " never carry it"
        )
    return violations


# ------------------------------------------------------------------ law 8 ---
def prevent_destroy_violations(root: Path, carrier: Mapping[str, Any]) -> list[str]:
    """Addendum §3 — every durable-data resource carries `prevent_destroy` in
    the stack that declares it, and every durable-data resource IN the stack is
    declared to the carrier.

    The second half is what makes the first half more than paperwork: without
    it, a tenant with a PVC in its stack passes by declaring
    `durable_data_addresses = []`, and the §4 classifier then has nothing to
    protect.
    """

    sources = _stack_sources(root, carrier)
    declared = list(carrier.get("durable_data_addresses") or [])
    violations: list[str] = []

    for address in declared:
        bare = re.sub(r"\[[^\]]+\]$", "", address)
        segments = bare.split(".")
        if len(segments) < 2:
            violations.append(
                f"{carrier['carrier_source']}: durable-data address {address!r}"
                " is not a resource address"
            )
            continue
        type_name, name = segments[-2], segments[-1]
        block = _resource_block(sources, type_name, name)
        if block is None:
            violations.append(
                f"{carrier['carrier_source']}: durable-data address {address!r}"
                f" names no resource in {carrier['stack_dir']} — a"
                " prevent_destroy that guards nothing guards nothing"
            )
            continue
        if not re.search(r"prevent_destroy\s*=\s*true", block):
            violations.append(
                f"{carrier['stack_dir']}: resource {type_name}.{name} is"
                " declared durable data but carries no"
                " `lifecycle { prevent_destroy = true }` — the last-resort stop"
                " inside the tool itself (addendum §3)"
            )

    declared_pairs = {
        tuple(re.sub(r"\[[^\]]+\]$", "", address).split(".")[-2:]) for address in declared
    }
    for relative, text in sources.items():
        for match in re.finditer(
            r'(?m)^\s*resource\s+"([a-z][a-z0-9_]*)"\s+"([A-Za-z_][\w-]*)"', text
        ):
            type_name, name = match.group(1), match.group(2)
            if type_name not in DURABLE_DATA_TYPES:
                continue
            if (type_name, name) not in declared_pairs:
                violations.append(
                    f"{relative}: {type_name}.{name} is durable data but is not"
                    " in the carrier's durable_data_addresses — the §4"
                    " classifier cannot refuse a destroy it was never told to"
                    " watch"
                )
    return violations


# ------------------------------------------------------------------ law 9 ---
def call_site_gate_violations(root: Path, carrier: Mapping[str, Any]) -> list[str]:
    """The inert gate at the CALL SITE (addendum §10, MMS L15).

    Distinct from law 5: `armed` is a runtime flag the loop reads each tick;
    this is a plan-shape gate deciding whether the carrier resource exists at
    all. A tenant may legitimately have neither, one, or both — this law only
    binds when the tenant declares a gate variable.
    """

    gate = carrier.get("gate_variable") or ""
    if not gate:
        return []
    source = carrier["carrier_source"]
    text = read(root, source)
    violations: list[str] = []
    if not re.search(r"enabled\s*=\s*var\." + re.escape(gate) + r"\b", text):
        violations.append(
            f"{source}: the instantiation's `enabled` is not wired to"
            f" var.{gate}; an ungated carrier composes on the first apply,"
            " whose plan nobody saw"
        )
    declaration = re.search(
        r'variable\s+"' + re.escape(gate) + r'"\s*\{(.*?)\n\}',
        "\n".join(_stack_sources(root, carrier).values()),
        re.DOTALL,
    )
    if not declaration:
        violations.append(f"{carrier['stack_dir']}: variable {gate!r} is not declared")
    elif not re.search(r"default\s*=\s*false", declaration.group(1)):
        violations.append(
            f"{carrier['stack_dir']}: variable {gate!r} must default to false —"
            " only the reviewed activation ceremony flips it"
        )
    return violations


def tenant_violations(root: Path, carrier: Mapping[str, Any]) -> list[str]:
    """Every tenant-side law, in one call."""

    return (
        carrier_inside_stack_violations(root, carrier)
        + no_bespoke_loop_violations(root, carrier)
        + workflow_reach_violations(root, carrier)
        + kill_switch_document_violations(root, carrier)
        + arming_gate_violations(root, carrier)
        + destroy_admission_violations(root, carrier)
        + ephemeral_declaration_violations(root, carrier)
        + prevent_destroy_violations(root, carrier)
        + call_site_gate_violations(root, carrier)
    )
