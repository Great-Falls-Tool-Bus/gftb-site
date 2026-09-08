#!/usr/bin/env python3
"""Regression checks for the minimal static-site and OCI entrypoints."""

from __future__ import annotations

import hashlib
import json
import os
import re
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import bazel_output
from bazel_output import (
    MATERIALIZED_OUTPUT_NAMES,
    OutputError,
    adapter_contract,
    materialize_tree,
    preview_command,
    resolve_materialize_destination,
)


ROOT = Path(__file__).resolve().parent.parent
CI_TEMPLATES_V4_REF = "32e39ced0008edf4564ebeb173a5e8fbf069e28f"
SCAFFOLD_SCHEMA_HEAD = "0abc7f9e93bf4b84c7550684c38fbf822eab7cd0"
SCAFFOLD_SCHEMA_SHA256 = "9f60d0934e23f1f2437faade24630249b77c303b00d92cf372d1a4fc5252d83c"
APPROVED_QR_SHA256 = "e72aeb84cf028b2d1070cd916925ac1b82869cc7874ba856e33f88478b900580"


def recipe(justfile: str, name: str) -> str:
    lines = justfile.splitlines()
    start = next(i for i, line in enumerate(lines) if line.startswith(f"{name}:") or line.startswith(f"{name} "))
    body = [lines[start]]
    for line in lines[start + 1 :]:
        if line and not line.startswith((" ", "\t", "#")):
            break
        body.append(line)
    return "\n".join(body)


def bazel_target(build_file: str, name: str) -> str:
    marker = f'    name = "{name}",'
    marker_offset = build_file.index(marker)
    start = build_file.rfind("\n", 0, marker_offset - 1) + 1
    end = build_file.index("\n)\n", marker_offset) + 3
    return build_file[start:end]


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def nested_keys(value: object) -> set[str]:
    if isinstance(value, dict):
        return set(value) | set().union(*(nested_keys(child) for child in value.values()))
    if isinstance(value, list):
        return set().union(*(nested_keys(child) for child in value))
    return set()


