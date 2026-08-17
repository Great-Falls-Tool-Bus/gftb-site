#!/usr/bin/env python3
"""Assert Bazel-only ingestion of the in-house @tummycrypt/@tinyland packages.

TIN-2838 flipped the scaffold from an npm-shadow ingestion (org packages listed
as npm specifiers in package.json, versions kept in exact parity with the
bazel_dep pins) to Bazel-only ingestion: the org packages are graph-linked from
tinyland-inc/bazel-registry via `npm_link_package` and carry NO npm specifier at
all. The pnpm/npm path can no longer supply them.

The invariant this check enforces (conformance item 13):

  1. NO @tummycrypt/* or @tinyland/* npm specifier may remain in package.json
     (any of dependencies / devDependencies / peerDependencies /
     optionalDependencies). Any lingering specifier is npm-shadow ingestion and
     is forbidden.
  2. Every org package the repo graph-links MUST be present as BOTH a
     `bazel_dep(...)` in MODULE.bazel AND an `npm_link_package(...)` entry in
     BUILD.bazel (the two halves of a Bazel-only ingestion edge).

The report style matches the prior parity check: failures print to stderr as
`  - <detail>` bullets and the script exits non-zero; a clean run prints a
one-line ok summary and exits zero.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PACKAGE_JSON = ROOT / "package.json"
MODULE_BAZEL = ROOT / "MODULE.bazel"
BUILD_BAZEL = ROOT / "BUILD.bazel"
IN_HOUSE_SCOPES = ("@tummycrypt/", "@tinyland/")


def npm_to_bazel_module(package_name: str) -> str:
    scope, name = package_name.split("/", 1)
    return f"{scope[1:]}_{name}".replace("-", "_")


def load_inhouse_npm_specifiers() -> dict[str, str]:
    """Any @tummycrypt/@tinyland specifier still declared as an npm dependency."""
    package = json.loads(PACKAGE_JSON.read_text(encoding="utf-8"))
    specifiers: dict[str, str] = {}
    for section in ("dependencies", "devDependencies", "peerDependencies", "optionalDependencies"):
        for name, version in package.get(section, {}).items():
            if name.startswith(IN_HOUSE_SCOPES):
                specifiers[name] = str(version)
    return specifiers


def load_graph_linked_packages() -> set[str]:
    """npm package names graph-linked via npm_link_package in BUILD.bazel."""
    text = BUILD_BAZEL.read_text(encoding="utf-8")
    linked: set[str] = set()
    for match in re.finditer(
        r'npm_link_package\(\s*name\s*=\s*"node_modules/(@[^"]+)"',
        text,
        flags=re.MULTILINE,
    ):
        package_name = match.group(1)
        if package_name.startswith(IN_HOUSE_SCOPES):
            linked.add(package_name)
    return linked


def load_bazel_deps() -> set[str]:
    text = MODULE_BAZEL.read_text(encoding="utf-8")
    return {
        match.group(1)
        for match in re.finditer(
            r'bazel_dep\(\s*name\s*=\s*"([^"]+)"',
            text,
            flags=re.MULTILINE,
        )
    }


def main() -> int:
    failures: list[str] = []

    # (1) No org-package npm specifier may remain in package.json.
    npm_specifiers = load_inhouse_npm_specifiers()
    for name, version in sorted(npm_specifiers.items()):
        failures.append(
            f"{name} is still an npm specifier ({version!r}) in package.json; "
            f"in-house packages are Bazel-only (graph-linked via npm_link_package)"
        )

    # (2) Every graph-linked org package needs both bazel_dep + npm_link_package.
    graph_linked = load_graph_linked_packages()
    bazel_deps = load_bazel_deps()
    for package_name in sorted(graph_linked):
        module_name = npm_to_bazel_module(package_name)
        if module_name not in bazel_deps:
            failures.append(
                f"{package_name} is npm_link_package'd but has no matching "
                f"bazel_dep({module_name}) in MODULE.bazel"
            )

    if not graph_linked:
        failures.append(
            "no in-house npm_link_package entries found in BUILD.bazel; "
            "expected the @tummycrypt/* packages to be graph-linked"
        )

    if failures:
        print("Bazel-only ingestion check failed:", file=sys.stderr)
        for failure in failures:
            print(f"  - {failure}", file=sys.stderr)
        return 1

    print(
        f"Bazel-only ingestion ok: {len(graph_linked)} in-house package(s) "
        f"graph-linked (bazel_dep + npm_link_package), 0 npm specifiers in package.json"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
