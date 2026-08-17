#!/usr/bin/env python3
"""Regression contracts for the canonical Bazel entrypoint cutover."""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from bazel_output import (
    OutputError,
    _strip_static_base_path,
    adapter_contract,
    materialize_tree,
    preview_command,
)


ROOT = Path(__file__).resolve().parent.parent
CI_TEMPLATES_REF = "v2.12.2"


def _write_manifest(path: Path, role: str) -> None:
    path.write_text(json.dumps({"taxonomy": {"spawned_repo_role": role}}), encoding="utf-8")


def _recipe(justfile: str, name: str) -> str:
    lines = justfile.splitlines()
    start = next(
        index
        for index, line in enumerate(lines)
        if line.startswith(f"{name}:") or line.startswith(f"{name} ")
    )
    body = [lines[start]]
    for line in lines[start + 1 :]:
        if line and not line.startswith((" ", "\t")):
            break
        body.append(line)
    return "\n".join(body)


def _bazel_target(build_file: str, name: str) -> str:
    anchor = build_file.index(f'    name = "{name}",')
    start = build_file.rfind("\n", 0, build_file.rfind("\n", 0, anchor)) + 1
    end = build_file.index("\n)\n", anchor) + 3
    return build_file[start:end]


class AdapterOutputContracts(unittest.TestCase):
    def _fixture(self, role: str, entrypoint: str) -> tuple[Path, Path, Path, tempfile.TemporaryDirectory[str]]:
        temporary = tempfile.TemporaryDirectory()
        root = Path(temporary.name)
        manifest = root / "tinyland.repo.json"
        source = root / "bazel-bin" / "output"
        destination = root / "build"
        source.mkdir(parents=True)
        destination.mkdir()
        (source / entrypoint).write_text("new", encoding="utf-8")
        (source / "asset.txt").write_text("asset", encoding="utf-8")
        (destination / "stale.txt").write_text("stale", encoding="utf-8")
        _write_manifest(manifest, role)
        return manifest, source, destination, temporary

    def test_adapter_static_materializes_index_html_and_uses_base_path_server(self) -> None:
        manifest, source, destination, temporary = self._fixture("static-spoke", "index.html")
        self.addCleanup(temporary.cleanup)

        contract = adapter_contract(manifest)
        materialize_tree(source, destination, contract.required_entrypoint)
        command, _ = preview_command(destination, contract, "127.0.0.1", 4173, "/repo")

        self.assertEqual(contract.name, "adapter-static")
        self.assertIn("serve-static", command)
        self.assertEqual(command[-2:], ["--base-path", "/repo"])
        self.assertEqual(_strip_static_base_path("/repo/_app/app.js?v=1", "/repo"), "/_app/app.js?v=1")
        self.assertIsNone(_strip_static_base_path("/other/_app/app.js", "/repo"))
        self.assertTrue((destination / "index.html").is_file())
        self.assertFalse((destination / "stale.txt").exists())

    def test_adapter_node_materializes_index_js_and_exports_host_port(self) -> None:
        manifest, source, destination, temporary = self._fixture("app-stateful-spoke", "index.js")
        self.addCleanup(temporary.cleanup)

        contract = adapter_contract(manifest)
        materialize_tree(source, destination, contract.required_entrypoint)
        command, environment = preview_command(destination, contract, "0.0.0.0", 3000)

        self.assertEqual(contract.name, "adapter-node")
        self.assertEqual(command, ["node", str(destination / "index.js")])
        self.assertEqual(environment["HOST"], "0.0.0.0")
        self.assertEqual(environment["PORT"], "3000")
        self.assertTrue((destination / "index.js").is_file())
        self.assertFalse((destination / "stale.txt").exists())

    def test_wrong_adapter_output_preserves_previous_destination(self) -> None:
        manifest, source, destination, temporary = self._fixture("static-spoke", "index.js")
        self.addCleanup(temporary.cleanup)
        contract = adapter_contract(manifest)

        with self.assertRaises(OutputError):
            materialize_tree(source, destination, contract.required_entrypoint)

        self.assertEqual((destination / "stale.txt").read_text(encoding="utf-8"), "stale")
        self.assertFalse(any(destination.parent.glob(".build.materialize-*")))
        self.assertFalse(any(destination.parent.glob(".build.previous-*")))

    def test_keyboard_interrupt_restores_previous_destination(self) -> None:
        manifest, source, destination, temporary = self._fixture("static-spoke", "index.html")
        self.addCleanup(temporary.cleanup)
        contract = adapter_contract(manifest)
        real_replace = os.replace
        replace_count = 0

        def interrupt_second_replace(source_path: Path, destination_path: Path) -> None:
            nonlocal replace_count
            replace_count += 1
            if replace_count == 2:
                raise KeyboardInterrupt
            real_replace(source_path, destination_path)

        with mock.patch("bazel_output.os.replace", side_effect=interrupt_second_replace):
            with self.assertRaises(KeyboardInterrupt):
                materialize_tree(source, destination, contract.required_entrypoint)

        self.assertEqual((destination / "stale.txt").read_text(encoding="utf-8"), "stale")
        self.assertFalse(any(destination.parent.glob(".build.previous-*")))

    def test_next_run_recovers_backup_left_by_uncatchable_interruption(self) -> None:
        manifest, source, destination, temporary = self._fixture("static-spoke", "index.html")
        self.addCleanup(temporary.cleanup)
        contract = adapter_contract(manifest)
        backup = destination.parent / ".build.previous-crashed"
        os.replace(destination, backup)

        with mock.patch("bazel_output.shutil.copytree", side_effect=KeyboardInterrupt):
            with self.assertRaises(KeyboardInterrupt):
                materialize_tree(source, destination, contract.required_entrypoint)

        self.assertEqual((destination / "stale.txt").read_text(encoding="utf-8"), "stale")
        self.assertFalse(backup.exists())


