#!/usr/bin/env python3
"""Adversarial tests for the application owner-overlay contract."""

from __future__ import annotations

import copy
import json
import os
import unittest
from pathlib import Path
from typing import Any

from validate_application_owner_overlay import (
    APPLICATION_SOURCE_ROLES,
    CORE_CAPABILITIES,
    EXPECTED_SHARED_CLASSES,
    OPTIONAL_CAPABILITIES,
    DuplicateKeyError,
    load_json_strict_text,
    validate_document,
)


def workspace_root() -> Path:
    test_srcdir = os.environ.get("TEST_SRCDIR")
    test_workspace = os.environ.get("TEST_WORKSPACE")
    if test_srcdir and test_workspace:
        return Path(test_srcdir) / test_workspace
    return Path(__file__).resolve().parent.parent


ROOT = workspace_root()
SCHEMA_PATH = ROOT / "docs/schemas/application-owner-overlay.schema.json"
CANONICAL_SCHEMA_PATH = ROOT / "docs/schemas/tinyland-repo-manifest.schema.json"
V2_SCHEMA_PATH = ROOT / "docs/schemas/tinyland-repo-manifest.v2.schema.json"
FIXTURE_PATH = ROOT / "tests/fixtures/application-owner-overlay.json"
SCHEMA = load_json_strict_text(SCHEMA_PATH.read_text(encoding="utf-8"))
CANONICAL_SCHEMA = load_json_strict_text(
    CANONICAL_SCHEMA_PATH.read_text(encoding="utf-8")
)
V2_SCHEMA = load_json_strict_text(V2_SCHEMA_PATH.read_text(encoding="utf-8"))
FIXTURE_TEXT = FIXTURE_PATH.read_text(encoding="utf-8")
FIXTURE = load_json_strict_text(FIXTURE_TEXT)


