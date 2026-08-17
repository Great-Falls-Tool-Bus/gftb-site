#!/usr/bin/env python3
"""Strict, dependency-free validator for application owner-overlay documents."""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path
from typing import Any


class DuplicateKeyError(ValueError):
    """Raised when an authority document contains duplicate JSON keys."""


def _reject_duplicate_keys(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise DuplicateKeyError(f"duplicate JSON key: {key}")
        result[key] = value
    return result


def load_json_strict_text(payload: str) -> Any:
    return json.loads(payload, object_pairs_hook=_reject_duplicate_keys)


APPLICATION_SOURCE_ROLES = frozenset(
    {
        "app-stateful-spoke",
        "mothership",
        "static-spoke",
    }
)

CORE_CAPABILITIES = frozenset(
    {
        "owns_application_image_pins",
        "owns_application_state",
        "owns_application_workloads",
        "owns_protected_plan_apply",
        "owns_reaping",
        "owns_runtime_receipts",
        "owns_secret_declarations",
    }
)

OPTIONAL_CAPABILITIES = frozenset(
    {
        "owns_application_database",
        "owns_application_mail_policy",
        "owns_application_zone_dns",
    }
)

EXPECTED_SHARED_CLASSES = {
    "cluster": "consumer-neutral-cluster-substrate",
    "execution_products": "reusable-execution-products",
    "host_policy": "host-policy-and-credential-projection",
}

REPOSITORY_RE = re.compile(r"^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$")
DEFAULT_BRANCH_RE = re.compile(
    r"^(?!/)(?!.*(?:^|/)\.\.(?:/|$))[A-Za-z0-9._/-]+$"
)
WORKFLOW_PATH_RE = re.compile(
    r"^\.github/workflows/[A-Za-z0-9_.-]+\.(?:yml|yaml)$"
)
ARTIFACT_REPOSITORY_RE = re.compile(
    r"^ghcr\.io/[A-Za-z0-9_.-]+(?:/[A-Za-z0-9_.-]+)+$"
)
RELATIVE_JSON_PATH_RE = re.compile(
    r"^(?!/)(?!.*(?:^|/)\.\.(?:/|$))[A-Za-z0-9._/-]+\.json$"
)
APPLICATION_SLUG_RE = re.compile(r"^[a-z][a-z0-9-]{1,62}$")
COMMIT_SHA_RE = re.compile(r"^(?!0{40}$)[0-9a-f]{40}$")


def _exact_keys(
    value: dict[str, Any],
    *,
    path: str,
    required: set[str] | frozenset[str],
    optional: set[str] | frozenset[str] = frozenset(),
) -> list[str]:
    errors: list[str] = []
    actual = set(value)
    missing = sorted(set(required) - actual)
    unknown = sorted(actual - set(required) - set(optional))
    if missing:
        errors.append(f"{path}: missing keys {missing!r}")
    if unknown:
        errors.append(f"{path}: unknown keys {unknown!r}")
    return errors


def _object(value: Any, *, path: str, errors: list[str]) -> dict[str, Any] | None:
    if not isinstance(value, dict):
        errors.append(f"{path}: expected object")
        return None
    return value


def _string_pattern(
    value: Any,
    *,
    path: str,
    pattern: re.Pattern[str],
    errors: list[str],
    max_length: int | None = None,
) -> None:
    if not isinstance(value, str):
        errors.append(f"{path}: expected string")
        return
    if max_length is not None and len(value) > max_length:
        errors.append(f"{path}: exceeds {max_length} characters")
    if not pattern.fullmatch(value):
        errors.append(f"{path}: invalid value")


def _repository(value: Any, *, path: str, errors: list[str]) -> None:
    _string_pattern(value, path=path, pattern=REPOSITORY_RE, errors=errors)


def _repo_identity(value: str) -> str:
    return value.casefold()


def validate_document(instance: Any) -> list[str]:
    errors: list[str] = []
    document = _object(instance, path="$", errors=errors)
    if document is None:
        return errors

    errors.extend(
        _exact_keys(
            document,
            path="$",
            required={
                "application_binding",
                "application_source",
                "capabilities",
                "owner_overlay",
                "schema_version",
                "shared_substrates",
            },
            optional={"$comment", "$schema"},
        )
    )

    if type(document.get("schema_version")) is not int:
        errors.append("$.schema_version: expected integer")
    elif document["schema_version"] != 1:
        errors.append("$.schema_version: expected 1")
    for optional_string in ("$comment", "$schema"):
        if optional_string in document and not isinstance(
            document[optional_string], str
        ):
            errors.append(f"$.{optional_string}: expected string")

    source = _object(
        document.get("application_source"),
        path="$.application_source",
        errors=errors,
    )
    if source is not None:
        errors.extend(
            _exact_keys(
                source,
                path="$.application_source",
                required={
                    "artifact_workflow",
                    "default_branch",
                    "repository",
                    "role",
                },
            )
        )
        _repository(
            source.get("repository"),
            path="$.application_source.repository",
            errors=errors,
        )
        role = source.get("role")
        if not isinstance(role, str) or role not in APPLICATION_SOURCE_ROLES:
            errors.append("$.application_source.role: not an application source role")
        _string_pattern(
            source.get("default_branch"),
            path="$.application_source.default_branch",
            pattern=DEFAULT_BRANCH_RE,
            errors=errors,
            max_length=255,
        )
        _string_pattern(
            source.get("artifact_workflow"),
            path="$.application_source.artifact_workflow",
            pattern=WORKFLOW_PATH_RE,
            errors=errors,
        )

    overlay = _object(
        document.get("owner_overlay"),
        path="$.owner_overlay",
        errors=errors,
    )
    if overlay is not None:
        status = overlay.get("binding_status")
        required_overlay_keys = {
            "authority_class",
            "binding_status",
            "repository",
        }
        optional_overlay_keys: set[str] = set()
        if status == "receipt-recorded":
            required_overlay_keys.add("binding_receipt")
        else:
            optional_overlay_keys.add("binding_receipt")
        errors.extend(
            _exact_keys(
                overlay,
                path="$.owner_overlay",
                required=required_overlay_keys,
                optional=optional_overlay_keys,
            )
        )
        _repository(
            overlay.get("repository"),
            path="$.owner_overlay.repository",
            errors=errors,
        )
        if overlay.get("authority_class") != "application-owner-overlay":
            errors.append(
                "$.owner_overlay.authority_class: expected application-owner-overlay"
            )
        if not isinstance(status, str) or status not in {
            "declared",
            "receipt-recorded",
        }:
            errors.append("$.owner_overlay.binding_status: invalid value")
        if status == "declared" and "binding_receipt" in overlay:
            errors.append(
                "$.owner_overlay.binding_receipt: forbidden while binding is declared"
            )

        if "binding_receipt" in overlay:
            receipt = _object(
                overlay["binding_receipt"],
                path="$.owner_overlay.binding_receipt",
                errors=errors,
            )
            if receipt is not None:
                errors.extend(
                    _exact_keys(
                        receipt,
                        path="$.owner_overlay.binding_receipt",
                        required={
                            "commit_sha",
                            "document_pointer",
                            "path",
                            "repository",
                        },
                    )
                )
                _repository(
                    receipt.get("repository"),
                    path="$.owner_overlay.binding_receipt.repository",
                    errors=errors,
                )
                _string_pattern(
                    receipt.get("commit_sha"),
                    path="$.owner_overlay.binding_receipt.commit_sha",
                    pattern=COMMIT_SHA_RE,
                    errors=errors,
                )
                _string_pattern(
                    receipt.get("path"),
                    path="$.owner_overlay.binding_receipt.path",
                    pattern=RELATIVE_JSON_PATH_RE,
                    errors=errors,
                )
                if receipt.get("document_pointer") != "/application_binding":
                    errors.append(
                        "$.owner_overlay.binding_receipt.document_pointer: "
                        "expected /application_binding"
                    )
                overlay_repository = overlay.get("repository")
                receipt_repository = receipt.get("repository")
                if isinstance(overlay_repository, str) and isinstance(
                    receipt_repository, str
                ):
                    if _repo_identity(overlay_repository) != _repo_identity(
                        receipt_repository
                    ):
                        errors.append(
                            "$.owner_overlay.binding_receipt.repository: "
                            "must match owner overlay"
                        )

    binding = _object(
        document.get("application_binding"),
        path="$.application_binding",
        errors=errors,
    )
    if binding is not None:
        errors.extend(
            _exact_keys(
                binding,
                path="$.application_binding",
                required={
                    "application_slug",
                    "artifact_repository",
                    "artifact_workflow",
                    "default_branch",
                    "source_repository",
                    "source_role",
                },
            )
        )
        _repository(
            binding.get("source_repository"),
            path="$.application_binding.source_repository",
            errors=errors,
        )
        source_role = binding.get("source_role")
        if (
            not isinstance(source_role, str)
            or source_role not in APPLICATION_SOURCE_ROLES
        ):
            errors.append(
                "$.application_binding.source_role: not an application source role"
            )
        _string_pattern(
            binding.get("application_slug"),
            path="$.application_binding.application_slug",
            pattern=APPLICATION_SLUG_RE,
            errors=errors,
        )
        _string_pattern(
            binding.get("default_branch"),
            path="$.application_binding.default_branch",
            pattern=DEFAULT_BRANCH_RE,
            errors=errors,
            max_length=255,
        )
        _string_pattern(
            binding.get("artifact_repository"),
            path="$.application_binding.artifact_repository",
            pattern=ARTIFACT_REPOSITORY_RE,
            errors=errors,
        )
        _string_pattern(
            binding.get("artifact_workflow"),
            path="$.application_binding.artifact_workflow",
            pattern=WORKFLOW_PATH_RE,
            errors=errors,
        )

    capabilities = _object(
        document.get("capabilities"),
        path="$.capabilities",
        errors=errors,
    )
    if capabilities is not None:
        all_capabilities = CORE_CAPABILITIES | OPTIONAL_CAPABILITIES
        errors.extend(
            _exact_keys(
                capabilities,
                path="$.capabilities",
                required=all_capabilities,
            )
        )
        for name in sorted(CORE_CAPABILITIES):
            if capabilities.get(name) is not True:
                errors.append(f"$.capabilities.{name}: expected true")
        for name in sorted(OPTIONAL_CAPABILITIES):
            if type(capabilities.get(name)) is not bool:
                errors.append(f"$.capabilities.{name}: expected boolean")

    shared = _object(
        document.get("shared_substrates"),
        path="$.shared_substrates",
        errors=errors,
    )
    if shared is not None:
        errors.extend(
            _exact_keys(
                shared,
                path="$.shared_substrates",
                required=set(EXPECTED_SHARED_CLASSES),
            )
        )
        for name, expected_class in EXPECTED_SHARED_CLASSES.items():
            authority = _object(
                shared.get(name),
                path=f"$.shared_substrates.{name}",
                errors=errors,
            )
            if authority is None:
                continue
            errors.extend(
                _exact_keys(
                    authority,
                    path=f"$.shared_substrates.{name}",
                    required={"authority_class", "repository"},
                )
            )
            _repository(
                authority.get("repository"),
                path=f"$.shared_substrates.{name}.repository",
                errors=errors,
            )
            if authority.get("authority_class") != expected_class:
                errors.append(
                    f"$.shared_substrates.{name}.authority_class: "
                    f"expected {expected_class}"
                )

    if source is not None and binding is not None:
        source_fields = {
            "repository": "source_repository",
            "role": "source_role",
            "default_branch": "default_branch",
            "artifact_workflow": "artifact_workflow",
        }
        for source_field, binding_field in source_fields.items():
            if source.get(source_field) != binding.get(binding_field):
                errors.append(
                    f"$.application_source.{source_field}: must match "
                    f"$.application_binding.{binding_field}"
                )

    if source is not None and overlay is not None:
        source_repository = source.get("repository")
        overlay_repository = overlay.get("repository")
        if isinstance(source_repository, str) and isinstance(
            overlay_repository, str
        ):
            if _repo_identity(source_repository) == _repo_identity(
                overlay_repository
            ):
                errors.append(
                    "$.owner_overlay.repository: must not self-bind to source"
                )

    if overlay is not None and shared is not None:
        overlay_repository = overlay.get("repository")
        if isinstance(overlay_repository, str):
            for name, authority in shared.items():
                if not isinstance(authority, dict):
                    continue
                repository = authority.get("repository")
                if isinstance(repository, str) and _repo_identity(
                    repository
                ) == _repo_identity(overlay_repository):
                    errors.append(
                        f"$.shared_substrates.{name}.repository: "
                        "must not impersonate owner overlay"
                    )

    return errors


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Validate one application owner-overlay JSON document."
    )
    parser.add_argument("document", type=Path)
    args = parser.parse_args()

    try:
        instance = load_json_strict_text(
            args.document.read_text(encoding="utf-8")
        )
    except (OSError, UnicodeError, json.JSONDecodeError, DuplicateKeyError) as exc:
        print(f"{args.document}: {exc}")
        return 2

    errors = validate_document(instance)
    if errors:
        for error in errors:
            print(f"{args.document}: {error}")
        return 1
    print(f"{args.document}: valid application owner-overlay contract")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
