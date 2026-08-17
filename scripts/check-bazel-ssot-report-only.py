#!/usr/bin/env python3
"""REPORT-ONLY Bazel-SSOT anti-pattern scan (TIN-2672 phase 1).

Doctrine: docs/research/bazel-ssot-packaging-dogfooding-2026-07.md.

Detects the two anti-patterns the doctrine names in its P4 section, so drift
cannot regrow silently before the fleet-wide flip to a hard-fail conformance
item:

  1. Anti-dogfooding package.json specifiers: an in-house `@tummycrypt/*` (or
     `@tinyland/*`) dependency declared as a `workspace:*` protocol specifier
     or a vendored tarball/producer-tree path, instead of an exact,
     bazel-registry-pinned npm version (doctrine rule 1). This is the
     mothership `workspace:*` + vendored anti-dogfooding case the doctrine
     scorecard calls out.

  2. Packaging tag-shape violations: a `pkg_tar`/container packaging Bazel
     target whose tags mix or omit pieces of the two disjoint packaging
     classes (doctrine rule 3):

       A. deployment_bundle (executor-safe):
          "deployment-bundle-packaging" + "flywheel-eligible"
       B. container_image_context (cache-only, never executor):
          "container-image-and-push" + "gloriousflywheel-cache-only" +
          "no-remote-exec", and MUST NOT carry "flywheel-eligible"

Graph<->shadow version parity (in-house npm pin vs bazel_dep) is NOT checked
here: `scripts/check-inhouse-package-parity.py` already gates it (conformance
item 13, `just inhouse-package-parity`).

WARN ONLY: this script always exits 0. It is intentionally non-gating for
TIN-2672 phase 1 so it is safe to land fleet-wide before the follow-up PR
flips it to hard-fail. Do not add a `sys.exit(1)` path here until that
follow-up lands.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

IN_HOUSE_SCOPES = ("@tummycrypt/", "@tinyland/")
DEP_SECTIONS = (
    "dependencies",
    "devDependencies",
    "peerDependencies",
    "optionalDependencies",
)

VENDORED_PATH_RE = re.compile(
    r"(\.tgz$|\.tar\.gz$|packages/(tinyland|tummycrypt)-)"
)

EXCLUDE_DIR_SEGMENTS = {
    "node_modules",
    ".git",
    "bazel-out",
    "bazel-bin",
    "bazel-testlogs",
}

# The full universe of packaging-shape tags the doctrine names.
PACKAGING_TAGS = {
    "deployment-bundle-packaging",
    "flywheel-eligible",
    "container-image-and-push",
    "gloriousflywheel-cache-only",
    "no-remote-exec",
}
# Tags that only ever appear on a packaging target; their presence is what
# triggers shape validation (unlike "flywheel-eligible", which also tags
# ordinary build/test targets and must not by itself trigger this check).
PACKAGING_TRIGGER_TAGS = {
    "deployment-bundle-packaging",
    "container-image-and-push",
    "gloriousflywheel-cache-only",
    "no-remote-exec",
}
CLASS_A = {"deployment-bundle-packaging", "flywheel-eligible"}
CLASS_B = {"container-image-and-push", "gloriousflywheel-cache-only", "no-remote-exec"}

RULE_CALL_RE = re.compile(r"\b([a-zA-Z_][a-zA-Z0-9_]*)\s*\(")


def _excluded(path: Path) -> bool:
    return any(seg in EXCLUDE_DIR_SEGMENTS or seg.startswith("bazel-") for seg in path.parts)


def find_package_jsons() -> list[Path]:
    return sorted(p for p in ROOT.rglob("package.json") if not _excluded(p.relative_to(ROOT)))


def find_build_files() -> list[Path]:
    files: list[Path] = []
    for pattern in ("BUILD.bazel", "BUILD"):
        # p.is_file() guards against directories: on case-insensitive
        # filesystems (macOS APFS) rglob("BUILD") also matches the build/
        # output directory.
        files.extend(
            p for p in ROOT.rglob(pattern)
            if p.is_file() and not _excluded(p.relative_to(ROOT))
        )
    return sorted(set(files))


def check_dogfooding() -> list[str]:
    """Flag in-house deps declared as workspace:* or a vendored path."""
    warnings: list[str] = []
    for pj in find_package_jsons():
        try:
            data = json.loads(pj.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            continue
        rel = pj.relative_to(ROOT)
        for section in DEP_SECTIONS:
            for name, version in (data.get(section) or {}).items():
                if not name.startswith(IN_HOUSE_SCOPES):
                    continue
                version = str(version)
                if version.startswith("workspace:"):
                    warnings.append(
                        f"{rel}: {section}.{name} = {version!r} uses the workspace:* "
                        "protocol instead of a bazel-registry-pinned exact npm version "
                        "(anti-dogfooding pattern)"
                    )
                elif VENDORED_PATH_RE.search(version):
                    warnings.append(
                        f"{rel}: {section}.{name} = {version!r} resolves to a vendored "
                        "tarball/producer-tree path instead of a bazel-registry-pinned "
                        "exact npm version (anti-dogfooding pattern)"
                    )
    return warnings


def extract_call_blocks(text: str) -> list[tuple[str, str]]:
    """Return (rule_name, block_text) for each top-level `rule(...)` call."""
    blocks: list[tuple[str, str]] = []
    i = 0
    n = len(text)
    while i < n:
        m = RULE_CALL_RE.search(text, i)
        if not m:
            break
        depth = 0
        j = m.end() - 1  # position of the opening '('
        while j < n:
            if text[j] == "(":
                depth += 1
            elif text[j] == ")":
                depth -= 1
                if depth == 0:
                    break
            j += 1
        if depth != 0:
            break  # unbalanced parens; stop defensively rather than mis-scan
        blocks.append((m.group(1), text[m.start() : j + 1]))
        i = j + 1
    return blocks


def check_packaging_tag_shape() -> list[str]:
    """Flag pkg_tar/container packaging targets with a mixed/incomplete tag shape."""
    warnings: list[str] = []
    for path in find_build_files():
        text = path.read_text(encoding="utf-8", errors="replace")
        rel = path.relative_to(ROOT)
        for rule, block in extract_call_blocks(text):
            tags_match = re.search(r"tags\s*=\s*\[(.*?)\]", block, re.DOTALL)
            if not tags_match:
                continue
            tags = set(re.findall(r'"([^"]+)"', tags_match.group(1)))
            trigger = tags & PACKAGING_TRIGGER_TAGS
            if not trigger:
                continue  # not a packaging target (e.g. an ordinary flywheel-eligible test)
            present = tags & PACKAGING_TAGS
            if present == CLASS_A or present == CLASS_B:
                continue  # conforms to one of the two disjoint shapes
            name_match = re.search(r'name\s*=\s*"([^"]+)"', block)
            name = name_match.group(1) if name_match else "<unknown>"
            warnings.append(
                f"{rel}: target '{name}' ({rule}) has a mixed/incomplete packaging tag "
                f"shape {sorted(present)!r}, must be exactly {sorted(CLASS_A)!r} "
                f"(deployment_bundle) or exactly {sorted(CLASS_B)!r} "
                "(container_image_context, never flywheel-eligible)"
            )
    return warnings


def main() -> int:
    print("REPORT-ONLY: will become hard-fail in a follow-up (TIN-2672 phase 1)")
    print("Bazel-SSOT anti-pattern scan (docs/research/bazel-ssot-packaging-dogfooding-2026-07.md)")
    print()

    dogfooding_warnings = check_dogfooding()
    print("1. Anti-dogfooding package.json specifiers (@tummycrypt/@tinyland)")
    if dogfooding_warnings:
        for w in dogfooding_warnings:
            print(f"  ⚠ REPORT-ONLY: {w}")
    else:
        print("  (none found)")

    tag_shape_warnings = check_packaging_tag_shape()
    print("2. Packaging tag-shape disjointness (pkg_tar/container targets)")
    if tag_shape_warnings:
        for w in tag_shape_warnings:
            print(f"  ⚠ REPORT-ONLY: {w}")
    else:
        print("  (none found)")

    total = len(dogfooding_warnings) + len(tag_shape_warnings)
    print()
    print(f"REPORT-ONLY summary: {total} warning(s). Non-gating for TIN-2672 phase 1; exit 0 regardless.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