class EntrypointContracts(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.justfile = (ROOT / "Justfile").read_text(encoding="utf-8")
        cls.build_file = (ROOT / "BUILD.bazel").read_text(encoding="utf-8")
        cls.package = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))

    def test_package_scripts_are_thin_just_delegates(self) -> None:
        scripts = self.package["scripts"]
        self.assertTrue(scripts)
        for name, command in scripts.items():
            with self.subTest(script=name):
                self.assertRegex(command, r"^just [a-z0-9:-]+$")

    def test_canonical_just_recipes_execute_bazel_without_package_recursion(self) -> None:
        expected = {
            "build": "build //:build",
            "check": "test //:local_validation_suite",
            "test-unit": "test //:unit_tests",
            "dev": "run //:dev",
            "analyze": "build //:analyze",
        }
        for recipe, invocation in expected.items():
            with self.subTest(recipe=recipe):
                body = _recipe(self.justfile, recipe)
                self.assertIn("bazelisk", body)
                self.assertIn(invocation, body)
                self.assertNotIn("pnpm run", body)

        self.assertNotIn("_house-hydrate", self.justfile)
        self.assertNotIn("pnpm run", self.justfile)

    def test_pages_build_uses_arc_and_the_ci_bazel_resource_policy(self) -> None:
        build_ci = _recipe(self.justfile, "build-ci")
        check_ci = _recipe(self.justfile, "check-ci")
        workflow = (ROOT / ".github/workflows/deploy-pages.yml").read_text(encoding="utf-8")
        cloudflare_example = (ROOT / "docs/deploy/cloudflare-pages.md").read_text(
            encoding="utf-8"
        )
        top_level = workflow.split("jobs:", maxsplit=1)[0]
        jobs = workflow.split("jobs:", maxsplit=1)[1]
        build_job, deploy_job = jobs.split("  deploy:", maxsplit=1)

        self.assertIn(
            'build --config=ci-cached --remote_cache="${BAZEL_REMOTE_CACHE:-}" '
            "--remote_download_outputs=toplevel //:build",
            build_ci,
        )
        self.assertIn("--source bazel-bin/build --destination build", build_ci)
        self.assertIn("test --config=ci //:local_validation_suite", check_ci)
        self.assertIn("workflow_run:", top_level)
        self.assertIn("workflows: [CI]", top_level)
        self.assertIn("types: [completed]", top_level)
        self.assertNotIn("  push:", top_level)
        self.assertNotIn("  pull_request:", top_level)
        self.assertIn("  workflow_dispatch:", top_level)
        self.assertIn("runs-on: tinyland-nix", build_job)
        self.assertNotIn("runs-on: tinyland-nix", deploy_job)
        self.assertIn(
            f"tinyland-inc/ci-templates/.github/actions/setup-nix@{CI_TEMPLATES_REF}",
            build_job,
        )
        self.assertNotIn("tinyland-inc/ci-templates/.github/actions/setup-nix@v2\n", build_job)
        self.assertIn("github.event.workflow_run.conclusion == 'success'", build_job)
        self.assertIn("github.event.workflow_run.event == 'push'", build_job)
        self.assertIn("github.event.workflow_run.head_sha == github.sha", build_job)
        self.assertIn("github.event.workflow_run.head_sha || github.sha", build_job)
        self.assertIn("if: github.event_name != 'workflow_run'", build_job)
        self.assertIn("nix develop --command just check-ci", build_job)
        self.assertIn("nix develop --command just build-ci", build_job)
        self.assertNotIn("nix develop --command just setup", build_job)
        self.assertNotIn("cachix/install-nix-action", build_job)
        self.assertNotIn("pages: write", top_level)
        self.assertNotIn("id-token: write", top_level)
        self.assertNotIn("pages: write", build_job)
        self.assertNotIn("id-token: write", build_job)
        self.assertIn("pages: write", deploy_job)
        self.assertIn("id-token: write", deploy_job)
        self.assertNotIn("github.event_name != 'pull_request'", deploy_job)
        self.assertIn("runs-on: tinyland-nix", cloudflare_example)
        self.assertIn(
            f"tinyland-inc/ci-templates/.github/actions/setup-nix@{CI_TEMPLATES_REF}",
            cloudflare_example,
        )
        self.assertIn("actions/checkout@v7", cloudflare_example)
        self.assertIn("nix develop --command just check-ci", cloudflare_example)
        self.assertIn("nix develop --command just build-ci", cloudflare_example)

    def test_ci_template_consumers_share_one_semver_release(self) -> None:
        pattern = re.compile(
            r"tinyland-inc/ci-templates/[^\s\"']+@(v\d+\.\d+\.\d+)"
        )
        surfaces = (
            ".github/workflows/ci.yml",
            ".github/workflows/deploy-pages.yml",
            "docs/deploy/cloudflare-pages.md",
        )
        observed: set[str] = set()

        for relative_path in surfaces:
            text = (ROOT / relative_path).read_text(encoding="utf-8")
            matches = pattern.findall(text)
            self.assertTrue(matches, f"{relative_path} has no ci-templates release")
            observed.update(matches)

        self.assertEqual(observed, {CI_TEMPLATES_REF})

    def test_setup_installs_only_third_party_lockfile_dependencies(self) -> None:
        setup = _recipe(self.justfile, "setup")
        self.assertIn("pnpm install --frozen-lockfile", setup)
        self.assertNotIn("just setup", setup)
        self.assertNotIn("pnpm run", setup)
        self.assertNotIn("bazelisk", setup)

    def test_both_sanctioned_adapters_are_in_the_frozen_graph(self) -> None:
        dependencies = self.package["devDependencies"]
        self.assertIn("@sveltejs/adapter-static", dependencies)
        self.assertIn("@sveltejs/adapter-node", dependencies)
        lockfile = (ROOT / "pnpm-lock.yaml").read_text(encoding="utf-8")
        self.assertIn("      '@sveltejs/adapter-static':", lockfile)
        self.assertIn("      '@sveltejs/adapter-node':", lockfile)

    def test_playwright_uses_adapter_aware_preview(self) -> None:
        config = (ROOT / "playwright.config.ts").read_text(encoding="utf-8")
        self.assertIn("command: `just preview ${port}`", config)
        self.assertIn(
            "const webServerTimeout = process.env.CI ? 600_000 : 180_000;",
            config,
        )
        self.assertIn("timeout: webServerTimeout", config)
        self.assertNotIn("pnpm exec serve", config)

    def test_playwright_materializes_generated_tsconfig_before_loading_config(self) -> None:
        test_e2e = _recipe(self.justfile, "test-e2e")
        sync = _recipe(self.justfile, "sync")

        self.assertEqual(test_e2e.splitlines()[0], "test-e2e: sync playwright-ensure")
        self.assertIn("build //:sveltekit_types", sync)
        self.assertIn(
            "--source bazel-bin/.svelte-kit --destination .svelte-kit --required-path tsconfig.json",
            sync,
        )

    def test_rebrand_repairs_a_partial_adapter_node_conversion(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "scripts").mkdir()
            shutil.copy2(ROOT / "scripts/rebrand.sh", root / "scripts/rebrand.sh")
            (root / "package.json").write_text(
                json.dumps(
                    {
                        "name": "site.scaffold",
                        "devDependencies": {
                            "@sveltejs/adapter-static": "^3.0.10",
                            "@sveltejs/adapter-node": "^5.5.3",
                        },
                    }
                ),
                encoding="utf-8",
            )
            (root / "svelte.config.js").write_text(
                "import adapter from '@sveltejs/adapter-static';\n",
                encoding="utf-8",
            )
            (root / "BUILD.bazel").write_text(
                'data = [":node_modules/@sveltejs/adapter-static"]\n',
                encoding="utf-8",
            )
            (root / "tinyland.repo.json").write_text(
                json.dumps(
                    {
                        "taxonomy": {
                            "primary_role": "static-spoke-scaffold",
                            "spawned_repo_role": "static-spoke",
                        }
                    }
                ),
                encoding="utf-8",
            )

            command = ["bash", "scripts/rebrand.sh", "--adapter=node", "example.test"]
            subprocess.run(command, cwd=root, check=True, capture_output=True, text=True)

            build_file = root / "BUILD.bazel"
            manifest = root / "tinyland.repo.json"
            build_file.write_text(
                build_file.read_text(encoding="utf-8").replace("adapter-node", "adapter-static"),
                encoding="utf-8",
            )
            payload = json.loads(manifest.read_text(encoding="utf-8"))
            payload["taxonomy"]["spawned_repo_role"] = "static-spoke"
            manifest.write_text(json.dumps(payload), encoding="utf-8")

            subprocess.run(command, cwd=root, check=True, capture_output=True, text=True)

            dependencies = json.loads((root / "package.json").read_text(encoding="utf-8"))["devDependencies"]
            self.assertIn("@sveltejs/adapter-static", dependencies)
            self.assertIn("@sveltejs/adapter-node", dependencies)
            self.assertIn("adapter-node", build_file.read_text(encoding="utf-8"))
            self.assertIn("adapter-node", (root / "svelte.config.js").read_text(encoding="utf-8"))
            self.assertEqual(
                json.loads(manifest.read_text(encoding="utf-8"))["taxonomy"]["spawned_repo_role"],
                "app-stateful-spoke",
            )

    def test_normal_check_includes_cutover_contracts(self) -> None:
        check = _recipe(self.justfile, "check")
        self.assertIn("test-bazel-cutover-contracts", check.splitlines()[0])

    def test_build_metadata_is_a_stamped_bazel_input(self) -> None:
        self.assertIn('name = "build"', self.build_file)
        self.assertIn("stamp = 1", self.build_file)
        runner = (ROOT / "scripts/bazel/run-vite-build.mjs").read_text()
        self.assertIn("BAZEL_STABLE_STATUS_FILE", runner)
        self.assertIn("JS_BINARY__EXECROOT", runner)
        self.assertIn("prepareBuildWorkspace(options.workspace)", runner)
        self.assertIn("BUILD_OUTPUT_DIR: resolve(actionRoot, options.outputDir)", runner)
        self.assertIn("cwd: workspace", runner)
        self.assertNotIn("@build_metadata//", self.build_file)
        self.assertNotIn('name = "build_metadata"', self.build_file)

    def test_bazel_targets_use_direct_npm_labels(self) -> None:
        self.assertNotIn('\n        ":node_modules",', self.build_file)
        self.assertNotIn('data = [":node_modules"]', self.build_file)

    def test_manual_watch_targets_never_enter_remote_execution(self) -> None:
        for name in ("dev", "svelte_check_bin"):
            with self.subTest(target=name):
                target = _bazel_target(self.build_file, name)
                self.assertIn('"manual"', target)
                self.assertIn('"no-remote-exec"', target)
                self.assertNotIn('"flywheel-eligible"', target)
                self.assertNotIn('":app_srcs"', target)
                self.assertNotIn('":sveltekit_types"', target)

        dev_runner = (ROOT / "scripts/bazel/run-vite-dev.mjs").read_text(encoding="utf-8")
        check_runner = (ROOT / "scripts/bazel/run-svelte-check.mjs").read_text(encoding="utf-8")
        self.assertIn("BUILD_WORKSPACE_DIRECTORY", dev_runner)
        self.assertIn("cwd: workspace", dev_runner)
        self.assertIn("arguments_.includes('--watch')", check_runner)
        self.assertIn("cwd: watch ? workspace : process.cwd()", check_runner)
        self.assertIn("CHOKIDAR_USEPOLLING", check_runner)
        self.assertIn("typecheck-watch: sync", self.justfile)

    def test_only_proved_target_classes_enter_the_executor_filter(self) -> None:
        for name in ("sveltekit_types", "app_workspace"):
            with self.subTest(target=name):
                self.assertNotIn('"flywheel-eligible"', _bazel_target(self.build_file, name))

        for name in ("svelte_check_test", "eslint_test", "prettier_check_test", "analyze"):
            with self.subTest(target=name):
                target = _bazel_target(self.build_file, name)
                self.assertNotIn('"flywheel-eligible"', target)

        for name in ("build", "unit_tests"):
            with self.subTest(target=name):
                self.assertIn('"flywheel-eligible"', _bazel_target(self.build_file, name))

        self.assertIn('flywheel-runner-selftest target="//:unit_tests"', self.justfile)

    def test_eslint_declares_playwright_sources(self) -> None:
        eslint_target = _bazel_target(self.build_file, "eslint_test")
        self.assertIn('":e2e_srcs"', eslint_target)

    def test_coverage_uses_a_finite_vitest_action_and_declared_report(self) -> None:
        coverage_target = _bazel_target(self.build_file, "unit_test_coverage")
        recipe = _recipe(self.justfile, "test-coverage")
        wrapper = (ROOT / "scripts/bazel/run-vitest.mjs").read_text(encoding="utf-8")
        self.assertIn('"--coverage-output"', coverage_target)
        self.assertIn('out_dirs = ["coverage"]', coverage_target)
        self.assertIn('"manual"', coverage_target)
        self.assertIn('"no-remote-exec"', coverage_target)
        self.assertNotIn('"flywheel-eligible"', coverage_target)
        self.assertIn("build //:unit_test_coverage", recipe)
        self.assertIn("--source bazel-bin/coverage", recipe)
        self.assertNotIn("bazelisk coverage", recipe)
        self.assertIn("'--coverage'", wrapper)
        self.assertIn("'--coverage.reportsDirectory'", wrapper)

    def test_prettier_declares_the_repo_wide_format_surface(self) -> None:
        format_target = _bazel_target(self.build_file, "format_srcs")
        prettier_target = _bazel_target(self.build_file, "prettier_check_test")
        self.assertIn('"src/**/*.svelte"', format_target)
        self.assertIn('"scripts/**/*.mjs"', format_target)
        self.assertIn('"docs/**/*.json"', format_target)
        self.assertIn('".github/**/*.yml"', format_target)
        self.assertIn('".agents/**/*.yaml"', format_target)
        self.assertIn('"package.json"', format_target)
        for root_recursive_glob in (
            '"**/*.css"',
            '"**/*.html"',
            '"**/*.js"',
            '"**/*.json"',
            '"**/*.md"',
            '"**/*.mjs"',
            '"**/*.mts"',
            '"**/*.svelte"',
            '"**/*.ts"',
            '"**/*.yaml"',
            '"**/*.yml"',
        ):
            self.assertNotIn(root_recursive_glob, format_target)
        self.assertIn('":format_srcs"', prettier_target)
        self.assertNotIn('":app_srcs"', prettier_target)

    def test_unit_target_uses_declared_realpath_safe_workspace(self) -> None:
        workspace_target = _bazel_target(self.build_file, "app_workspace")
        build_target = _bazel_target(self.build_file, "build")
        unit_target = _bazel_target(self.build_file, "unit_tests")
        helper = (ROOT / "scripts/bazel/prepare-sveltekit-types.mjs").read_text()
        wrapper = (ROOT / "scripts/bazel/run-vitest.mjs").read_text()
        self.assertIn('load("@aspect_bazel_lib//lib:copy_to_directory.bzl"', self.build_file)
        self.assertIn('":app_srcs"', workspace_target)
        self.assertIn('":sveltekit_types"', workspace_target)
        self.assertIn('"MODULE.bazel"', workspace_target)
        self.assertIn('hardlink = "off"', workspace_target)
        self.assertIn('root_paths = ["."]', workspace_target)
        self.assertIn('":app_workspace"', build_target)
        self.assertIn('"$(rootpath :app_workspace)"', build_target)
        self.assertIn('":app_workspace"', unit_target)
        self.assertIn('"scripts/bazel/prepare-sveltekit-types.mjs"', unit_target)
        self.assertIn('"$(rootpath :app_workspace)"', unit_target)
        self.assertIn('entry_point = "scripts/bazel/run-vitest.mjs"', unit_target)
        self.assertNotIn('":node_modules"', unit_target)
        self.assertNotIn('":app_srcs"', unit_target)
        self.assertNotIn('":sveltekit_types"', unit_target)
        self.assertIn("process.env.TEST_TMPDIR", helper)
        self.assertIn("cpSync(declaredWorkspace, workspace", helper)
        self.assertIn("symlinkSync(declaredNodeModules", helper)
        self.assertIn("'.svelte-kit/tsconfig.json'", helper)
        self.assertIn("process.once('exit', cleanup)", helper)
        self.assertIn("cleanup();\n\t\tthrow error", helper)
        self.assertIn("['SIGINT', 130]", wrapper)
        self.assertIn("['SIGTERM', 143]", wrapper)
        self.assertNotIn("copyFileSync", helper)
        self.assertNotIn("realpathSync", helper)
        self.assertNotIn("bazel-out", helper)
        self.assertNotIn("JS_BINARY__EXECROOT", helper)
        self.assertNotIn("JS_BINARY__BINDIR", helper)
        self.assertIn("cwd: workspace", wrapper)

    def test_unit_workspace_setup_failure_removes_scratch_tree(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            workspace = root / "declared"
            scratch = root / "scratch"
            (workspace / "src").mkdir(parents=True)
            (workspace / ".svelte-kit").mkdir()
            scratch.mkdir()
            for relative_path in ("tsconfig.json", "vitest.config.ts", ".svelte-kit/tsconfig.json"):
                (workspace / relative_path).write_text("{}", encoding="utf-8")

            helper_url = (ROOT / "scripts/bazel/prepare-sveltekit-types.mjs").as_uri()
            script = f"""
                import {{ prepareSvelteKitTypes }} from {json.dumps(helper_url)};
                try {{
                    prepareSvelteKitTypes({json.dumps(str(workspace))});
                    process.exit(2);
                }} catch (error) {{
                    if (!String(error).includes('declared unit-test runfiles are missing node_modules')) {{
                        console.error(error);
                        process.exit(3);
                    }}
                }}
            """
            environment = {**os.environ, "TEST_TMPDIR": str(scratch)}
            subprocess.run(
                ["node", "--input-type=module", "--eval", script],
                check=True,
                capture_output=True,
                text=True,
                env=environment,
            )
            self.assertEqual(list(scratch.iterdir()), [])

    def test_analyze_has_distinct_declared_outputs(self) -> None:
        self.assertIn('name = "analyze"', self.build_file)
        self.assertIn('out_dirs = ["build-analyze", ".bundle-stats"]', self.build_file)

    def test_substrate_remains_shared_cache_backed(self) -> None:
        manifest = json.loads((ROOT / "tinyland.repo.json").read_text(encoding="utf-8"))
        self.assertEqual(manifest["enrollment"]["substrateMode"], "shared-cache-backed")
        workflow = (ROOT / ".github/workflows/ci.yml").read_text(encoding="utf-8")
        self.assertRegex(workflow, r"(?m)^\s{6}flywheel_config: flywheel\s*$")
        schema = (ROOT / "docs/CI-SCHEMA.md").read_text(encoding="utf-8")
        self.assertIn("TIN-2851", schema)


if __name__ == "__main__":
    unittest.main(verbosity=2)