class StaticOutputTests(unittest.TestCase):
    @staticmethod
    def _transaction_residues(root: Path) -> list[Path]:
        return sorted(
            (
                child
                for child in root.iterdir()
                if child.name.startswith(
                    (".build.previous-", ".build.materialize-", ".build.transaction-")
                )
            ),
            key=lambda child: child.name,
        )

    @staticmethod
    def _tree_bytes(root: Path) -> dict[str, bytes]:
        return {
            str(path.relative_to(root)): path.read_bytes()
            for path in sorted(root.rglob("*"))
            if path.is_file()
        }

    def test_static_output_materializes_once_into_absent_destination(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            manifest = root / "tinyland.repo.json"
            manifest.write_text(json.dumps({"taxonomy": {"primary_role": "static-spoke"}}))
            source = root / "bazel-bin" / "build"
            destination = root / "build"
            source.mkdir(parents=True)
            (source / "index.html").write_text("new", encoding="utf-8")

            contract = adapter_contract(manifest)
            materialize_tree(source, Path("build"), contract.required_entrypoint, manifest)
            command, _ = preview_command(destination, contract, "127.0.0.1", 4173)

            self.assertEqual(contract.name, "adapter-static")
            self.assertEqual((destination / "index.html").read_text(encoding="utf-8"), "new")
            self.assertIn("serve-static", command)
            self.assertEqual(self._transaction_residues(root), [])

    def test_second_materialization_fails_before_transaction_and_preserves_exact_bytes(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            manifest = root / "tinyland.repo.json"
            manifest.write_text('{"taxonomy":{"primary_role":"static-spoke"}}', encoding="utf-8")
            first_source = root / "bazel-bin" / "first"
            second_source = root / "bazel-bin" / "second"
            destination = root / "build"
            (first_source / "nested").mkdir(parents=True)
            second_source.mkdir(parents=True)
            (first_source / "index.html").write_bytes(b"first\x00bytes")
            (first_source / "nested" / "asset.bin").write_bytes(b"\x00\xffstable")
            (second_source / "index.html").write_bytes(b"second")

            materialize_tree(first_source, Path("build"), Path("index.html"), manifest)
            before = self._tree_bytes(destination)

            with self.assertRaisesRegex(OutputError, "destination already exists"):
                materialize_tree(second_source, Path("build"), Path("index.html"), manifest)

            self.assertEqual(self._tree_bytes(destination), before)
            self.assertEqual(self._transaction_residues(root), [])

    def _assert_preexisting_residue_is_preserved(
        self,
        residue_name: str,
        *,
        symlink: bool = False,
        regular_file: bool = False,
    ) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            container = Path(temporary)
            root = container / "repo"
            source = root / "bazel-bin" / "build"
            destination = root / "build"
            manifest = root / "tinyland.repo.json"
            source.mkdir(parents=True)
            (source / "index.html").write_text("new", encoding="utf-8")
            manifest.write_text('{"taxonomy":{"primary_role":"static-spoke"}}', encoding="utf-8")

            residue = root / residue_name
            if symlink:
                residue_target = container / "residue-target"
                residue_target.mkdir()
                sentinel = residue_target / "sentinel"
                sentinel.write_text("must survive", encoding="utf-8")
                residue.symlink_to(residue_target, target_is_directory=True)
            elif regular_file:
                residue.write_text("must survive", encoding="utf-8")
                sentinel = residue
            else:
                residue.mkdir()
                sentinel = residue / "sentinel"
                sentinel.write_text("must survive", encoding="utf-8")

            with self.assertRaisesRegex(OutputError, "pre-existing materialization residue"):
                materialize_tree(source, Path("build"), Path("index.html"), manifest)

            self.assertFalse(os.path.lexists(destination))
            if symlink:
                self.assertTrue(residue.is_symlink())
            elif regular_file:
                self.assertTrue(residue.is_file())
            else:
                self.assertTrue(residue.is_dir())
            self.assertEqual(sentinel.read_text(encoding="utf-8"), "must survive")

    def test_preexisting_legacy_previous_residue_is_preserved(self) -> None:
        self._assert_preexisting_residue_is_preserved(".build.previous-hostile")

    def test_preexisting_legacy_stage_residue_is_preserved(self) -> None:
        self._assert_preexisting_residue_is_preserved(".build.materialize-hostile")

    def test_preexisting_current_transaction_residue_is_preserved(self) -> None:
        self._assert_preexisting_residue_is_preserved(".build.transaction-hostile")

    def test_preexisting_symlink_residue_is_preserved(self) -> None:
        self._assert_preexisting_residue_is_preserved(".build.transaction-symlink", symlink=True)

    def test_preexisting_regular_file_residue_is_preserved(self) -> None:
        self._assert_preexisting_residue_is_preserved(
            ".build.transaction-regular-file",
            regular_file=True,
        )

    def test_different_mnt_id_refuses_publish_and_retains_transaction(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            manifest = root / "tinyland.repo.json"
            source = root / "bazel-bin" / "build"
            destination = root / "build"
            manifest.write_text('{"taxonomy":{"primary_role":"static-spoke"}}', encoding="utf-8")
            source.mkdir(parents=True)
            (source / "index.html").write_text("new", encoding="utf-8")

            with mock.patch("bazel_output._mount_identity", side_effect=[(7, 101), (7, 202)]):
                with self.assertRaisesRegex(OutputError, "mount boundary"):
                    materialize_tree(source, Path("build"), Path("index.html"), manifest)

            self.assertFalse(os.path.lexists(destination))
            residues = self._transaction_residues(root)
            self.assertEqual(len(residues), 1)
            self.assertEqual(list(residues[0].iterdir()), [])

    def test_copy_failure_retains_partial_transaction_without_external_mutation(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            manifest = root / "tinyland.repo.json"
            manifest.write_text('{"taxonomy":{"primary_role":"static-spoke"}}', encoding="utf-8")
            source = root / "bazel-bin" / "build"
            destination = root / "build"
            external = root / "external"
            source.mkdir(parents=True)
            external.mkdir()
            (source / "index.html").write_text("new", encoding="utf-8")
            sentinel = external / "sentinel"
            sentinel.write_text("must survive", encoding="utf-8")

            def copy_partially_then_fail(
                _source_path: str | os.PathLike[str],
                destination_path: str | os.PathLike[str],
                *,
                symlinks: bool = False,
            ) -> str | os.PathLike[str]:
                self.assertFalse(symlinks)
                stage = Path(destination_path)
                stage.mkdir()
                (stage / "partial").write_text("inspect me", encoding="utf-8")
                raise OSError("simulated copy failure")

            with mock.patch("bazel_output.shutil.copytree", side_effect=copy_partially_then_fail):
                with self.assertRaisesRegex(OSError, "simulated copy failure"):
                    materialize_tree(source, Path("build"), Path("index.html"), manifest)

            residues = self._transaction_residues(root)
            self.assertEqual(len(residues), 1)
            self.assertEqual((residues[0] / "stage" / "partial").read_text(encoding="utf-8"), "inspect me")
            self.assertFalse(os.path.lexists(destination))
            self.assertEqual(sentinel.read_text(encoding="utf-8"), "must survive")

    def test_validation_failure_retains_stage_without_external_mutation(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            manifest = root / "tinyland.repo.json"
            manifest.write_text('{"taxonomy":{"primary_role":"static-spoke"}}', encoding="utf-8")
            source = root / "bazel-bin" / "build"
            destination = root / "build"
            external = root / "external"
            source.mkdir(parents=True)
            external.mkdir()
            (source / "index.html").write_text("new", encoding="utf-8")
            sentinel = external / "sentinel"
            sentinel.write_text("must survive", encoding="utf-8")
            original_copytree = bazel_output.shutil.copytree

            def copy_without_required_file(
                source_path: str | os.PathLike[str],
                destination_path: str | os.PathLike[str],
                *,
                symlinks: bool = False,
            ) -> str | os.PathLike[str]:
                copied = original_copytree(source_path, destination_path, symlinks=symlinks)
                (Path(destination_path) / "index.html").unlink()
                return copied

            with mock.patch("bazel_output.shutil.copytree", side_effect=copy_without_required_file):
                with self.assertRaisesRegex(OutputError, "missing required file"):
                    materialize_tree(source, Path("build"), Path("index.html"), manifest)

            residues = self._transaction_residues(root)
            self.assertEqual(len(residues), 1)
            self.assertTrue((residues[0] / "stage").is_dir())
            self.assertFalse((residues[0] / "stage" / "index.html").exists())
            self.assertFalse(os.path.lexists(destination))
            self.assertEqual(sentinel.read_text(encoding="utf-8"), "must survive")

    def test_destination_publish_race_never_replaces_new_output(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            manifest = root / "tinyland.repo.json"
            manifest.write_text('{"taxonomy":{"primary_role":"static-spoke"}}', encoding="utf-8")
            source = root / "bazel-bin" / "build"
            destination = root / "build"
            source.mkdir(parents=True)
            (source / "index.html").write_text("new", encoding="utf-8")
            original_entry_exists = bazel_output._entry_exists_at
            checks = 0

            def inject_destination_after_final_precheck(parent_fd: int, name: str) -> bool:
                nonlocal checks
                checks += 1
                if checks == 2:
                    destination.mkdir()
                    (destination / "sentinel").write_text("must survive", encoding="utf-8")
                    return False
                return original_entry_exists(parent_fd, name)

            with mock.patch(
                "bazel_output._entry_exists_at",
                side_effect=inject_destination_after_final_precheck,
            ):
                with self.assertRaisesRegex(OutputError, "destination appeared before publish"):
                    materialize_tree(source, Path("build"), Path("index.html"), manifest)

            self.assertEqual((destination / "sentinel").read_text(encoding="utf-8"), "must survive")
            residues = self._transaction_residues(root)
            self.assertEqual(len(residues), 1)
            self.assertEqual((residues[0] / "stage" / "index.html").read_text(encoding="utf-8"), "new")

    def test_swapped_stage_symlink_preserves_external_sentinel_and_transaction(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            manifest = root / "tinyland.repo.json"
            manifest.write_text('{"taxonomy":{"primary_role":"static-spoke"}}', encoding="utf-8")
            source = root / "bazel-bin" / "build"
            destination = root / "build"
            external = root / "external"
            displaced_stage = root / "displaced-stage"
            source.mkdir(parents=True)
            external.mkdir()
            (source / "index.html").write_text("new", encoding="utf-8")
            sentinel = external / "sentinel"
            sentinel.write_text("must survive", encoding="utf-8")
            original_copytree = bazel_output.shutil.copytree

            def copy_then_swap_stage(
                source_path: str | os.PathLike[str],
                destination_path: str | os.PathLike[str],
                *,
                symlinks: bool = False,
            ) -> str | os.PathLike[str]:
                copied = original_copytree(source_path, destination_path, symlinks=symlinks)
                Path(destination_path).rename(displaced_stage)
                Path(destination_path).symlink_to(external, target_is_directory=True)
                return copied

            with mock.patch("bazel_output.shutil.copytree", side_effect=copy_then_swap_stage):
                with self.assertRaises(OutputError):
                    materialize_tree(source, Path("build"), Path("index.html"), manifest)

            self.assertEqual(sentinel.read_text(encoding="utf-8"), "must survive")
            self.assertFalse(os.path.lexists(destination))
            self.assertEqual((displaced_stage / "index.html").read_text(encoding="utf-8"), "new")
            residues = self._transaction_residues(root)
            self.assertEqual(len(residues), 1)
            self.assertTrue((residues[0] / "stage").is_symlink())
            self.assertEqual((residues[0] / "stage" / "sentinel").read_text(encoding="utf-8"), "must survive")

    def test_materialization_has_no_automatic_recursive_cleanup(self) -> None:
        implementation = (ROOT / "scripts/bazel_output.py").read_text(encoding="utf-8")
        for forbidden in (
            "shutil.rmtree",
            "_make_owner_writable",
            "_CleanupEntry",
            "_capture_cleanup_entries",
            "_delete_cleanup_entries",
            "_remove_owned_transaction",
            "os.walk(",
            ".chmod(",
            "os.fchmod(",
            "os.unlink(",
            "os.replace(",
        ):
            with self.subTest(forbidden=forbidden):
                self.assertNotIn(forbidden, implementation)
        self.assertEqual(implementation.count("os.rmdir("), 1)

    def test_materialize_destination_is_one_allowlisted_manifest_child(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            manifest = root / "tinyland.repo.json"
            manifest.write_text("{}", encoding="utf-8")
            for name in MATERIALIZED_OUTPUT_NAMES:
                with self.subTest(name=name):
                    self.assertEqual(resolve_materialize_destination(manifest, Path(name)), root / name)

    def test_materialize_destination_rejects_escape_shapes_before_mutation(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            container = Path(temporary)
            root = container / "repo"
            root.mkdir()
            manifest = root / "tinyland.repo.json"
            manifest.write_text("{}", encoding="utf-8")
            sentinel = container / "outside-sentinel"
            sentinel.write_text("must survive", encoding="utf-8")
            invalid = [
                Path(""),
                Path("."),
                Path(".."),
                Path("nested/build"),
                Path("../build"),
                root,
                root.parent / "outside-build",
                Path("/Users/example"),
                Path("not-allowlisted"),
            ]
            for destination in invalid:
                with self.subTest(destination=destination):
                    with self.assertRaises(OutputError):
                        resolve_materialize_destination(manifest, destination)
                    self.assertEqual(sentinel.read_text(encoding="utf-8"), "must survive")

    def test_materialize_destination_rejects_symlink_escape_and_preserves_target(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            container = Path(temporary)
            root = container / "repo"
            outside = container / "outside"
            root.mkdir()
            outside.mkdir()
            manifest = root / "tinyland.repo.json"
            manifest.write_text("{}", encoding="utf-8")
            sentinel = outside / "sentinel"
            sentinel.write_text("must survive", encoding="utf-8")
            (root / "build").symlink_to(outside, target_is_directory=True)

            with self.assertRaises(OutputError):
                resolve_materialize_destination(manifest, Path("build"))
            self.assertEqual(sentinel.read_text(encoding="utf-8"), "must survive")

    def test_existing_regular_file_destination_is_refused_and_preserved(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "bazel-bin" / "build"
            destination = root / "build"
            manifest = root / "tinyland.repo.json"
            source.mkdir(parents=True)
            (source / "index.html").write_text("new", encoding="utf-8")
            manifest.write_text('{"taxonomy":{"primary_role":"static-spoke"}}', encoding="utf-8")
            destination.write_bytes(b"must survive")

            with self.assertRaisesRegex(OutputError, "destination already exists"):
                materialize_tree(source, Path("build"), Path("index.html"), manifest)

            self.assertEqual(destination.read_bytes(), b"must survive")
            self.assertEqual(self._transaction_residues(root), [])

    def test_existing_broken_symlink_destination_is_refused_and_preserved(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "bazel-bin" / "build"
            destination = root / "build"
            manifest = root / "tinyland.repo.json"
            missing_target = root / "missing-target"
            source.mkdir(parents=True)
            (source / "index.html").write_text("new", encoding="utf-8")
            manifest.write_text('{"taxonomy":{"primary_role":"static-spoke"}}', encoding="utf-8")
            destination.symlink_to(missing_target, target_is_directory=True)

            with self.assertRaisesRegex(OutputError, "destination"):
                materialize_tree(source, Path("build"), Path("index.html"), manifest)

            self.assertTrue(destination.is_symlink())
            self.assertEqual(os.readlink(destination), os.fspath(missing_target))
            self.assertFalse(missing_target.exists())
            self.assertEqual(self._transaction_residues(root), [])

    def test_invalid_destination_fails_before_materialization_and_preserves_outside_sentinel(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            container = Path(temporary)
            root = container / "repo"
            source = root / "bazel-bin" / "build"
            manifest = root / "tinyland.repo.json"
            outside = container / "outside"
            sentinel = outside / "sentinel"
            source.mkdir(parents=True)
            outside.mkdir()
            (source / "index.html").write_text("new", encoding="utf-8")
            manifest.write_text('{"taxonomy":{"primary_role":"static-spoke"}}', encoding="utf-8")
            sentinel.write_text("must survive", encoding="utf-8")

            with self.assertRaises(OutputError):
                materialize_tree(source, outside, Path("index.html"), manifest)
            self.assertEqual(sentinel.read_text(encoding="utf-8"), "must survive")


class RepositoryContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.package = json.loads((ROOT / "package.json").read_text())
        cls.justfile = (ROOT / "Justfile").read_text()
        cls.build = (ROOT / "BUILD.bazel").read_text()
        cls.module = (ROOT / "MODULE.bazel").read_text()
        cls.ci = (ROOT / ".github/workflows/ci.yml").read_text()
        cls.plan = json.loads((ROOT / ".github/lanes.json").read_text())
        cls.manifest = json.loads((ROOT / "tinyland.repo.json").read_text())
        cls.schema = json.loads(
            (ROOT / "docs/schemas/tinyland-repo-manifest.v2.schema.json").read_text()
        )
        cls.publisher = (ROOT / ".github/workflows/container-ghcr.yml").read_text()
        cls.flake = (ROOT / "flake.nix").read_text()
        cls.playwright = (ROOT / "playwright.config.ts").read_text()
        cls.agents = (ROOT / "AGENTS.md").read_text()

    def test_package_scripts_delegate_only_to_just(self) -> None:
        for name, command in self.package["scripts"].items():
            with self.subTest(name=name):
                self.assertRegex(command, r"^just [a-z0-9-]+$")

    def test_build_and_checks_enter_bazel(self) -> None:
        self.assertIn("bazelisk build //:scanned_build", recipe(self.justfile, "build"))
        self.assertIn("bazelisk test //:ci_validation_suite", recipe(self.justfile, "check"))
        self.assertIn('name = "build"', self.build)
        self.assertIn('name = "scanned_build"', self.build)
        self.assertIn('name = "deployment_bundle"', self.build)
        self.assertIn('name = "container_image_context"', self.build)

    def test_deployment_bundle_can_only_package_the_scanned_tree(self) -> None:
        scanned = bazel_target(self.build, "scanned_build")
        self.assertIn('srcs = [":build"]', scanned)
        self.assertIn('tool = ":leak_scan_build_bin"', scanned)
        self.assertIn('"--copy-to",', scanned)
        self.assertIn('out_dirs = ["scanned-build"]', scanned)

        deployment_bundle = bazel_target(self.build, "deployment_bundle")
        self.assertIn('srcs = [":scanned_build"]', deployment_bundle)
        self.assertIn('strip_prefix = "scanned-build"', deployment_bundle)
        self.assertIn('package_dir = "build"', deployment_bundle)
        self.assertNotIn('srcs = [":build"]', deployment_bundle)

        container_context = bazel_target(self.build, "container_image_context")
        self.assertIn('srcs = [":deployment_bundle"', container_context)

        scan_runner = (ROOT / "scripts/check-build-output.mjs").read_text(encoding="utf-8")
        self.assertIn("cpSync(buildDirectory, outputDirectory", scan_runner)
        self.assertIn("lstatSync(outputDirectory)", scan_runner)
        self.assertIn("outputStats.isSymbolicLink()", scan_runner)
        self.assertIn("readdirSync(outputDirectory).length > 0", scan_runner)
        self.assertNotIn("outputDirectory === buildDirectory || existsSync(outputDirectory)", scan_runner)
        self.assertIn("scanDirectory = outputDirectory", scan_runner)
        self.assertIn("scanBuildDirectory(scanDirectory", scan_runner)
        self.assertLess(
            scan_runner.index("cpSync(buildDirectory, outputDirectory"),
            scan_runner.index("scanBuildDirectory(scanDirectory"),
        )

    def test_ci_validation_suite_registers_every_publication_critical_gate(self) -> None:
        validation = bazel_target(self.build, "ci_validation_suite")
        for gate in (
            ":bazel_output_contract_test",
            ":browser_smoke_test",
            ":current_source_secret_scan_test",
            ":goals_manifest_drift_test",
            ":log_manifest_drift_test",
            ":source_map_drift_test",
            ":workflow_validation_test",
        ):
            with self.subTest(gate=gate):
                self.assertIn(f'"{gate}"', validation)

        for name, entry_point in (
            ("source_map_drift_test", "scripts/build-source-map.mjs"),
            ("log_manifest_drift_test", "scripts/build-log-manifest.mjs"),
            ("goals_manifest_drift_test", "scripts/build-goals-manifest.mjs"),
        ):
            with self.subTest(name=name):
                target = bazel_target(self.build, name)
                self.assertIn('args = ["--check"]', target)
                self.assertIn(f'entry_point = "{entry_point}"', target)

        workflow_validation = bazel_target(self.build, "workflow_validation_test")
        self.assertIn('config = ".github/actionlint.yaml"', workflow_validation)
        self.assertIn('srcs = [":workflow_validation_srcs"]', workflow_validation)

    def test_ci_uses_the_exact_immutable_v4_action_contract(self) -> None:
        expected_plan = {
            "schema_version": 3,
            "actions": {
                "validate": {
                    "command": "test",
                    "targets": ["//:ci_validation_suite"],
                    "capability": "rbe-linux-x86_64",
                    "result": {"mode": "status-only"},
                },
                "site-build": {
                    "command": "build",
                    "targets": ["//:deployment_bundle"],
                    "capability": "rbe-linux-x86_64",
                    "result": {
                        "mode": "export-regular-files",
                        "output_groups": ["default"],
                    },
                },
            },
        }
        self.assertEqual(self.plan, expected_plan)

        caller = (
            "tinyland-inc/ci-templates/.github/workflows/"
            f"spoke-ci-v4.yml@{CI_TEMPLATES_V4_REF}"
        )
        uses = re.findall(r"(?m)^\s+uses:\s+(\S+)\s*(?:#.*)?$", self.ci)
        self.assertEqual(uses, [caller, caller])
        self.assertEqual(
            re.findall(r"(?m)^\s+action_name:\s+([a-z0-9-]+)\s*$", self.ci),
            ["validate", "site-build"],
        )
        self.assertNotRegex(self.ci, r"(?m)^\s+runs-on:")
        self.assertNotRegex(self.ci, r"(?m)^\s+(?:environment|packages):")
        for legacy_input in (
            "flywheel_config:",
            "cache_backed:",
            "lanes_path:",
            "default_runner_class:",
            "runner_group:",
            "secrets: inherit",
            "workflow_dispatch:",
        ):
            with self.subTest(legacy_input=legacy_input):
                self.assertNotIn(legacy_input, self.ci)

    def test_manifest_conforms_to_the_exact_signed_schema_163_carrier(self) -> None:
        schema_path = ROOT / "docs/schemas/tinyland-repo-manifest.v2.schema.json"
        self.assertEqual(sha256(schema_path), SCAFFOLD_SCHEMA_SHA256)
        self.assertIn(SCAFFOLD_SCHEMA_HEAD, self.agents)
        self.assertIn(SCAFFOLD_SCHEMA_SHA256, self.agents)

        self.assertEqual(self.schema["$schema"], "https://json-schema.org/draft/2020-12/schema")
        self.assertFalse(self.schema["additionalProperties"])
        self.assertEqual(self.manifest["$schema"], "./docs/schemas/tinyland-repo-manifest.v2.schema.json")
        self.assertEqual(self.manifest["schema_version"], self.schema["properties"]["schema_version"]["const"])
        self.assertEqual(set(self.schema["required"]), set(self.manifest) - {"scaffold_origin"})
        self.assertEqual(self.manifest["taxonomy"]["primary_role"], "static-spoke")
        self.assertNotIn("spawned_repo_role", self.manifest["taxonomy"])
        self.assertEqual(
            self.manifest["enrollment"],
            {
                "forgeScope": "Great-Falls-Tool-Bus",
                "organizationOverlay": "Great-Falls-Tool-Bus/great-falls-tool-bus-infra",
                "organizationOverlayRole": "organization-execution-overlay",
                "organizationOverlayComposition": "distinct",
            },
        )
        self.assertEqual(
            self.manifest["runtime_network"],
            {
                "declarations": [
                    {
                        "purpose": "contact-submit",
                        "module": "src/lib/components/ContactForm.svelte",
                        "url": "https://forms.latoolb.us/api/contact",
                        "method": "POST",
                    }
                ]
            },
        )
        self.assertEqual(
            set(self.manifest["boundaries"]),
            set(self.schema["properties"]["boundaries"]["required"]),
        )
        self.assertTrue(all(value is False for value in self.manifest["boundaries"].values()))
        self.assertEqual(
            self.manifest["authorities"],
            {
                "content_authority": "Great-Falls-Tool-Bus/gftb-site reviewed public SVX",
                "ci_templates": "tinyland-inc/ci-templates",
                "package_registry": "tinyland-inc/bazel-registry",
            },
        )
        for forbidden in (
            "bindingState",
            "cache_backed",
            "credentials",
            "default_runner_class",
            "endpoint",
            "executionPool",
            "fallback",
            "placement",
            "provider",
            "runner",
            "runner_group",
            "substrateMode",
        ):
            with self.subTest(forbidden=forbidden):
                self.assertNotIn(forbidden, nested_keys(self.manifest))

    def test_existing_conformance_helpers_run_inside_the_bazel_contract(self) -> None:
        for script, args in (
            ("scripts/check-inhouse-package-parity.py", []),
            ("scripts/validate-skills.py", [str(ROOT)]),
        ):
            with self.subTest(script=script):
                completed = subprocess.run(
                    [sys.executable, str(ROOT / script), *args],
                    cwd=ROOT,
                    check=False,
                    capture_output=True,
                    text=True,
                )
                self.assertEqual(
                    completed.returncode,
                    0,
                    f"{script} failed:\nstdout:\n{completed.stdout}\nstderr:\n{completed.stderr}",
                )

    def test_static_spoke_conformance_has_no_provider_or_deploy_carrier(self) -> None:
        self.assertEqual(self.package["devDependencies"]["@skeletonlabs/skeleton"], "5.0.0")
        self.assertEqual(self.package["devDependencies"]["@skeletonlabs/skeleton-svelte"], "5.0.0")
        self.assertIn('name = "current_source_secret_scan_test"', self.build)
        self.assertIn('name = "workflow_validation_test"', self.build)

        endpoint_sources = "\n".join(
            (ROOT / path).read_text(encoding="utf-8")
            for path in (
                ".bazelrc",
                ".github/workflows/ci.yml",
                "BUILD.bazel",
                "MODULE.bazel",
                "flake.nix",
            )
        )
        self.assertNotRegex(
            endpoint_sources,
            r"(?:grpc|grpcs)://|https?://[^\s\"]*(?:bazel-cache|reapi)|10(?:\.[0-9]+){3}",
        )
        self.assertNotRegex(self.ci, r"(?i)(?:ubuntu|macos|windows)-[a-z0-9.]+")
        self.assertFalse((ROOT / ".github/workflows/deploy-pages.yml").exists())

        for dead in (
            ".bazelrc.flywheel",
            ".claude-plugin",
            ".github/rulesets",
            ".github/workflows/pulse-ingest.yml",
            ".github/workflows/release.yml",
            "docs/deploy",
            "docs/release",
            "docs/research",
            "modules",
            "plugins",
            "scripts/flywheel-enroll.sh",
            "scripts/gloriousflywheel-bazel.sh",
            "static/agent-map.md",
            "static/llms.txt",
            "tofu",
        ):
            with self.subTest(dead=dead):
                self.assertFalse((ROOT / dead).exists())

        public_files = [
            path
            for root in (ROOT / "src/content", ROOT / "src/routes")
            for path in root.rglob("*")
            if path.is_file()
        ]
        internal_pointer = re.compile(r"TIN-[0-9]+|Linear|github\.com/.+/(?:pull|commit)/|\bPR #[0-9]+")
        for path in public_files:
            with self.subTest(public_path=path.relative_to(ROOT)):
                self.assertNotRegex(path.read_text(encoding="utf-8"), internal_pointer)

        self.assertTrue((ROOT / "static/vendor/altcha/altcha.js").is_file())
        self.assertTrue((ROOT / "static/vendor/altcha/LICENSE").is_file())
        self.assertEqual(list((ROOT / "static").rglob("*.md")), [])
        contact = (ROOT / "src/lib/components/ContactForm.svelte").read_text(encoding="utf-8")
        home = (ROOT / "src/routes/+page.svelte").read_text(encoding="utf-8")
        contact_page = (ROOT / "src/routes/contact/+page.svelte").read_text(encoding="utf-8")
        self.assertIn("forms.latoolb.us", contact)
        self.assertIn('href="/contact"', home)
        self.assertIn("keyholders@latoolb.us", contact_page)

    def test_approved_qr_bytes_and_payload_contract_are_bazel_guarded(self) -> None:
        qr_path = ROOT / "static/qr/greatfallstoolbus-apex.svg"
        self.assertEqual(sha256(qr_path), APPROVED_QR_SHA256)
        self.assertEqual(self.package["homepage"], "https://greatfallstoolbus.org")
        qr_verify = recipe(self.justfile, "qr-verify")
        qr_generate = recipe(self.justfile, "qr-generate")
        for body in (qr_verify, qr_generate):
            self.assertIn("https://greatfallstoolbus.org/", body)
            self.assertIn("--type=SVG --svg-path --level=H --margin=2 --size=4", body)

    def test_live_build_and_check_recipes_never_recursively_clean(self) -> None:
        live_recipes = (
            "build",
            "preview",
            "preview-e2e",
            "preview-only",
            "test-e2e",
            "_playwright-run",
            "_playwright-test",
            "qr-verify",
            "leak-scan-stamped",
            "leak-scan",
            "check",
            "check-ci",
            "ci",
        )
        recursive_rm = re.compile(
            r"\brm\b[^\n]*(?:\s--recursive(?:[=\s]|$)|\s-[A-Za-z]*r[A-Za-z]*(?:\s|$))"
        )
        for name in live_recipes:
            with self.subTest(recipe=name):
                body = recipe(self.justfile, name)
                self.assertNotRegex(body, recursive_rm)
                self.assertNotIn("rmtree(", body)

        stamped = recipe(self.justfile, "leak-scan-stamped")
        self.assertIn("bazelisk build //:scanned_build", stamped)
        self.assertIn('grep -q "deadbee" bazel-bin/scanned-build/index.html', stamped)
        self.assertNotIn("leak-scan bazel-bin", stamped)
        self.assertNotIn("materialize", stamped)
        self.assertNotIn("build-stamped", stamped)
        self.assertNotIn("build-stamped", MATERIALIZED_OUTPUT_NAMES)

        qr = recipe(self.justfile, "qr-verify")
        self.assertIn("umask 077", qr)
        self.assertIn('rm -f -- "$tmp/apex.svg"', qr)
        self.assertIn('rmdir -- "$tmp"', qr)

    def test_playwright_releases_bazel_before_chromium(self) -> None:
        preview = recipe(self.justfile, "preview-e2e")
        self.assertIn('preview-e2e port="4173": build', preview)
        self.assertIn("bazelisk shutdown", preview)
        self.assertLess(preview.index("bazelisk shutdown"), preview.index("scripts/bazel_output.py preview"))
        self.assertIn("just preview-e2e ${port}", self.playwright)
        self.assertEqual(recipe(self.justfile, "ci").splitlines()[0], "ci: check test-e2e")

    def test_playwright_uses_its_locked_browser(self) -> None:
        ensure = recipe(self.justfile, "playwright-ensure")
        self.assertIn("pnpm exec playwright install chromium", ensure)
        self.assertNotIn("Using Nix Chromium", ensure)
        self.assertNotIn("executablePath", self.playwright)
        self.assertNotIn("PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH", self.flake)
        self.assertNotIn("pkgs.chromium", self.flake)
        self.assertIn("playwrightFontConfig = pkgs.makeFontsConf", self.flake)
        self.assertIn("pkgs.dejavu_fonts.minimal", self.flake)
        self.assertIn('export FONTCONFIG_FILE="${playwrightFontConfig}"', self.flake)
        self.assertIn("auto-patchelf", self.flake)
        self.assertIn("patchelfUnstable", self.flake)
        self.assertIn("PLAYWRIGHT_NIX_LIBRARY_PATH", self.flake)
        self.assertIn("PLAYWRIGHT_NIX_DYNAMIC_LINKER", self.flake)
        self.assertIn("PLAYWRIGHT_NIX_PATCHELF", self.flake)
        self.assertNotIn("export LD_LIBRARY_PATH", self.flake)
        e2e = recipe(self.justfile, "test-e2e")
        self.assertIn("nix develop .#playwright --command just _playwright-run", e2e)
        self.assertNotIn("${CI:-}", e2e)
        run = recipe(self.justfile, "_playwright-run")
        self.assertIn("_playwright-run: playwright-ensure", run)
        self.assertIn("just _playwright-test", run)
        self.assertIn("auto-patchelf --preserve-origin", ensure)
        self.assertIn('--paths "$headless_dir" --libs "${playwright_libraries[@]}"', ensure)
        self.assertIn('PATH="$(dirname "$PLAYWRIGHT_NIX_PATCHELF"):$PATH"', ensure)
        self.assertIn("chromium_headless_shell-${revision}", ensure)
        self.assertIn('"$PLAYWRIGHT_NIX_PATCHELF" --print-interpreter', ensure)
        self.assertIn("env -u LD_LIBRARY_PATH", ensure)
        font_contract = recipe(self.justfile, "_playwright-test")
        self.assertIn("fc-match", font_contract)
        self.assertIn("DejaVu", font_contract)
        self.assertIn("env -u LD_LIBRARY_PATH pnpm exec playwright test", font_contract)

    def test_static_adapter_is_exclusive(self) -> None:
        deps = self.package["devDependencies"]
        self.assertIn("@sveltejs/adapter-static", deps)
        self.assertNotIn("@sveltejs/adapter-node", deps)
        self.assertIn("adapter-static", (ROOT / "svelte.config.js").read_text())

    def test_publisher_is_immutable_and_non_deploying(self) -> None:
        identity = "ghcr.io/great-falls-tool-bus/gftb-site"
        self.assertIn(identity, self.justfile)
        self.assertIn(identity, self.flake)
        self.assertIn("packages: write", self.publisher)
        self.assertNotIn("'codex/**'", self.publisher)
        self.assertIn("expected_sha", self.publisher)
        self.assertIn('test "$ACTUAL_SHA" = "$EXPECTED_SHA"', self.publisher)
        self.assertIn("sha-${BUILD_COMMIT_SHA}", self.justfile)
        self.assertIn("sha-${commitSha}", self.flake)
        combined = self.publisher + self.justfile + self.flake
        self.assertNotIn("repository_dispatch", combined)
        self.assertNotIn(":latest", combined)
        self.assertFalse((ROOT / ".github/workflows/deploy-pages.yml").exists())

    def test_publisher_root_carrier_configures_hermetic_python(self) -> None:
        self.assertIn('bazel_dep(name = "rules_python", version = "1.0.0")', self.module)
        self.assertIn(
            'python = use_extension("@rules_python//python/extensions:python.bzl", "python")',
            self.module,
        )
        self.assertIn('python_version = "3.11"', self.module)
        self.assertIn("ignore_root_user_error = True", self.module)
        self.assertIn("- 'MODULE.bazel'", self.publisher)
        self.assertIn("- 'MODULE.bazel.lock'", self.publisher)
        self.assertIn("- 'scripts/test-bazel-cutover-contracts.py'", self.publisher)
        self.assertIn("nix develop . -c just container-image-context", self.publisher)

    def test_image_serves_an_exact_generated_source_marker(self) -> None:
        self.assertIn("printf '%s' '${commitSha}' > \"$out/srv/health.sha\"", self.flake)
        # The materialized build root is a read-only store path; cp -a copies its
        # 0555 mode onto $out/srv, so the marker write needs the directory reopened.
        self.assertIn('chmod u+w "$out/srv"', self.flake)
        self.assertLess(self.flake.index('chmod u+w "$out/srv"'), self.flake.index("> \"$out/srv/health.sha\""))
        self.assertIn("admin off", self.flake)
        self.assertIn("persist_config off", self.flake)
        self.assertIn('respond /health "ok" 200', self.flake)
        self.assertIn("file_server", self.flake)

    def test_missing_paths_are_answered_with_the_prerendered_404_body(self) -> None:
        """Pin the two hand-written implementations of the same behaviour together.

        A bare `file_server` answers a miss with the status line and no body,
        which is how the promoted site served 404 with zero bytes. The fix lives
        in two places that nothing otherwise forces to agree: the `handle_errors`
        block in the Caddyfile, which is what the image runs, and
        `_StaticPreviewHandler.send_error` in this module's sibling, which is
        what Playwright and a local curl measure. If either is edited away the
        other keeps the gate green, so both are asserted here.
        """
        self.assertIn("handle_errors {", self.flake)
        self.assertIn("rewrite * /404.html", self.flake)
        # Without this the fallback is served with `file_server`'s own 200, and
        # every missing path becomes a soft 404.
        self.assertIn("status {err.status_code}", self.flake)
        # The health probes are plain `respond` directives and must keep
        # answering ahead of the error handler.
        self.assertLess(self.flake.index('respond /healthz "ok" 200'), self.flake.index("handle_errors {"))

        preview = (ROOT / "scripts/bazel_output.py").read_text(encoding="utf-8")
        self.assertIn("def send_error(", preview)
        self.assertIn("HTTPStatus.NOT_FOUND", preview)
        self.assertIn('"404.html"', preview)
        self.assertIn("BUILD_COMMIT_SHA must be 40 lowercase hex characters", self.justfile)
        self.assertFalse((ROOT / "static/health.sha").exists())

    def test_first_party_plugin_is_bazel_only(self) -> None:
        declared = {**self.package.get("dependencies", {}), **self.package.get("devDependencies", {})}
        self.assertNotIn("@tummycrypt/vite-plugin-a11y", declared)
        self.assertIn('bazel_dep(name = "tummycrypt_vite_plugin_a11y"', self.module)
        self.assertIn('name = "node_modules/@tummycrypt/vite-plugin-a11y"', self.build)

    def test_public_agent_artifacts_are_absent(self) -> None:
        # src/lib/generated/source-map.json is no longer on this list: it is
        # the generated route->source map behind the SourceLink edit-this-page
        # affordance (demo #94, addendum B1.2), drift-gated by
        # `just source-map-check`. The agent surfaces stay banned.
        for path in ("static/llms.txt", "static/agent-map.md", "src/routes/agent"):
            self.assertFalse((ROOT / path).exists(), path)
        self.assertTrue((ROOT / "src/lib/generated/source-map.json").exists(), "source map (B1.2) must be committed")


if __name__ == "__main__":
    unittest.main(verbosity=2)
