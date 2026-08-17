#!/usr/bin/env python3
"""Adversarial tests for the production-convergence contract.

Contract statement: docs/patterns/production-convergence.md (TIN-489,
TIN-3065). Six mechanical laws are enforced here:

1. sha-literal-in-binding: a 40-hex SHA may appear in a binding document
   only inside the owner-overlay receipt-recorded binding claim.
2. sha-literal-in-prose: no 40-hex SHA appears in a durable prose document
   (docs/**/*.md, AGENTS.md) outside the explicit allowlist of legitimate
   examples.
3. no-checked-in-receipts: runtime converge receipts are never checked in.
4. no-durable-env-branch: no workflow addresses prod, production, release,
   or staging — neither as a refs/heads/ ref nor as an on.*.branches
   filter entry; main is the only durable branch.
5. converge-carrier declaration: a declaration names exactly one carrier —
   carrier_workflow (a path under .github/workflows/ that must exist) or
   carrier_resource (the tofu address of the carrier resource inside the
   declared stack) — plus a checked-in workflow-state toggle document. A
   declaration naming no carrier (or both) is a violation; a product with
   no declaration file is out of scope (the template-repository default).
6. armed-toggle shape: a workflow-state document that carries an `armed`
   toggle (gated arming, stateful-workload addendum §10) must check it in
   as the literal boolean false, alongside — never instead of — a distinct
   `enabled` toggle. Absence of any `armed` toggle is not a violation.
"""

from __future__ import annotations

import copy
import json
import os
import re
import tempfile
import unittest
from pathlib import Path
from typing import Any


def workspace_root() -> Path:
    test_srcdir = os.environ.get("TEST_SRCDIR")
    test_workspace = os.environ.get("TEST_WORKSPACE")
    if test_srcdir and test_workspace:
        return Path(test_srcdir) / test_workspace
    return Path(__file__).resolve().parent.parent


ROOT = workspace_root()
DECLARATION_PATH = "config/production-convergence.json"
ALLOWED_DECLARATION_KEYS = {
    "$schema",
    "carrier_workflow",
    "carrier_resource",
    "workflow_state_document",
}
CARRIER_KEYS = ("carrier_workflow", "carrier_resource")
# Dotted tofu address with an optional count/for_each index suffix on the
# FINAL segment only: [<digits>] or ["<key>"] (TIN-489 L15 — a first adopter
# count-gates the carrier during bootstrap-import).
TOFU_RESOURCE_ADDRESS = re.compile(
    r'(?:[a-zA-Z_][\w-]*\.)+[a-zA-Z_]\w*(?:\[(?:\d+|"[^"]+")\])?'
)
RECEIPT_CLAIM_POINTER = ("owner_overlay", "binding_receipt", "commit_sha")
BINDING_DOCUMENT_KEYS = {"application_binding", "owner_overlay"}
SHA_LITERAL = re.compile(r"\b[0-9a-f]{40}\b")
DURABLE_ENV_BRANCH_REF = re.compile(
    r"refs/heads/(?:production|prod|release|staging)(?![0-9A-Za-z._/-])"
)
# The ordinary way a workflow names a branch is a branches filter —
# `on: push: branches: [production]` — which contains no `refs/heads/`.
DURABLE_ENV_BRANCH_NAME = re.compile(r"^(?:production|prod|release|staging)$")
BRANCH_FILTER_KEY = re.compile(
    r"^(\s*)[\"']?branches(?:-ignore)?[\"']?\s*:\s*(.*?)\s*(?:#.*)?$"
)
BRANCH_FILTER_ITEM = re.compile(r"^(\s*)-\s*[\"']?([^\"'#\s]+)[\"']?\s*(?:#.*)?$")
# Flow-mapping form — `on: { push: { branches: [production] } }` — puts the
# key mid-line, where BRANCH_FILTER_KEY's start-of-line anchor cannot see it.
BRANCH_FILTER_FLOW = re.compile(
    r"[\"']?branches(?:-ignore)?[\"']?\s*:\s*\[([^\]]*)\]"
)
RECEIPT_FILENAME = re.compile(r"receipt", re.IGNORECASE)
ENABLED_TOGGLE_LINE = re.compile(r"^\s*[\"']?enabled[\"']?\s*:\s*(?:true|false)", re.MULTILINE)
ARMED_TOGGLE_LINE = re.compile(r"^\s*[\"']?armed[\"']?\s*:\s*([^\s#]+)", re.MULTILINE)
# Prose documents (docs/**/*.md, AGENTS.md) reference `main` by name; a
# 40-hex literal is admitted only via this explicit allowlist of examples
# that genuinely must show a full SHA. Keep it minimal: map a repo-relative
# path to the exact literals admitted in that file. It is intentionally
# empty today — no prose document on main carries a 40-hex literal.
PROSE_SHA_ALLOWLIST: dict[str, frozenset[str]] = {}
SCAN_EXCLUDED_DIRECTORIES = {
    ".git",
    ".svelte-kit",
    ".direnv",
    "build",
    "coverage",
    "node_modules",
}