class ApplicationOwnerOverlayContractTests(unittest.TestCase):
    def fixture(self) -> dict[str, Any]:
        return copy.deepcopy(FIXTURE)

    def receipt_recorded_fixture(self) -> dict[str, Any]:
        instance = self.fixture()
        instance["owner_overlay"]["binding_status"] = "receipt-recorded"
        instance["owner_overlay"]["binding_receipt"] = {
            "repository": instance["owner_overlay"]["repository"],
            "commit_sha": "1" * 40,
            "path": "config/application-owner-overlay.json",
            "document_pointer": "/application_binding",
        }
        return instance

    def assert_valid(self, instance: dict[str, Any]) -> None:
        errors = validate_document(instance)
        self.assertEqual([], errors, "\n".join(errors))

    def assert_invalid(
        self, instance: dict[str, Any], fragment: str | None = None
    ) -> None:
        errors = validate_document(instance)
        self.assertTrue(errors)
        if fragment is not None:
            self.assertTrue(
                any(fragment in error for error in errors),
                f"expected {fragment!r}; observed {errors!r}",
            )

    def test_canonical_fixture_validates(self) -> None:
        self.assert_valid(self.fixture())

    def test_schema_and_validator_share_the_application_role_subset(self) -> None:
        schema_roles = set(SCHEMA["$defs"]["sourceRole"]["enum"])
        canonical_roles = set(CANONICAL_SCHEMA["$defs"]["repoRole"]["enum"])
        self.assertEqual(set(APPLICATION_SOURCE_ROLES), schema_roles)
        self.assertLessEqual(schema_roles, canonical_roles)

    def test_v1_static_roles_cannot_declare_gitops_receiver(self) -> None:
        expected_roles = {"static-spoke", "static-spoke-scaffold"}
        matching_rules = []
        for rule in CANONICAL_SCHEMA["allOf"]:
            primary_role = (
                rule.get("if", {})
                .get("properties", {})
                .get("taxonomy", {})
                .get("properties", {})
                .get("primary_role", {})
            )
            if set(primary_role.get("enum", [])) == expected_roles:
                matching_rules.append(rule)

        self.assertEqual(1, len(matching_rules))
        authorities = matching_rules[0]["then"]["properties"]["authorities"]
        self.assertEqual(
            {"required": ["gitops_receiver"]},
            authorities["not"],
        )

    def test_schema_and_validator_share_capability_keys(self) -> None:
        schema_capabilities = SCHEMA["$defs"]["capabilities"]["properties"]
        self.assertEqual(
            set(CORE_CAPABILITIES | OPTIONAL_CAPABILITIES),
            set(schema_capabilities),
        )
        for capability in CORE_CAPABILITIES:
            self.assertIs(schema_capabilities[capability]["const"], True)
        for capability in OPTIONAL_CAPABILITIES:
            self.assertEqual(schema_capabilities[capability]["type"], "boolean")

    def test_artifact_repository_may_differ_from_source_repository(self) -> None:
        instance = self.fixture()
        self.assertNotEqual(
            instance["application_source"]["repository"],
            instance["application_binding"]["artifact_repository"],
        )
        instance["application_binding"]["artifact_repository"] = (
            "ghcr.io/independent-publisher/application-release"
        )
        self.assert_valid(instance)

    def test_optional_dns_database_and_mail_capabilities_may_remain_false(self) -> None:
        instance = self.fixture()
        for capability in OPTIONAL_CAPABILITIES:
            self.assertIs(instance["capabilities"][capability], False)
        self.assert_valid(instance)

    def test_v2_owner_overlay_provider_capabilities_are_independent_booleans(
        self,
    ) -> None:
        role_branches = [
            branch
            for branch in V2_SCHEMA["allOf"]
            if branch.get("if", {})
            .get("properties", {})
            .get("taxonomy", {})
            .get("properties", {})
            .get("primary_role", {})
            .get("const")
            == "application-owner-overlay"
        ]
        self.assertEqual(1, len(role_branches))
        role_properties = role_branches[0]["then"]["properties"]["boundaries"][
            "properties"
        ]
        for capability in (
            "owns_cloudflare_mutation",
            "owns_application_zone_dns",
            "owns_application_database",
        ):
            with self.subTest(capability=capability):
                self.assertEqual({"type": "boolean"}, role_properties[capability])

    def test_multi_application_binding_is_rejected(self) -> None:
        instance = self.fixture()
        instance["application_binding"] = [
            copy.deepcopy(FIXTURE["application_binding"]),
            copy.deepcopy(FIXTURE["application_binding"]),
        ]
        self.assert_invalid(instance, "$.application_binding: expected object")

        instance = self.fixture()
        instance["application_bindings"] = [
            copy.deepcopy(FIXTURE["application_binding"]),
            copy.deepcopy(FIXTURE["application_binding"]),
        ]
        self.assert_invalid(instance, "unknown keys")

    def test_owner_overlay_cannot_self_bind_to_application_source(self) -> None:
        instance = self.fixture()
        instance["owner_overlay"]["repository"] = instance[
            "application_source"
        ]["repository"].swapcase()
        self.assert_invalid(instance, "must not self-bind")

    def test_shared_substrate_cannot_impersonate_owner_overlay(self) -> None:
        for substrate in EXPECTED_SHARED_CLASSES:
            with self.subTest(substrate=substrate):
                instance = self.fixture()
                instance["owner_overlay"]["repository"] = instance[
                    "shared_substrates"
                ][substrate]["repository"].swapcase()
                self.assert_invalid(instance, "must not impersonate")

    def test_undeclared_capability_is_rejected(self) -> None:
        instance = self.fixture()
        instance["capabilities"]["owns_unreviewed_provider_account"] = True
        self.assert_invalid(instance, "unknown keys")

    def test_receipt_recorded_binding_requires_immutable_receipt_claim(self) -> None:
        instance = self.fixture()
        instance["owner_overlay"]["binding_status"] = "receipt-recorded"
        self.assert_invalid(instance, "missing keys")

        instance = self.receipt_recorded_fixture()
        instance["owner_overlay"]["binding_receipt"]["commit_sha"] = "0" * 40
        self.assert_invalid(instance, "commit_sha")

        instance = self.receipt_recorded_fixture()
        instance["owner_overlay"]["binding_status"] = "declared"
        self.assert_invalid(instance, "forbidden while binding is declared")

        instance = self.receipt_recorded_fixture()
        instance["owner_overlay"]["binding_receipt"]["repository"] = (
            "example/other-overlay"
        )
        self.assert_invalid(instance, "must match owner overlay")

        self.assert_valid(self.receipt_recorded_fixture())

    def test_source_and_binding_identity_must_match(self) -> None:
        mutations = {
            "source_repository": "example/other-application",
            "source_role": "static-spoke",
            "default_branch": "release",
            "artifact_workflow": ".github/workflows/other-publisher.yml",
        }
        for field, value in mutations.items():
            with self.subTest(field=field):
                instance = self.fixture()
                instance["application_binding"][field] = value
                self.assert_invalid(instance, f"$.application_binding.{field}")

    def test_aliases_are_rejected(self) -> None:
        mutations = (
            ((), "owner_overlay", "ownerOverlay"),
            (("application_binding",), "source_repository", "sourceRepository"),
            (
                ("capabilities",),
                "owns_application_mail_policy",
                "ownsApplicationMailPolicy",
            ),
        )
        for path, canonical, alias in mutations:
            with self.subTest(alias=alias):
                instance = self.fixture()
                container: dict[str, Any] = instance
                for component in path:
                    container = container[component]
                container[alias] = container.pop(canonical)
                self.assert_invalid(instance)

    def test_nested_field_substitution_is_rejected(self) -> None:
        instance = self.fixture()
        artifact_repository = instance["application_binding"].pop(
            "artifact_repository"
        )
        instance["application_binding"]["artifact"] = {
            "repository": artifact_repository
        }
        self.assert_invalid(instance)

    def test_duplicate_json_keys_are_rejected_before_validation(self) -> None:
        duplicate_top_level = FIXTURE_TEXT.replace(
            '"schema_version": 1,',
            '"schema_version": 1,\n\t"schema_version": 1,',
            1,
        )
        with self.assertRaises(DuplicateKeyError):
            load_json_strict_text(duplicate_top_level)

        duplicate_nested = FIXTURE_TEXT.replace(
            '"source_repository": "example/example-application",',
            '"source_repository": "example/example-application",\n'
            '\t\t"source_repository": "example/other-application",',
            1,
        )
        with self.assertRaises(DuplicateKeyError):
            load_json_strict_text(duplicate_nested)

    def test_null_entries_are_rejected(self) -> None:
        mutations = (
            (("application_source", "repository"), None),
            (("owner_overlay",), None),
            (("shared_substrates", "cluster"), None),
            (("capabilities", "owns_application_mail_policy"), None),
        )
        for path, value in mutations:
            with self.subTest(path=path):
                instance = self.fixture()
                container: dict[str, Any] = instance
                for component in path[:-1]:
                    container = container[component]
                container[path[-1]] = value
                self.assert_invalid(instance)

    def test_invalid_binding_receipt_json_pointers_are_rejected(self) -> None:
        for pointer in (
            "",
            "application_binding",
            "/application_binding/~",
            "/application_binding/~2invalid",
            "/other_binding",
        ):
            with self.subTest(pointer=pointer):
                instance = self.receipt_recorded_fixture()
                instance["owner_overlay"]["binding_receipt"][
                    "document_pointer"
                ] = pointer
                self.assert_invalid(instance, "document_pointer")

    def test_type_confusion_is_rejected(self) -> None:
        mutations = (
            (("application_binding",), []),
            (("application_binding", "source_role"), {}),
            (("application_source", "role"), []),
            (("owner_overlay", "repository"), ["example", "overlay"]),
            (("owner_overlay", "binding_status"), []),
            (("capabilities",), "all"),
            (("shared_substrates", "cluster"), "example/shared-cluster"),
            (("schema_version",), "1"),
        )
        for path, value in mutations:
            with self.subTest(path=path):
                instance = self.fixture()
                container: dict[str, Any] = instance
                for component in path[:-1]:
                    container = container[component]
                container[path[-1]] = value
                self.assert_invalid(instance)

    def test_shared_authority_classes_are_position_bound(self) -> None:
        for substrate, expected_class in EXPECTED_SHARED_CLASSES.items():
            with self.subTest(substrate=substrate):
                instance = self.fixture()
                other_class = next(
                    value
                    for value in EXPECTED_SHARED_CLASSES.values()
                    if value != expected_class
                )
                instance["shared_substrates"][substrate][
                    "authority_class"
                ] = other_class
                self.assert_invalid(
                    instance,
                    f"$.shared_substrates.{substrate}.authority_class",
                )

    def test_schema_document_is_strict_json(self) -> None:
        self.assertIsInstance(SCHEMA, dict)
        self.assertEqual(
            "https://json-schema.org/draft/2020-12/schema",
            SCHEMA["$schema"],
        )
        with self.assertRaises((DuplicateKeyError, json.JSONDecodeError)):
            load_json_strict_text('{"duplicate": true, "duplicate": false}')


if __name__ == "__main__":
    unittest.main()
