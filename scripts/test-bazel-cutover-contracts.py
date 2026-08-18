#!/usr/bin/env python3
"""Regression checks for the minimal static-site and OCI entrypoints."""

from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from bazel_output import adapter_contract, materialize_tree, preview_command


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
            materialize_tree(source, destination, contract.required_entrypoint)
            command, _ = preview_command(destination, contract, "127.0.0.1", 4173)

            self.assertEqual(contract.name, "adapter-static")
            self.assertTrue((destination / "index.html").is_file())
            self.assertFalse((destination / "stale.txt").exists())
            self.assertIn("serve-static", command)


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
        self.assertIn("spoke-ci.yml@v2.12.2", self.ci)
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

    def test_image_serves_an_exact_generated_source_marker(self) -> None:
        self.assertIn("printf '%s' '${commitSha}' > \"$out/srv/health.sha\"", self.flake)
        self.assertIn("admin off", self.flake)
        self.assertIn("persist_config off", self.flake)
        self.assertIn('respond /health "ok" 200', self.flake)
        self.assertIn("file_server", self.flake)
        self.assertIn("BUILD_COMMIT_SHA must be 40 lowercase hex characters", self.justfile)
        self.assertFalse((ROOT / "static/health.sha").exists())

    def test_first_party_plugin_is_bazel_only(self) -> None:
        declared = {**self.package.get("dependencies", {}), **self.package.get("devDependencies", {})}
        self.assertNotIn("@tummycrypt/vite-plugin-a11y", declared)
        self.assertIn('bazel_dep(name = "tummycrypt_vite_plugin_a11y"', self.module)
        self.assertIn('name = "node_modules/@tummycrypt/vite-plugin-a11y"', self.build)

    def test_public_agent_artifacts_are_absent(self) -> None:
        for path in ("static/llms.txt", "static/agent-map.md", "src/routes/agent", "src/lib/generated/source-map.json"):
            self.assertFalse((ROOT / path).exists(), path)


if __name__ == "__main__":
    unittest.main(verbosity=2)