class DuplicateKeyError(ValueError):
    """A JSON object declared the same key twice."""


def _reject_duplicate_keys(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    document: dict[str, Any] = {}
    for key, value in pairs:
        if key in document:
            raise DuplicateKeyError(f"duplicate JSON key: {key!r}")
        document[key] = value
    return document


def load_json_strict_text(text: str) -> Any:
    return json.loads(text, object_pairs_hook=_reject_duplicate_keys)


def _scan_files(root: Path) -> list[Path]:
    found: list[Path] = []
    for current, directories, files in os.walk(root):
        directories[:] = sorted(
            name
            for name in directories
            if name not in SCAN_EXCLUDED_DIRECTORIES and not name.startswith("bazel-")
        )
        found.extend(Path(current) / name for name in sorted(files))
    return found


def is_binding_document(document: Any) -> bool:
    return isinstance(document, dict) and bool(BINDING_DOCUMENT_KEYS & set(document))


def sha_literal_violations(document: Any) -> list[str]:
    """JSON Pointers of 40-hex SHA strings outside the receipt claim."""

    violations: list[str] = []

    def walk(node: Any, pointer: tuple[str, ...]) -> None:
        if isinstance(node, dict):
            for key, value in node.items():
                walk(value, pointer + (str(key),))
        elif isinstance(node, list):
            for index, value in enumerate(node):
                walk(value, pointer + (str(index),))
        elif isinstance(node, str) and SHA_LITERAL.search(node):
            if pointer != RECEIPT_CLAIM_POINTER:
                violations.append("/" + "/".join(pointer))

    walk(document, ())
    return violations


def binding_document_violations(root: Path) -> list[str]:
    violations: list[str] = []
    for scope in ("config", "tests/fixtures"):
        base = root / scope
        if not base.is_dir():
            continue
        for path in _scan_files(base):
            if path.suffix != ".json":
                continue
            document = load_json_strict_text(path.read_text(encoding="utf-8"))
            if not is_binding_document(document):
                continue
            relative = path.relative_to(root)
            violations.extend(
                f"{relative}: sha literal outside receipt claim at {pointer}"
                for pointer in sha_literal_violations(document)
            )
    return violations


def checked_in_receipt_violations(root: Path) -> list[str]:
    violations: list[str] = []
    for path in _scan_files(root):
        relative = path.relative_to(root)
        if any(part.lower() == "receipts" for part in relative.parts[:-1]):
            violations.append(f"{relative}: receipts directory is checked in")
        elif RECEIPT_FILENAME.search(relative.name):
            violations.append(f"{relative}: receipt-named file is checked in")
    return violations


def _branch_filter_names(line: str, block_indent: int | None) -> tuple[list[str], int | None]:
    """Branch names a workflow line contributes to a branches filter.

    Returns the names found on this line plus the block-list indent to carry
    forward (None when the line ends any open block list).
    """

    key = BRANCH_FILTER_KEY.match(line)
    if key:
        remainder = key.group(2)
        if remainder.startswith("[") and remainder.endswith("]"):
            return re.findall(r"[^,\[\]\s\"']+", remainder), None
        if remainder == "":
            return [], len(key.group(1))
        return [], None
    # Mid-line (flow-mapping) filter. Strip any comment portion first so a
    # commented-out example cannot false-positive; `#` is illegal in a branch
    # name, so the split is safe.
    flow = BRANCH_FILTER_FLOW.search(line.split("#", 1)[0])
    if flow:
        return re.findall(r"[^,\[\]\s\"']+", flow.group(1)), block_indent
    if block_indent is not None:
        item = BRANCH_FILTER_ITEM.match(line)
        if item and len(item.group(1)) > block_indent:
            return [item.group(2)], block_indent
        if line.strip():
            return [], None
    return [], block_indent


def durable_env_branch_violations(root: Path) -> list[str]:
    violations: list[str] = []
    workflows = root / ".github" / "workflows"
    if not workflows.is_dir():
        return violations
    for path in _scan_files(workflows):
        if path.suffix not in {".yml", ".yaml"}:
            continue
        relative = path.relative_to(root)
        block_indent: int | None = None
        for number, line in enumerate(
            path.read_text(encoding="utf-8").splitlines(), start=1
        ):
            match = DURABLE_ENV_BRANCH_REF.search(line)
            if match:
                violations.append(
                    f"{relative}:{number}: durable environment branch {match.group(0)}"
                )
            names, block_indent = _branch_filter_names(line, block_indent)
            violations.extend(
                f"{relative}:{number}: durable environment branch {name}"
                " in a branches filter"
                for name in names
                if DURABLE_ENV_BRANCH_NAME.match(name)
            )
    return violations


def prose_sha_literal_violations(
    root: Path, allowlist: dict[str, frozenset[str]] | None = None
) -> list[str]:
    """40-hex literals in durable prose documents (docs/**/*.md, AGENTS.md).

    Prose references `main` by name; the resolution belongs in a runtime
    receipt. Only literals named by the explicit allowlist are admitted.
    """

    if allowlist is None:
        allowlist = PROSE_SHA_ALLOWLIST
    violations: list[str] = []
    documents: list[Path] = []
    docs = root / "docs"
    if docs.is_dir():
        documents.extend(
            path for path in _scan_files(docs) if path.suffix == ".md"
        )
    agents = root / "AGENTS.md"
    if agents.is_file():
        documents.append(agents)
    for path in documents:
        relative = path.relative_to(root)
        allowed = allowlist.get(str(relative), frozenset())
        for number, line in enumerate(
            path.read_text(encoding="utf-8").splitlines(), start=1
        ):
            violations.extend(
                f"{relative}:{number}: sha literal {match.group(0)} in a"
                " durable prose document (pin the symbol: reference main"
                " by name; SHAs are receipt-only)"
                for match in SHA_LITERAL.finditer(line)
                if match.group(0) not in allowed
            )
    return violations


def armed_toggle_violations(root: Path) -> list[str]:
    """Shape of any checked-in `armed` toggle (gated arming, addendum §10).

    Absence is compliant — the scaffold carries no workflow-state document.
    A document that does carry `armed` must check it in as the literal
    boolean false, and must carry a distinct `enabled` toggle: the arming
    gate and the kill switch are two flags, never collapsed into one.
    """

    violations: list[str] = []
    config = root / "config"
    if not config.is_dir():
        return violations
    for path in _scan_files(config):
        try:
            text = path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            continue
        matches = list(ARMED_TOGGLE_LINE.finditer(text))
        if not matches:
            continue
        relative = path.relative_to(root)
        for match in matches:
            value = match.group(1).rstrip(",")
            if value not in {"true", "false"}:
                violations.append(
                    f"{relative}: armed toggle must be a literal boolean"
                    f" (found {value!r})"
                )
            elif value == "true":
                violations.append(
                    f"{relative}: checked-in armed default must be false —"
                    " arming is a reviewed, converge-scoped decision, not"
                    " a durable state"
                )
        if not ENABLED_TOGGLE_LINE.search(text):
            violations.append(
                f"{relative}: armed toggle requires a distinct enabled"
                " toggle in the same document (two flags, never collapsed)"
            )
    return violations


def converge_carrier_violations(root: Path) -> list[str]:
    declaration_path = root / DECLARATION_PATH
    if not declaration_path.is_file():
        return []

    try:
        declaration = load_json_strict_text(
            declaration_path.read_text(encoding="utf-8")
        )
    except (DuplicateKeyError, json.JSONDecodeError) as error:
        return [f"{DECLARATION_PATH}: {error}"]

    if not isinstance(declaration, dict):
        return [f"{DECLARATION_PATH}: expected a single declaration object"]

    violations: list[str] = []
    unknown = set(declaration) - ALLOWED_DECLARATION_KEYS
    if unknown:
        violations.append(
            f"{DECLARATION_PATH}: unknown keys {sorted(unknown)}"
            " (exactly one carrier; no aliases)"
        )
    declared_carriers = [key for key in CARRIER_KEYS if key in declaration]
    if len(declared_carriers) != 1:
        described = " and ".join(declared_carriers) if declared_carriers else "neither"
        violations.append(
            f"{DECLARATION_PATH}: declare exactly one of carrier_workflow or"
            f" carrier_resource ({described} declared); a declaration naming"
            " no carrier is a converging product with no declared carrier,"
            " not an opt-out"
        )
        return violations
    carrier_key = declared_carriers[0]
    value_shape = {
        "carrier_workflow": "path",
        "carrier_resource": "tofu address",
        "workflow_state_document": "path",
    }
    for key in (carrier_key, "workflow_state_document"):
        if not isinstance(declaration.get(key), str) or not declaration.get(key):
            violations.append(
                f"{DECLARATION_PATH}: {key} must be a single non-empty"
                f" {value_shape[key]} string"
            )
    if violations:
        return violations

    state_document = declaration["workflow_state_document"]

    if carrier_key == "carrier_workflow":
        carrier = declaration["carrier_workflow"]
        if not carrier.startswith(".github/workflows/"):
            violations.append(
                f"{DECLARATION_PATH}: carrier_workflow must live under .github/workflows/"
            )
        if not (root / carrier).is_file():
            violations.append(
                f"{DECLARATION_PATH}: declared carrier {carrier} is missing"
            )
    else:
        address = declaration["carrier_resource"]
        if not TOFU_RESOURCE_ADDRESS.fullmatch(address):
            violations.append(
                f"{DECLARATION_PATH}: carrier_resource {address!r} is not a"
                " tofu resource address (expected e.g."
                " kubernetes_cron_job_v1.tofu_agent,"
                " module.stack.kubernetes_cron_job_v1.tofu_agent, or"
                " kubernetes_cron_job_v1.tofu_agent[0] — an index suffix is"
                " admitted on the final segment only)"
            )
    if not (root / state_document).is_file():
        violations.append(
            f"{DECLARATION_PATH}: workflow-state document {state_document} is missing"
        )
    if violations:
        return violations

    if not ENABLED_TOGGLE_LINE.search((root / state_document).read_text(encoding="utf-8")):
        violations.append(
            f"{state_document}: workflow-state document lacks an enabled toggle"
        )
    if carrier_key == "carrier_workflow":
        carrier = declaration["carrier_workflow"]
        if state_document not in (root / carrier).read_text(encoding="utf-8"):
            violations.append(
                f"{carrier}: carrier does not reference the workflow-state document"
                f" {state_document}"
            )
    return violations


VALID_BINDING_DOCUMENT: dict[str, Any] = {
    "schema_version": 1,
    "application_binding": {
        "source_repository": "example/example-application",
        "default_branch": "main",
        "artifact_repository": "ghcr.io/example-publisher/example-application",
    },
    "owner_overlay": {
        "repository": "example/example-application-infra",
        "binding_status": "receipt-recorded",
        "binding_receipt": {
            "repository": "example/example-application-infra",
            "commit_sha": "1" * 40,
            "path": "config/application-owner-overlay.json",
            "document_pointer": "/application_binding",
        },
    },
}

CARRIER_WORKFLOW_PATH = ".github/workflows/production-converge.yml"
WORKFLOW_STATE_PATH = "config/workflow-state/production-converge.json"
CARRIER_WORKFLOW_TEXT = f"""name: production-converge
on:
  push:
    branches: [main]
jobs:
  converge:
    runs-on: tinyland-nix
    steps:
      - uses: actions/checkout@v7
      - name: Halt unless the reviewed toggle is enabled
        run: jq -e '.enabled == true' {WORKFLOW_STATE_PATH}
      - name: Reconcile production to refs/heads/main
        run: just converge
"""


def build_product_fixture(root: Path) -> None:
    """Materialize a minimal conforming converge product tree."""

    (root / ".github" / "workflows").mkdir(parents=True)
    (root / "config" / "workflow-state").mkdir(parents=True)
    (root / CARRIER_WORKFLOW_PATH).write_text(CARRIER_WORKFLOW_TEXT, encoding="utf-8")
    (root / WORKFLOW_STATE_PATH).write_text(
        json.dumps({"enabled": True}, indent=2) + "\n", encoding="utf-8"
    )
    (root / DECLARATION_PATH).write_text(
        json.dumps(
            {
                "carrier_workflow": CARRIER_WORKFLOW_PATH,
                "workflow_state_document": WORKFLOW_STATE_PATH,
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    (root / "config" / "application-owner-overlay.json").write_text(
        json.dumps(VALID_BINDING_DOCUMENT, indent=2) + "\n", encoding="utf-8"
    )


def all_violations(root: Path) -> list[str]:
    return (
        binding_document_violations(root)
        + prose_sha_literal_violations(root)
        + checked_in_receipt_violations(root)
        + durable_env_branch_violations(root)
        + converge_carrier_violations(root)
        + armed_toggle_violations(root)
    )


class RepositoryConformanceTests(unittest.TestCase):
    """This repository must satisfy its own convergence contract."""

    def test_binding_documents_carry_no_sha_literals_outside_receipt_claims(self) -> None:
        self.assertEqual([], binding_document_violations(ROOT))

    def test_no_runtime_receipts_are_checked_in(self) -> None:
        self.assertEqual([], checked_in_receipt_violations(ROOT))

    def test_no_workflow_addresses_a_durable_environment_branch(self) -> None:
        self.assertEqual([], durable_env_branch_violations(ROOT))

    def test_carrier_declaration_is_absent_or_valid(self) -> None:
        self.assertEqual([], converge_carrier_violations(ROOT))

    def test_prose_documents_carry_no_sha_literals_outside_the_allowlist(self) -> None:
        self.assertEqual([], prose_sha_literal_violations(ROOT))

    def test_armed_toggles_are_absent_or_well_formed(self) -> None:
        self.assertEqual([], armed_toggle_violations(ROOT))


class ProductionConvergenceContractTests(unittest.TestCase):
    def setUp(self) -> None:
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        build_product_fixture(self.root)

    def write_json(self, relative: str, document: Any) -> None:
        (self.root / relative).write_text(
            json.dumps(document, indent=2) + "\n", encoding="utf-8"
        )

    def declaration(self) -> dict[str, Any]:
        return load_json_strict_text(
            (self.root / DECLARATION_PATH).read_text(encoding="utf-8")
        )

    def test_canonical_product_fixture_passes(self) -> None:
        self.assertEqual([], all_violations(self.root))

    def test_sha_literal_inside_receipt_claim_is_the_only_allowed_binding_sha(self) -> None:
        document = copy.deepcopy(VALID_BINDING_DOCUMENT)
        self.assertEqual([], sha_literal_violations(document))

    def test_sha_literal_outside_receipt_claim_fails(self) -> None:
        mutations = (
            ("application_binding", "artifact_repository"),
            ("application_binding", "default_branch"),
            ("owner_overlay", "repository"),
        )
        for path in mutations:
            with self.subTest(path=path):
                document = copy.deepcopy(VALID_BINDING_DOCUMENT)
                container: dict[str, Any] = document
                for component in path[:-1]:
                    container = container[component]
                container[path[-1]] = f"pinned-to-{'a' * 40}"
                self.write_json("config/application-owner-overlay.json", document)
                violations = binding_document_violations(self.root)
                self.assertTrue(violations)
                pointer = "/" + "/".join(path)
                self.assertTrue(
                    any(pointer in violation for violation in violations),
                    f"expected {pointer!r}; observed {violations!r}",
                )

    def test_duplicate_keys_in_binding_documents_are_rejected(self) -> None:
        (self.root / "config" / "application-owner-overlay.json").write_text(
            '{"owner_overlay": {}, "owner_overlay": {}}', encoding="utf-8"
        )
        with self.assertRaises(DuplicateKeyError):
            binding_document_violations(self.root)

    def test_checked_in_receipts_fail(self) -> None:
        mutations = (
            "receipts/converge-2026-07-28.json",
            "config/receipts/latest.json",
            "docs/converge-receipt.json",
        )
        for relative in mutations:
            with self.subTest(path=relative):
                path = self.root / relative
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text("{}\n", encoding="utf-8")
                self.assertTrue(checked_in_receipt_violations(self.root))
                path.unlink()

    def test_durable_environment_branch_refs_fail(self) -> None:
        for branch in ("prod", "production", "release", "staging"):
            with self.subTest(branch=branch):
                carrier = self.root / CARRIER_WORKFLOW_PATH
                carrier.write_text(
                    CARRIER_WORKFLOW_TEXT.replace(
                        "refs/heads/main", f"refs/heads/{branch}"
                    ),
                    encoding="utf-8",
                )
                violations = durable_env_branch_violations(self.root)
                self.assertTrue(violations)
                self.assertTrue(
                    any(f"refs/heads/{branch}" in violation for violation in violations)
                )
        (self.root / CARRIER_WORKFLOW_PATH).write_text(
            CARRIER_WORKFLOW_TEXT, encoding="utf-8"
        )

    def test_durable_branch_in_inline_branches_filter_fails(self) -> None:
        """The refs/heads/ blindness: on.push.branches list form is caught."""
        for filter_line in (
            "    branches: [production]",
            "    branches: [main, production]",
            "    branches: ['production']",
            '    branches-ignore: ["staging"]',
        ):
            with self.subTest(filter_line=filter_line):
                (self.root / CARRIER_WORKFLOW_PATH).write_text(
                    CARRIER_WORKFLOW_TEXT.replace(
                        "    branches: [main]", filter_line
                    ),
                    encoding="utf-8",
                )
                violations = durable_env_branch_violations(self.root)
                self.assertTrue(
                    any("in a branches filter" in violation for violation in violations),
                    (filter_line, violations),
                )
        (self.root / CARRIER_WORKFLOW_PATH).write_text(
            CARRIER_WORKFLOW_TEXT, encoding="utf-8"
        )

    def test_durable_branch_in_flow_mapping_filter_fails(self) -> None:
        """Flow-mapping one-liner — the key sits mid-line, past the anchor."""
        workflow = (
            "name: scratch\n"
            "on: { push: { branches: [production] } }\n"
            "jobs:\n"
            "  noop:\n"
            "    runs-on: ubuntu-latest\n"
            "    steps:\n"
            "      - run: 'true'\n"
        )
        scratch = self.root / ".github" / "workflows" / "scratch-flow.yml"
        scratch.write_text(workflow, encoding="utf-8")
        try:
            violations = durable_env_branch_violations(self.root)
            self.assertTrue(
                any(
                    "production in a branches filter" in violation
                    for violation in violations
                ),
                violations,
            )
            # A commented-out flow mapping must NOT trip the check.
            scratch.write_text(
                workflow.replace(
                    "on: { push: { branches: [production] } }",
                    "on: push\n# on: { push: { branches: [production] } }",
                ),
                encoding="utf-8",
            )
            self.assertEqual([], durable_env_branch_violations(self.root))
        finally:
            scratch.unlink()

    def test_durable_branch_in_block_branches_filter_fails(self) -> None:
        block = "    branches:\n      - main\n      - production"
        (self.root / CARRIER_WORKFLOW_PATH).write_text(
            CARRIER_WORKFLOW_TEXT.replace("    branches: [main]", block),
            encoding="utf-8",
        )
        violations = durable_env_branch_violations(self.root)
        self.assertTrue(
            any(
                "production in a branches filter" in violation
                for violation in violations
            ),
            violations,
        )
        (self.root / CARRIER_WORKFLOW_PATH).write_text(
            CARRIER_WORKFLOW_TEXT, encoding="utf-8"
        )

    def test_prefixed_branch_names_in_filters_are_not_false_positives(self) -> None:
        block = "    branches:\n      - main\n      - release-notes\n      - production-docs"
        (self.root / CARRIER_WORKFLOW_PATH).write_text(
            CARRIER_WORKFLOW_TEXT.replace("    branches: [main]", block)
            + "      - run: echo 'branches: [release-please]'\n",
            encoding="utf-8",
        )
        self.assertEqual([], durable_env_branch_violations(self.root))
        (self.root / CARRIER_WORKFLOW_PATH).write_text(
            CARRIER_WORKFLOW_TEXT, encoding="utf-8"
        )

    def test_prefixed_branch_names_are_not_false_positives(self) -> None:
        carrier = self.root / CARRIER_WORKFLOW_PATH
        carrier.write_text(
            CARRIER_WORKFLOW_TEXT + "      - run: echo refs/heads/release-notes\n",
            encoding="utf-8",
        )
        self.assertEqual([], durable_env_branch_violations(self.root))

    def test_missing_carrier_path_fails(self) -> None:
        (self.root / CARRIER_WORKFLOW_PATH).unlink()
        violations = converge_carrier_violations(self.root)
        self.assertTrue(
            any("is missing" in violation for violation in violations), violations
        )

    def test_carrier_must_reference_the_workflow_state_document(self) -> None:
        (self.root / CARRIER_WORKFLOW_PATH).write_text(
            CARRIER_WORKFLOW_TEXT.replace(WORKFLOW_STATE_PATH, "an-unreviewed-toggle"),
            encoding="utf-8",
        )
        violations = converge_carrier_violations(self.root)
        self.assertTrue(
            any("does not reference" in violation for violation in violations),
            violations,
        )

    def test_workflow_state_document_must_declare_an_enabled_toggle(self) -> None:
        self.write_json(WORKFLOW_STATE_PATH, {"paused": True})
        violations = converge_carrier_violations(self.root)
        self.assertTrue(
            any("enabled toggle" in violation for violation in violations), violations
        )

    def test_second_carrier_shapes_are_rejected(self) -> None:
        declaration = self.declaration()
        declaration["carrier_workflow"] = [
            CARRIER_WORKFLOW_PATH,
            ".github/workflows/second-converge.yml",
        ]
        self.write_json(DECLARATION_PATH, declaration)
        violations = converge_carrier_violations(self.root)
        self.assertTrue(
            any("single non-empty path" in violation for violation in violations),
            violations,
        )

        declaration = {
            "carrier_workflow": CARRIER_WORKFLOW_PATH,
            "workflow_state_document": WORKFLOW_STATE_PATH,
            "carrier_workflows": [CARRIER_WORKFLOW_PATH],
        }
        self.write_json(DECLARATION_PATH, declaration)
        violations = converge_carrier_violations(self.root)
        self.assertTrue(
            any("unknown keys" in violation for violation in violations), violations
        )

    def test_carrier_outside_workflows_directory_is_rejected(self) -> None:
        declaration = self.declaration()
        declaration["carrier_workflow"] = "scripts/converge.sh"
        self.write_json(DECLARATION_PATH, declaration)
        violations = converge_carrier_violations(self.root)
        self.assertTrue(
            any(".github/workflows/" in violation for violation in violations),
            violations,
        )

    def test_missing_declaration_means_no_carrier_and_no_violation(self) -> None:
        """No declaration file = out of scope: the template-repository default.

        Contrast with test_declaring_neither_carrier_fails — a declaration
        that exists but names no carrier is a violation, not an opt-out.
        """
        (self.root / DECLARATION_PATH).unlink()
        self.assertEqual([], converge_carrier_violations(self.root))

    def test_carrier_resource_declaration_passes(self) -> None:
        (self.root / CARRIER_WORKFLOW_PATH).unlink()
        for address in (
            "kubernetes_cron_job_v1.tofu_agent",
            "module.site.kubernetes_cron_job_v1.tofu_agent",
            # count/for_each-gated carriers: an index suffix on the final
            # segment is a legitimate address (bootstrap-import count-gating).
            "kubernetes_cron_job_v1.tofu_agent[0]",
            'module.x.kubernetes_cron_job_v1.this["a"]',
        ):
            with self.subTest(address=address):
                self.write_json(
                    DECLARATION_PATH,
                    {
                        "carrier_resource": address,
                        "workflow_state_document": WORKFLOW_STATE_PATH,
                    },
                )
                self.assertEqual([], all_violations(self.root))

    def test_declaring_both_carriers_fails(self) -> None:
        self.write_json(
            DECLARATION_PATH,
            {
                "carrier_workflow": CARRIER_WORKFLOW_PATH,
                "carrier_resource": "kubernetes_cron_job_v1.tofu_agent",
                "workflow_state_document": WORKFLOW_STATE_PATH,
            },
        )
        violations = converge_carrier_violations(self.root)
        self.assertTrue(
            any("exactly one of" in violation for violation in violations),
            violations,
        )

    def test_declaring_neither_carrier_fails(self) -> None:
        """The silent-pass defect closed by converge-agent.md §6."""
        for document in (
            {},
            {"workflow_state_document": WORKFLOW_STATE_PATH},
        ):
            with self.subTest(document=document):
                self.write_json(DECLARATION_PATH, document)
                violations = converge_carrier_violations(self.root)
                self.assertTrue(
                    any("exactly one of" in violation for violation in violations),
                    violations,
                )

    def test_malformed_carrier_resource_address_fails(self) -> None:
        for address in (
            "tofu_agent",
            ".kubernetes_cron_job_v1.tofu_agent",
            "kubernetes_cron_job_v1.tofu_agent.",
            "kubernetes_cron_job_v1.tofu agent",
            # index on a non-final segment
            "kubernetes_cron_job_v1[0].tofu_agent",
            "module.x[0].kubernetes_cron_job_v1.tofu_agent",
            "kubernetes_cron_job_v1.tofu_agent[0].extra",
            # unclosed bracket
            "kubernetes_cron_job_v1.tofu_agent[0",
            'kubernetes_cron_job_v1.tofu_agent["a]',
            # empty index
            "kubernetes_cron_job_v1.tofu_agent[]",
            'kubernetes_cron_job_v1.tofu_agent[""]',
            # unquoted non-numeric index
            "kubernetes_cron_job_v1.tofu_agent[a]",
            # leading index
            "[0]kubernetes_cron_job_v1.tofu_agent",
            # bare index without a resource
            "[0]",
            "tofu_agent[0]",
        ):
            with self.subTest(address=address):
                self.write_json(
                    DECLARATION_PATH,
                    {
                        "carrier_resource": address,
                        "workflow_state_document": WORKFLOW_STATE_PATH,
                    },
                )
                violations = converge_carrier_violations(self.root)
                self.assertTrue(
                    any(
                        "not a tofu resource address" in violation
                        for violation in violations
                    ),
                    violations,
                )

    def test_carrier_resource_still_requires_the_state_document(self) -> None:
        self.write_json(
            DECLARATION_PATH,
            {
                "carrier_resource": "kubernetes_cron_job_v1.tofu_agent",
                "workflow_state_document": WORKFLOW_STATE_PATH,
            },
        )
        (self.root / WORKFLOW_STATE_PATH).unlink()
        violations = converge_carrier_violations(self.root)
        self.assertTrue(
            any("is missing" in violation for violation in violations), violations
        )

    def test_carrier_resource_state_document_must_declare_an_enabled_toggle(
        self,
    ) -> None:
        self.write_json(
            DECLARATION_PATH,
            {
                "carrier_resource": "kubernetes_cron_job_v1.tofu_agent",
                "workflow_state_document": WORKFLOW_STATE_PATH,
            },
        )
        self.write_json(WORKFLOW_STATE_PATH, {"paused": True})
        violations = converge_carrier_violations(self.root)
        self.assertTrue(
            any("enabled toggle" in violation for violation in violations),
            violations,
        )


class ArmedToggleShapeTests(unittest.TestCase):
    """Gated arming (stateful-workload addendum §10): shape of `armed`."""

    def setUp(self) -> None:
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        build_product_fixture(self.root)

    def test_absence_of_any_armed_toggle_passes(self) -> None:
        """The scaffold default: no workflow-state document carries armed."""
        self.assertEqual([], armed_toggle_violations(self.root))

    def test_well_formed_armed_false_beside_enabled_passes(self) -> None:
        (self.root / WORKFLOW_STATE_PATH).write_text(
            json.dumps({"enabled": True, "armed": False}, indent=2) + "\n",
            encoding="utf-8",
        )
        self.assertEqual([], armed_toggle_violations(self.root))
        self.assertEqual([], all_violations(self.root))

    def test_checked_in_armed_true_fails(self) -> None:
        (self.root / WORKFLOW_STATE_PATH).write_text(
            json.dumps({"enabled": True, "armed": True}, indent=2) + "\n",
            encoding="utf-8",
        )
        violations = armed_toggle_violations(self.root)
        self.assertTrue(
            any("armed default must be false" in violation for violation in violations),
            violations,
        )

    def test_non_boolean_armed_fails(self) -> None:
        for value in ('"yes"', '"false"', "1", "null"):
            with self.subTest(value=value):
                (self.root / WORKFLOW_STATE_PATH).write_text(
                    '{\n  "enabled": true,\n  "armed": %s\n}\n' % value,
                    encoding="utf-8",
                )
                violations = armed_toggle_violations(self.root)
                self.assertTrue(
                    any(
                        "literal boolean" in violation for violation in violations
                    ),
                    (value, violations),
                )

    def test_armed_without_a_distinct_enabled_toggle_fails(self) -> None:
        """Two flags, never collapsed: armed may not replace enabled."""
        (self.root / WORKFLOW_STATE_PATH).write_text(
            json.dumps({"armed": False}, indent=2) + "\n", encoding="utf-8"
        )
        violations = armed_toggle_violations(self.root)
        self.assertTrue(
            any("distinct enabled" in violation for violation in violations),
            violations,
        )


class ProseShaLiteralTests(unittest.TestCase):
    """Pin the symbol, extended to prose: docs/**/*.md and AGENTS.md."""

    def setUp(self) -> None:
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        build_product_fixture(self.root)
        (self.root / "docs" / "patterns").mkdir(parents=True)

    def test_prose_without_sha_literals_passes(self) -> None:
        (self.root / "docs" / "patterns" / "example.md").write_text(
            "Reference `main` by name; the resolution is a runtime fact.\n",
            encoding="utf-8",
        )
        self.assertEqual([], prose_sha_literal_violations(self.root))

    def test_sha_literal_in_a_docs_document_fails(self) -> None:
        (self.root / "docs" / "patterns" / "example.md").write_text(
            f"Pinned to {'a' * 40} for reasons.\n", encoding="utf-8"
        )
        violations = prose_sha_literal_violations(self.root)
        self.assertTrue(
            any("durable prose document" in violation for violation in violations),
            violations,
        )

    def test_sha_literal_in_agents_md_fails(self) -> None:
        (self.root / "AGENTS.md").write_text(
            f"The blessed build is {'b' * 40}.\n", encoding="utf-8"
        )
        violations = prose_sha_literal_violations(self.root)
        self.assertTrue(
            any("AGENTS.md:1" in violation for violation in violations), violations
        )

    def test_allowlisted_literal_passes_and_others_still_fail(self) -> None:
        document = self.root / "docs" / "patterns" / "example.md"
        document.write_text(
            f"A receipt-claim example: {'c' * 40}.\n", encoding="utf-8"
        )
        allowlist = {"docs/patterns/example.md": frozenset({"c" * 40})}
        self.assertEqual(
            [], prose_sha_literal_violations(self.root, allowlist=allowlist)
        )
        document.write_text(
            f"A receipt-claim example: {'c' * 40}.\nAnd a stray {'d' * 40}.\n",
            encoding="utf-8",
        )
        violations = prose_sha_literal_violations(self.root, allowlist=allowlist)
        self.assertTrue(
            any("d" * 40 in violation for violation in violations), violations
        )
        self.assertFalse(any("c" * 40 in violation for violation in violations))

    def test_non_markdown_and_out_of_scope_files_are_not_scanned(self) -> None:
        (self.root / "docs" / "notes.txt").write_text(
            f"{'e' * 40}\n", encoding="utf-8"
        )
        (self.root / "README-scratch.md").write_text(
            f"{'f' * 40}\n", encoding="utf-8"
        )
        self.assertEqual([], prose_sha_literal_violations(self.root))


if __name__ == "__main__":
    unittest.main()
