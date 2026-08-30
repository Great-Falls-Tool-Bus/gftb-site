#!/usr/bin/env python3
"""Regression checks for the minimal static-site and OCI entrypoints."""

from __future__ import annotations

import json
import os
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


def recipe(justfile: str, name: str) -> str:
    lines = justfile.splitlines()
    start = next(i for i, line in enumerate(lines) if line.startswith(f"{name}:") or line.startswith(f"{name} "))
    body = [lines[start]]
    for line in lines[start + 1 :]:
        if line and not line.startswith((" ", "\t", "#")):
            break
        body.append(line)
    return "\n".join(body)


class StaticOutputTests(unittest.TestCase):
    def test_static_output_materializes_transactionally(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            manifest = root / "tinyland.repo.json"
            manifest.write_text(json.dumps({"taxonomy": {"primary_role": "static-spoke"}}))
            source = root / "bazel-bin" / "build"
            destination = root / "build"
            source.mkdir(parents=True)
            destination.mkdir()
            (source / "index.html").write_text("new")
            (destination / "stale.txt").write_text("old")

            contract = adapter_contract(manifest)
            materialize_tree(source, Path("build"), contract.required_entrypoint, manifest)
            command, _ = preview_command(destination, contract, "127.0.0.1", 4173)

            self.assertEqual(contract.name, "adapter-static")
            self.assertTrue((destination / "index.html").is_file())
            self.assertFalse((destination / "stale.txt").exists())
            self.assertIn("serve-static", command)
            self.assertEqual(
                [
                    child.name
                    for child in root.iterdir()
                    if child.name.startswith(
                        (".build.previous-", ".build.materialize-", ".build.transaction-")
                    )
                ],
                [],
            )

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
            destination.mkdir()
            (source / "index.html").write_text("new", encoding="utf-8")
            (destination / "stale.txt").write_text("old", encoding="utf-8")
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

            self.assertEqual((destination / "stale.txt").read_text(encoding="utf-8"), "old")
            self.assertFalse((destination / "index.html").exists())
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

    def test_materialization_rolls_back_destination_inside_owned_transaction(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            manifest = root / "tinyland.repo.json"
            manifest.write_text('{"taxonomy":{"primary_role":"static-spoke"}}', encoding="utf-8")
            source = root / "bazel-bin" / "build"
            destination = root / "build"
            source.mkdir(parents=True)
            destination.mkdir()
            (source / "index.html").write_text("new", encoding="utf-8")
            (destination / "stale.txt").write_text("old", encoding="utf-8")
            original_replace = os.replace

            def replace_with_failed_publish(
                source_path: str | os.PathLike[str],
                destination_path: str | os.PathLike[str],
                *,
                src_dir_fd: int | None = None,
                dst_dir_fd: int | None = None,
            ) -> None:
                if source_path == "stage" and destination_path == destination.name:
                    raise OSError("simulated publish failure")
                original_replace(
                    source_path,
                    destination_path,
                    src_dir_fd=src_dir_fd,
                    dst_dir_fd=dst_dir_fd,
                )

            with mock.patch("bazel_output.os.replace", side_effect=replace_with_failed_publish):
                with self.assertRaisesRegex(OSError, "simulated publish failure"):
                    materialize_tree(source, Path("build"), Path("index.html"), manifest)

            self.assertEqual((destination / "stale.txt").read_text(encoding="utf-8"), "old")
            self.assertFalse((destination / "index.html").exists())
            self.assertEqual(
                [
                    child.name
                    for child in root.iterdir()
                    if child.name.startswith(
                        (".build.previous-", ".build.materialize-", ".build.transaction-")
                    )
                ],
                [],
            )

    def test_mount_boundary_fails_before_any_recursive_deletion(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            transaction_name = ".build.transaction-held"
            transaction = root / transaction_name
            boundary = transaction / "previous" / "mounted"
            boundary.mkdir(parents=True)
            sentinel = boundary / "sentinel"
            sentinel.write_text("must survive", encoding="utf-8")
            parent_fd = os.open(root, bazel_output._directory_open_flags())
            transaction_fd = os.open(
                transaction_name,
                bazel_output._directory_open_flags(),
                dir_fd=parent_fd,
            )
            try:
                transaction_metadata = os.fstat(transaction_fd)
                transaction_identity = bazel_output._inode_identity(transaction_metadata)
                boundary_identity = bazel_output._inode_identity(boundary.stat())
                expected_mount = (transaction_metadata.st_dev, 101)

                def mocked_mount_identity(
                    _file_descriptor: int,
                    metadata: os.stat_result,
                ) -> tuple[int, int | None]:
                    mount_id = 202 if bazel_output._inode_identity(metadata) == boundary_identity else 101
                    return (metadata.st_dev, mount_id)

                with (
                    mock.patch("bazel_output._mount_identity", side_effect=mocked_mount_identity),
                    mock.patch("bazel_output.os.unlink") as unlink,
                    mock.patch("bazel_output.os.rmdir") as rmdir,
                ):
                    with self.assertRaisesRegex(OutputError, "mount boundary"):
                        bazel_output._remove_owned_transaction(
                            parent_fd,
                            transaction_name,
                            transaction_fd,
                            ".build.transaction-",
                            transaction_identity,
                            expected_mount,
                        )
                    unlink.assert_not_called()
                    rmdir.assert_not_called()

                self.assertEqual(sentinel.read_text(encoding="utf-8"), "must survive")
                self.assertTrue(transaction.is_dir())
            finally:
                os.close(transaction_fd)
                os.close(parent_fd)

    def test_replaced_transaction_directory_is_preserved_without_deletion(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            transaction_name = ".build.transaction-held"
            transaction = root / transaction_name
            transaction.mkdir()
            parent_fd = os.open(root, bazel_output._directory_open_flags())
            transaction_fd = os.open(
                transaction_name,
                bazel_output._directory_open_flags(),
                dir_fd=parent_fd,
            )
            try:
                transaction_metadata = os.fstat(transaction_fd)
                transaction_identity = bazel_output._inode_identity(transaction_metadata)
                transaction_mount = bazel_output._mount_identity(transaction_fd, transaction_metadata)
                displaced = root / "displaced-transaction"
                transaction.rename(displaced)
                transaction.mkdir()
                sentinel = transaction / "sentinel"
                sentinel.write_text("must survive", encoding="utf-8")

                with (
                    mock.patch("bazel_output.os.unlink") as unlink,
                    mock.patch("bazel_output.os.rmdir") as rmdir,
                ):
                    with self.assertRaisesRegex(OutputError, "path was replaced"):
                        bazel_output._remove_owned_transaction(
                            parent_fd,
                            transaction_name,
                            transaction_fd,
                            ".build.transaction-",
                            transaction_identity,
                            transaction_mount,
                        )
                    unlink.assert_not_called()
                    rmdir.assert_not_called()

                self.assertEqual(sentinel.read_text(encoding="utf-8"), "must survive")
                self.assertTrue(displaced.is_dir())
            finally:
                os.close(transaction_fd)
                os.close(parent_fd)

    def test_materialization_cleanup_has_no_path_recursive_delete(self) -> None:
        implementation = (ROOT / "scripts/bazel_output.py").read_text(encoding="utf-8")
        self.assertNotIn("shutil.rmtree", implementation)

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
        cls.publisher = (ROOT / ".github/workflows/container-ghcr.yml").read_text()
        cls.flake = (ROOT / "flake.nix").read_text()
        cls.playwright = (ROOT / "playwright.config.ts").read_text()

    def test_package_scripts_delegate_only_to_just(self) -> None:
        for name, command in self.package["scripts"].items():
            with self.subTest(name=name):
                self.assertRegex(command, r"^just [a-z0-9-]+$")

    def test_build_and_checks_enter_bazel(self) -> None:
        self.assertIn("bazelisk build //:build", recipe(self.justfile, "build"))
        self.assertIn("bazelisk test //:local_validation_suite", recipe(self.justfile, "check"))
        self.assertIn('name = "build"', self.build)
        self.assertIn('name = "deployment_bundle"', self.build)
        self.assertIn('name = "container_image_context"', self.build)

    def test_playwright_releases_bazel_before_chromium(self) -> None:
        preview = recipe(self.justfile, "preview-e2e")
        self.assertIn('preview-e2e port="4173": build', preview)
        self.assertIn("bazelisk shutdown", preview)
        self.assertLess(preview.index("bazelisk shutdown"), preview.index("scripts/bazel_output.py preview"))
        self.assertIn("just preview-e2e ${port}", self.playwright)

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

    def test_ci_routes_every_required_class(self) -> None:
        self.assertIn("spoke-ci.yml@v3.1.0", self.ci)
        for input_name in ("default_runner_class", "heavy_runner_class", "kvm_runner_class"):
            self.assertIn(f"{input_name}: tinyland-nix", self.ci)

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
