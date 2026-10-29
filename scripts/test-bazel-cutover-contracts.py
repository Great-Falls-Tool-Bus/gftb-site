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


def normalize_bin(path: str) -> str:
    while path.startswith("./"):
        path = path[2:]
    return path


def payload_file(test: unittest.TestCase, variable: str) -> Path | None:
    # The P0 and P1 payload-module files reach //:bazel_output_contract_test
    # through env and data. A direct run without Bazel skips these checks.
    value = os.environ.get(variable)
    if not value:
        if os.environ.get("TEST_SRCDIR"):
            test.fail(f"{variable} is unset inside Bazel")
        test.skipTest(f"{variable} is set only by //:bazel_output_contract_test")
        return None
    return (Path.cwd() / value).resolve()


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

    def test_read_only_bazel_directories_materialize_owner_writable(self) -> None:
        # Bazel 9.2 emits read-only output directories; the move must still publish.
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            manifest = root / "tinyland.repo.json"
            manifest.write_text('{"taxonomy":{"primary_role":"static-spoke"}}', encoding="utf-8")
            source = root / "bazel-bin" / "scanned-build"
            destination = root / "build"
            (source / "nested").mkdir(parents=True)
            (source / "index.html").write_bytes(b"index")
            (source / "nested" / "asset.bin").write_bytes(b"\x00asset")
            read_only = [source / "nested" / "asset.bin", source / "index.html", source / "nested", source]
            for path in read_only:
                os.chmod(path, 0o555 if path.is_dir() else 0o444)
            try:
                expected = self._tree_bytes(source)
                materialize_tree(source, Path("build"), Path("index.html"), manifest)
            finally:
                for path in reversed(read_only):
                    os.chmod(path, 0o755 if path.is_dir() else 0o644)

            self.assertEqual(self._tree_bytes(destination), expected)
            for directory in (destination, destination / "nested"):
                with self.subTest(directory=directory):
                    self.assertTrue(directory.stat().st_mode & 0o200)
            self.assertEqual((destination / "index.html").stat().st_mode & 0o777, 0o444)
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
            "os.fchmod(",
            "os.unlink(",
            "os.replace(",
        ):
            with self.subTest(forbidden=forbidden):
                self.assertNotIn(forbidden, implementation)
        self.assertEqual(implementation.count("os.rmdir("), 1)
        # The one permitted mode change grants owner write to staged directories
        # before publication; it never serves cleanup.
        self.assertEqual(implementation.count(".chmod("), 2)
        self.assertEqual(implementation.count("os.chmod(directory, "), 1)
        self.assertEqual(implementation.count("os.chmod(stage_fd, "), 1)
        self.assertEqual(implementation.count("_grant_owner_write_to_staged_directories("), 2)

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
        cls.plan = json.loads((ROOT / ".github/lanes.json").read_text())
        cls.manifest = json.loads((ROOT / "tinyland.repo.json").read_text())
        cls.schema = json.loads(
            (ROOT / "docs/schemas/tinyland-repo-manifest.v2.schema.json").read_text()
        )
        cls.publisher = (ROOT / ".github/workflows/container-ghcr.yml").read_text()
        cls.workflows = {
            path.name: path.read_text(encoding="utf-8")
            for path in sorted((ROOT / ".github/workflows").glob("*.y*ml"))
        }
        cls.flake = (ROOT / "flake.nix").read_text()
        cls.e2e_config = (ROOT / "e2e/bazel/e2e.config.ts").read_text()
        cls.payload_include = (ROOT / "npm_payload.MODULE.bazel").read_text()
        cls.chromium_build = (ROOT / "tools/chromium/BUILD.bazel").read_text()
        cls.ts_build = (ROOT / "tools/ts/BUILD.bazel").read_text()
        cls.operating_rules = (ROOT / "docs/operating-rules.md").read_text()

    def test_package_json_carries_no_package_manager_or_scripts(self) -> None:
        # R577 (TIN-7477): every lane is a Bazel target. package.json stays as
        # metadata (vite-plugin-svelte and vitefu read it); the lock and its
        # inputs live in the P0 payload module.
        self.assertNotIn("scripts", self.package)
        self.assertNotIn("packageManager", self.package)
        for path in (".npmrc", ".pnpmfile.cjs", "pnpm-lock.yaml", "pnpm-workspace.yaml", "patches", "playwright.config.ts"):
            with self.subTest(path=path):
                self.assertFalse((ROOT / path).exists(), path)

    def test_build_and_checks_enter_bazel(self) -> None:
        self.assertIn("bazelisk build //:scanned_build", recipe(self.justfile, "build"))
        self.assertIn("bazelisk test //:ci_validation_suite", recipe(self.justfile, "check"))
        self.assertIn("bazelisk build //:scanned_build", recipe(self.justfile, "check"))
        self.assertIn(
            'BUILD_COMMIT_SHA="${BUILD_COMMIT_SHA:-$(git rev-parse HEAD)}" bazelisk build //:scanned_build',
            recipe(self.justfile, "check"),
        )
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

    def test_lint_tests_carry_no_generated_build_trees(self) -> None:
        # TIN-7477: the remote worker refuses an action whose input tree is
        # above 2,097,152,000 bytes. //:sveltekit_types and the TinyVectors
        # build it pulls in are above that, and the lint tests never read them.
        for name in ("eslint_test", "prettier_check_test"):
            target = bazel_target(self.build, name)
            for generated in (":sveltekit_types", ":app_workspace", ":build"):
                with self.subTest(name=name, generated=generated):
                    self.assertNotIn(f'"{generated}"', target)

    def test_module_graph_alone_resolves_without_registry_flags(self) -> None:
        # R574 (TIN-7477): dependencies enter only through the Bazel module
        # graph. The fabric runs Bazel with --ignore_all_rc_files and no
        # --registry flag, so MODULE.bazel itself binds the two first-party
        # modules to an immutable xoxd-ai/bazel-registry commit, and no rc
        # file may name a registry the fabric would not see.
        bazelrc = (ROOT / ".bazelrc").read_text(encoding="utf-8")
        self.assertNotIn("--registry", bazelrc)
        pins = set()
        for name in (
            "tummycrypt_tinyvectors",
            "tummycrypt_vite_plugin_a11y",
            "xoxd_npm_gftb_site_lock",
            "xoxd_npm_gftb_site_lint",
        ):
            with self.subTest(module=name):
                self.assertIn(f'bazel_dep(name = "{name}", version = ', self.module)
                match = re.search(
                    rf'single_version_override\(\n    module_name = "{name}",\n'
                    r'    registry = "(https://raw\.githubusercontent\.com/xoxd-ai/bazel-registry/[0-9a-f]{40})",\n\)',
                    self.module,
                )
                self.assertIsNotNone(match)
                pins.add(match.group(1))
        self.assertEqual(len(pins), 1, "all four xoxd modules share one registry commit")
        self.assertNotIn("local_path_override(", self.module)
        # No pnpm toolchain repository, and no bot that opens npm lockfile
        # pull requests.
        self.assertNotIn("pnpm.pnpm(", self.module)
        dependabot = (ROOT / ".github/dependabot.yml").read_text(encoding="utf-8")
        self.assertNotIn("package-ecosystem: 'npm'", dependabot)

    def test_ci_validation_suite_registers_every_publication_critical_gate(self) -> None:
        validation = bazel_target(self.build, "ci_validation_suite")
        for gate in (
            ":bazel_output_contract_test",
            ":browser_smoke_test",
            ":current_source_secret_scan_test",
            ":goals_manifest_drift_test",
            ":hours_manifest_drift_test",
            ":log_manifest_drift_test",
            ":served_tinyvectors_test",
            ":source_map_drift_test",
            ":workflow_validation_test",
        ):
            with self.subTest(gate=gate):
                self.assertIn(f'"{gate}"', validation)

        for name, entry_point in (
            ("source_map_drift_test", "scripts/build-source-map.mjs"),
            ("log_manifest_drift_test", "scripts/build-log-manifest.mjs"),
            ("goals_manifest_drift_test", "scripts/build-goals-manifest.mjs"),
            ("hours_manifest_drift_test", "scripts/build-hours-manifest.mjs"),
        ):
            with self.subTest(name=name):
                target = bazel_target(self.build, name)
                self.assertIn('args = ["--check"]', target)
                self.assertIn(f'entry_point = "{entry_point}"', target)

        # TIN-4339: the served-artifact proof reads the declared build and the
        # pin, never a rebuilt or ambient tree.
        served = bazel_target(self.build, "served_tinyvectors_test")
        self.assertIn('entry_point = "scripts/check-served-tinyvectors.mjs"', served)
        self.assertIn('"$(rootpath :build)"', served)
        self.assertIn('"$(rootpath MODULE.bazel)"', served)
        self.assertIn('":build",', served)

        workflow_validation = bazel_target(self.build, "workflow_validation_test")
        self.assertIn('config = ".github/actionlint.yaml"', workflow_validation)
        self.assertIn('srcs = [":workflow_validation_srcs"]', workflow_validation)

    def test_v4_action_plan_is_exact_and_no_workflow_runs_on_push_or_pr(self) -> None:
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

        # Operator ruling 2026-09-28: GitHub Actions leave this repository.
        # The v4 caller and the signed-commits check are gone; the pre-merge
        # gate is a lab-host `just check` receipt. Remaining workflows are
        # dispatch or schedule only, each awaiting its lab-host replacement.
        self.assertFalse((ROOT / ".github/workflows/ci.yml").exists())
        self.assertFalse((ROOT / ".github/workflows/signed-commits.yml").exists())
        for name, source in self.workflows.items():
            with self.subTest(workflow=name):
                block = re.search(r"(?ms)^on:[ \t]*\n(.*?)(?=^\S|\Z)", source)
                self.assertIsNotNone(block)
                triggers = set(re.findall(r"(?m)^  ([A-Za-z_]+)[ \t]*:", block.group(1)))
                self.assertTrue(triggers)
                self.assertLessEqual(triggers, {"schedule", "workflow_dispatch"})

    def test_manifest_conforms_to_the_exact_signed_schema_163_carrier(self) -> None:
        schema_path = ROOT / "docs/schemas/tinyland-repo-manifest.v2.schema.json"
        self.assertEqual(sha256(schema_path), SCAFFOLD_SCHEMA_SHA256)
        self.assertIn(SCAFFOLD_SCHEMA_HEAD, self.operating_rules)
        self.assertIn(SCAFFOLD_SCHEMA_SHA256, self.operating_rules)

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
                    },
                    # Operator interview 2026-10-02: the work session RSVP
                    # rides the contact relay as a contact message.
                    {
                        "purpose": "contact-submit",
                        "module": "src/lib/components/RsvpDialog.svelte",
                        "url": "https://forms.latoolb.us/api/contact",
                        "method": "POST",
                    },
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
        self.assertEqual(self.package["devDependencies"]["@skeletonlabs/skeleton"], "5.0.1")
        self.assertEqual(self.package["devDependencies"]["@skeletonlabs/skeleton-svelte"], "5.0.1")
        self.assertIn('name = "current_source_secret_scan_test"', self.build)
        self.assertIn('name = "workflow_validation_test"', self.build)

        endpoint_sources = "\n".join(
            (ROOT / path).read_text(encoding="utf-8")
            for path in (
                ".bazelrc",
                ".github/workflows/container-ghcr.yml",
                "BUILD.bazel",
                "MODULE.bazel",
                "flake.nix",
            )
        )
        self.assertNotRegex(
            endpoint_sources,
            r"(?:grpc|grpcs)://|https?://[^\s\"]*(?:bazel-cache|reapi)|10(?:\.[0-9]+){3}",
        )
        for name, source in self.workflows.items():
            with self.subTest(workflow=name):
                self.assertNotRegex(source, r"(?i)(?:ubuntu|macos|windows)-[a-z0-9.]+")
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
            "preview-only",
            "test-e2e",
            "qr-verify",
            "leak-scan-stamped",
            "leak-scan",
            "check",
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

    def test_e2e_runs_every_spec_in_bazel_with_the_nix_chromium(self) -> None:
        # R583 (TIN-7477): the host `pnpm exec playwright test` lane, its CDN
        # browser and its patchelf path are gone. //:e2e_test runs every spec
        # over the declared //:build with the toolchain-resolved Chromium.
        e2e = recipe(self.justfile, "test-e2e")
        self.assertIn("bazelisk test //:e2e_test", e2e)
        self.assertEqual(recipe(self.justfile, "ci").splitlines()[0], "ci: check test-e2e")
        for gone in ("playwright-ensure", "_playwright-run", "_playwright-test", "preview-e2e", "deps-lock"):
            with self.subTest(recipe=gone):
                self.assertNotRegex(self.justfile, rf"(?m)^{re.escape(gone)}[ :]")
        target = bazel_target(self.build, "e2e_test")
        self.assertIn('entry_point = "e2e/bazel/run-browser-acceptance.mjs"', target)
        self.assertIn('"e2e.config.ts",', target)
        self.assertIn('toolchains = ["//tools/chromium:resolved"]', target)
        self.assertIn('"GF_E2E_CHROMIUM_EXECUTABLE": "$(GF_E2E_CHROMIUM_EXECUTABLE)"', target)
        self.assertIn('"--revision-env",', target)
        self.assertIn("local = True,", target)
        self.assertIn('"exclusive-if-local"', target)
        self.assertIn('":build",', target)
        self.assertNotIn("webServer:", self.e2e_config)
        self.assertIn("forbidOnly: true", self.e2e_config)
        self.assertIn("retries: 0", self.e2e_config)
        self.assertIn("workers: 1", self.e2e_config)
        # //:browser_smoke_test keeps its nine specs and GF's /bin/chromium.
        smoke = bazel_target(self.build, "browser_smoke_test")
        self.assertIn('"browser-acceptance.config.ts",', smoke)
        self.assertIn('"GF_RBE_CHROMIUM_EXECUTABLE": "/bin/chromium"', smoke)
        # The flake pins the browser; no host Playwright library or patch path.
        self.assertIn("packages.e2e-chromium = e2eChromium;", self.flake)
        self.assertIn("pkgs.dejavu_fonts.minimal", self.flake)
        for gone in ("devShells.playwright", "auto-patchelf", "PLAYWRIGHT_NIX_LIBRARY_PATH", "corepack"):
            with self.subTest(flake=gone):
                self.assertNotIn(gone, self.flake)

    def test_e2e_spec_census_covers_every_spec(self) -> None:
        # Design contract test 5 (R583): the //:e2e_test spec list is exactly
        # e2e/*.spec.ts, so a new spec cannot skip the Bazel lane.
        listed = re.findall(r"^\t'([a-z0-9-]+\.spec\.ts)',$", self.e2e_config.split("export const E2E_SPECS = [", 1)[1].split("];", 1)[0], re.MULTILINE)
        on_disk = sorted(path.name for path in (ROOT / "e2e").glob("*.spec.ts"))
        self.assertEqual(listed, on_disk)
        self.assertEqual(len(on_disk), 27, "the 27-spec census of R583; update this count with the list")
        self.assertIn("testMatch: E2E_SPECS.map(", self.e2e_config)

    def test_chromium_toolchain_never_reaches_lint(self) -> None:
        # Critique N1: toolchain() targets live in this repository and
        # MODULE.bazel registers //tools/chromium:all, so resolving any other
        # toolchain never fetches @chromium_nix. The two implementations are
        # mutually exclusive, and only //tools/chromium names @chromium_nix.
        self.assertIn('register_toolchains("//tools/chromium:all")', self.module)
        self.assertNotIn('register_toolchains("@chromium_nix', self.module)
        nix = bazel_target(self.chromium_build, "nix_host")
        rbe = bazel_target(self.chromium_build, "rbe_linux_x86_64")
        self.assertIn('toolchain = "@chromium_nix//:impl"', nix)
        self.assertIn('target_settings = [":source_nix"]', nix)
        self.assertIn('target_settings = [":source_gf_rbe"]', rbe)
        self.assertIn('toolchain = ":gf_rbe_impl"', rbe)
        for path in ROOT.rglob("*"):
            if path.suffix in (".bazel", ".bzl") and path.name != "MODULE.bazel":
                relative = path.relative_to(ROOT).as_posix()
                if relative.startswith("tools/chromium/"):
                    continue
                with self.subTest(path=relative):
                    self.assertNotIn("@chromium_nix", path.read_text(encoding="utf-8"))
        closure = (ROOT / "scripts/bazel/lint_closure.py").read_text(encoding="utf-8")
        self.assertIn('"chromium_nix" in n', closure)

    def test_no_hub_package_json_bzl_is_loaded(self) -> None:
        # Design contract test 1 (C1, critique N3c): a bin macro loads the npm
        # sources repository of its package, and that repository always
        # downloads the npm tarball. No package_json.bzl of any hub is loaded.
        load = re.compile(r'load\(\s*"@[^"]*package_json\.bzl"')
        scanned = []
        for path in ROOT.rglob("*"):
            if path.is_file() and (path.suffix in (".bazel", ".bzl") or path.name in ("BUILD", "BUILD.bazel")):
                relative = path.relative_to(ROOT).as_posix()
                scanned.append(relative)
                with self.subTest(path=relative):
                    self.assertIsNone(load.search(path.read_text(encoding="utf-8")))
        for required in ("BUILD.bazel", "tools/ts/BUILD.bazel", "tools/site-draft-compiler/defs.bzl"):
            self.assertIn(required, scanned)

    def test_lint_and_tsc_entry_points_are_the_p1_manifest_bins(self) -> None:
        # Design 6.1 and section 5: each directory_path is the package.json
        # `bin` entry P1's MANIFEST.json records, so a P1 bump that moves a bin
        # fails here and not in the cell (critique N3b: a string bin is one
        # command named after the package).
        manifest = payload_file(self, "GFTB_P1_MANIFEST")
        if manifest is None:
            return
        bins = {}
        for package in json.loads(manifest.read_text(encoding="utf-8"))["packages"]:
            bins[(package["package"], package["version"])] = {
                name: normalize_bin(path) for name, path in package["bin"].items()
            }
        expected = (
            (self.build, "eslint_entry", ("eslint", "10.10.0"), "eslint"),
            (self.build, "prettier_entry", ("prettier", "3.9.6"), "prettier"),
            (self.ts_build, "tsc_entry", ("typescript", "7.0.2"), "tsc"),
        )
        for build_file, name, key, command in expected:
            with self.subTest(target=name):
                target = bazel_target(build_file, name)
                path = re.search(r'path = "([^"]+)"', target).group(1)
                self.assertEqual(normalize_bin(path), bins[key][command])
        prettier_write = bazel_target(self.build, "prettier_write")
        self.assertIn(f'"prettier/{bins[("prettier", "3.9.6")]["prettier"]}",', prettier_write)
        for name in ("eslint_test", "prettier_check_test"):
            self.assertIn(f'entry_point = ":{name.split("_")[0]}_entry"', bazel_target(self.build, name))
        self.assertIn('entry_point = ":tsc_entry"', bazel_target(self.ts_build, "tsc"))
        compiler = (ROOT / "tools/site-draft-compiler/defs.bzl").read_text(encoding="utf-8")
        self.assertIn('tsc = "//tools/ts:tsc"', compiler)
        self.assertNotIn("//tools/ts:", "".join(re.findall(r"^load\(.*$", compiler, re.MULTILINE)))
        self.assertNotIn("typescript.deps(", self.module)
        self.assertNotIn("npm_typescript", self.module)

    def test_payload_include_is_the_p1_file_verbatim(self) -> None:
        # Design 6.1 and critique N3a: the include carries its own
        # use_extension line and is byte-equal to P1's generated file.
        self.assertIn('include("//:npm_payload.MODULE.bazel")', self.module)
        self.assertIn('npm = use_extension("@aspect_rules_js//npm:extensions.bzl", "npm")', self.payload_include)
        published = payload_file(self, "GFTB_P1_PAYLOAD_INCLUDE")
        if published is None:
            return
        self.assertEqual(self.payload_include, published.read_text(encoding="utf-8"))

    def test_p1_manifest_is_cut_from_the_p0_lock(self) -> None:
        # Design contract test 3 (C3.5): P1 records the sha256 of the P0
        # pnpm-lock.yaml it was cut from, every MANIFEST entry carries that
        # lock's sha512, and every entry has exactly one replacement tag.
        manifest_path = payload_file(self, "GFTB_P1_MANIFEST")
        lock_path = payload_file(self, "GFTB_P0_LOCK")
        if manifest_path is None or lock_path is None:
            return
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        lock = lock_path.read_text(encoding="utf-8")
        self.assertEqual(manifest["p0_lock_sha256"], sha256(lock_path))
        integrity = dict(re.findall(r"^  '?(.+?@[^@:(']+)'?:\n    resolution: \{integrity: (sha512-[^,}]+)", lock, re.MULTILINE))
        tags = dict(re.findall(r'^npm\.npm_replace_package\(package = "([^"]+)", replacement = "@xoxd_npm_gftb_site_lint//:([^"]+)"\)$', self.payload_include, re.MULTILINE))
        keys = set()
        for package in manifest["packages"]:
            key = f'{package["package"]}@{package["version"]}'
            keys.add(key)
            with self.subTest(package=key):
                self.assertEqual(integrity.get(key), package["lock_integrity"])
                self.assertEqual(tags.get(key), package["target"])
        self.assertEqual(set(tags), keys)

    def test_one_payload_commit_for_node_and_the_payload_modules(self) -> None:
        # Design contract test 4: the Node mirror names the same
        # xoxd-ai/bazel-payloads commit as the P0 and P1 source.json URLs
        # that MODULE.bazel.lock records. Before PR-P2 merges, node_urls
        # carries a placeholder and this test fails by design.
        node = re.search(
            r'node_urls = \["https://raw\.githubusercontent\.com/xoxd-ai/bazel-payloads/([0-9a-f]{40})/node/v\{version\}/\{filename\}"\]',
            self.module,
        )
        self.assertIsNotNone(node, "node_urls must name exactly the commit-pinned mirror")
        self.assertNotIn("https://nodejs.org", self.module)
        lock = (ROOT / "MODULE.bazel.lock").read_text(encoding="utf-8")
        for name in ("xoxd_npm_gftb_site_lock", "xoxd_npm_gftb_site_lint"):
            with self.subTest(module=name):
                self.assertRegex(lock, rf"/modules/{name}/1\.0\.0/source\.json")
        payload_commits = set(re.findall(r"raw\.githubusercontent\.com/xoxd-ai/bazel-payloads/([0-9a-f]{40})/payloads/", lock))
        self.assertEqual(payload_commits, {node.group(1)})

    def test_lint_closure_recipe_asserts_the_four_closure_conditions(self) -> None:
        # Design contract test 2 and critique N1 (d): the recipe and its four
        # assertions, which gftb-site CI and gate S-P run.
        self.assertIn("python3 scripts/bazel/lint_closure.py", recipe(self.justfile, "lint-closure"))
        closure = (ROOT / "scripts/bazel/lint_closure.py").read_text(encoding="utf-8")
        for needle in (
            'NPM_PREFIX = "aspect_rules_js++npm+npm__"',
            'FORBIDDEN_HOSTS = ("registry.npmjs.org", "nodejs.org")',
            '"--build_event_json_file={bep}"',
            '"(c) ',
            '"(d) the lint vendor fetched',
        ):
            with self.subTest(needle=needle):
                self.assertIn(needle, closure)

    def test_host_lanes_run_no_node_or_pnpm(self) -> None:
        # R577 (TIN-7477): no host pnpm, npm or node call remains in a lane;
        # the write lanes and the IDE shim are Bazel targets. C8: no lane
        # runs the aspect telemetry curl.
        self.assertNotRegex(self.justfile, r"(?m)^\s+cd \{\{ root \}\} && (pnpm|npm|npx|node) ")
        for name, target in (
            ("setup", "//:ide_setup"),
            ("sync", "//:ide_setup"),
            ("format", "//:prettier_write"),
            ("source-map-build", "//:source_map_write"),
            ("log-manifest-build", "//:log_manifest_write"),
            ("goals-manifest-build", "//:goals_manifest_write"),
            ("hours-manifest-build", "//:hours_manifest_write"),
            ("leak-scan", "//:leak_scan_build_bin"),
        ):
            with self.subTest(recipe=name):
                self.assertIn(f"bazelisk run {target}", recipe(self.justfile, name))
        self.assertIn('export ASPECT_TOOLS_TELEMETRY := "off"', self.justfile)
        self.assertIn("export ASPECT_TOOLS_TELEMETRY=off", self.flake)
        for package in ("nodejs_22", "pnpm"):
            with self.subTest(flake=package):
                self.assertNotRegex(self.flake, rf"(?m)^\s+{package}$")

    def test_static_adapter_is_exclusive(self) -> None:
        deps = self.package["devDependencies"]
        self.assertIn("@sveltejs/adapter-static", deps)
        self.assertNotIn("@sveltejs/adapter-node", deps)
        self.assertIn("adapter-static", (ROOT / "kit.config.js").read_text())

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
        self.assertIn("nix develop . -c just container-image-publish", self.publisher)

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
        for path in (
            "src/routes/agent",
            "AGENTS.md",
            ".agents",
            "scripts/validate-skills.py",
        ):
            self.assertFalse((ROOT / path).exists(), path)
        self.assertTrue((ROOT / "src/lib/generated/source-map.json").exists(), "source map (B1.2) must be committed")


if __name__ == "__main__":
    unittest.main(verbosity=2)
