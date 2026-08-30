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
        qa_packet = recipe(self.justfile, "qa-packet")
        self.assertIn("bazelisk shutdown", qa_packet)
        self.assertIn("preview-only {{ port }}", qa_packet)
        self.assertNotIn("preview-e2e {{ port }}", qa_packet)
        self.assertLess(qa_packet.index("bazelisk shutdown"), qa_packet.index("preview-only {{ port }}"))
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
