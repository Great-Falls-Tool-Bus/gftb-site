#!/usr/bin/env python3
"""TEMPLATE — the tenant-side contract for a converge-agent instantiation.

This file is an IMPORTER, not a contract. Every law it enforces lives once, in
the published module, at `contract/tenant_contract.py`. An adopter copies this
file into the repository that owns the stack, drops the `.example` suffix,
edits CARRIER and MODULE_CONTRACT (the only blocks meant to be edited), and
wires it as a required check.

Why an importer. This file used to carry its own copy of six checkers, and the
copy drifted: it returned NO violations for a loop body that hard-coded
`jq -r .sha` and compared the served sha to the OVERLAY clone's HEAD — the two
fatals the module suite now forbids by name. Three tests for one law is not
redundancy, it is three answers to one question, and the stalest answer is the
one that certifies the defect. The SSOT rule is reference, never duplication;
a checker copied into a tenant repository is a forked law with a tenant's name
on it.

What moved where:

  * Loop-body laws — digest-not-tag, edge-assert, kill-switch ordering,
    two-locks, no-trigger-surface — belong to the MODULE and are proven in
    `tests/test_converge_agent_contract.py`, by executing the shipped loop.
    A tenant does not re-verify a loop it did not write, and the addendum
    (§2, §11) forbids it from writing one.
  * Tenant-declaration laws stay here, called from the shipped library:
    the carrier is declared inside the stack it converges; no bespoke loop
    sits beside it; no workflow reaches the stack or its state key; the
    reviewed document carries a boolean `enabled` and a distinct boolean
    `armed`; any `destroy_admission` enumerates exact addresses with a reason;
    the stack declares `ephemeral` and production declares it false; every
    durable-data resource carries `prevent_destroy` and is declared to the
    carrier; and a declared call-site gate variable defaults false.

Contract statement: docs/patterns/converge-agent.md and
docs/patterns/stateful-workload-convergence.md.

This scaffold declares no carrier, so the conformance test skips here. It runs
for real in the adopting repository.
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# ------------------------------------------------------- MODULE_CONTRACT ---
# Where the materialized module's shipped contract library lives, relative to
# the repository root. An adopter that materializes the module under a
# different path edits this one line — and edits nothing else about the laws.
MODULE_CONTRACT = "modules/converge_agent/contract"
# -----------------------------------------------------------------------------

sys.path.insert(0, str(ROOT / MODULE_CONTRACT))

import tenant_contract  # noqa: E402  (path is established immediately above)

# ---------------------------------------------------------------- CARRIER ---
# The only adopter-edited block. Paths are repository-relative. Its shape is
# tenant_contract.CARRIER_TEMPLATE; see that file for what each key means.
CARRIER = {
    "stack_dir": "tofu/stacks/application",
    "carrier_source": "tofu/stacks/application/converge-agent.tf",
    "workflow_state_document": "config/workflow-state/production-converge.json",
    "state_key": "example-application/application/production.tfstate",
    "gate_variable": "",
    "durable_data_addresses": [],
}
# -----------------------------------------------------------------------------


class ProductConformanceTests(unittest.TestCase):
    """The adopting repository must satisfy its own carrier contract."""

    def test_declared_carrier_conforms(self) -> None:
        if not (ROOT / CARRIER["carrier_source"]).is_file():
            self.skipTest("no carrier declared in this repository")
        self.assertEqual([], tenant_contract.tenant_violations(ROOT, CARRIER))


class ImporterShapeTests(unittest.TestCase):
    """The importer must stay an importer.

    These two tests are the whole reason this file can be trusted after the
    consolidation: they fail if the shipped library goes missing (an adopter
    that copied the test but not the module) and if the adopter's CARRIER dict
    drifts from the shape the library expects (a key silently ignored is a law
    silently unenforced).
    """

    def test_shipped_library_is_the_source_of_the_laws(self) -> None:
        self.assertTrue(
            (ROOT / MODULE_CONTRACT / "tenant_contract.py").is_file(),
            "the module's shipped contract library is missing; this file"
            " enforces nothing without it, and reimplementing a checker here"
            " would fork the law",
        )

    def test_carrier_declares_exactly_the_documented_keys(self) -> None:
        self.assertEqual(
            sorted(tenant_contract.CARRIER_TEMPLATE),
            sorted(CARRIER),
            "CARRIER must carry exactly the keys the shipped library reads:"
            " an extra key is ignored, a missing key is a law that never runs",
        )


if __name__ == "__main__":
    unittest.main()
