#!/usr/bin/env python3
"""Reject removed application/PR receiver reach (TIN-2423 / TIN-3066).

Application and PR lifecycle authority belongs to each product owner overlay.
This scaffold therefore has no general Blahaj receiver allowlist. Immutable
release evidence under docs/release/evidence/ is exempt; current authority
docs, schemas, build inputs, templates, configuration, and public indexes are
all scanned regardless of suffix.

Flagged reach classes (TIN-2423 item 1):
  repo-ref    a tinyland-inc/blahaj reference (module source, workflow
              dispatch target, checkout) in a code surface
  path-reach  a sibling/home-relative filesystem reach into a blahaj
              checkout (../blahaj, ~/git/blahaj, /git/blahaj)
  state-key   an OpenTofu backend key under the blahaj/ state prefix

Exit 0 = no direct reach or removed receiver artifact.
Exit 1 = a removed path, receiver fragment, or state-prefix reach remains.
"""
from __future__ import annotations

import re
import subprocess
import sys
from collections import Counter
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
SELF = Path(__file__).resolve().relative_to(REPO)

# Scan every tracked surface by default. Only immutable release evidence is
# historical: current authority docs, schemas, build files, lock files,
# templates, and GitHub configuration remain in scope regardless of suffix.
HISTORICAL_DOC_PREFIXES = ("docs/release/evidence/",)

# The v2 role schema intentionally names the current generic cluster/mail
# substrate and the inherited migration inventory. These four exact constants
# do not grant this scaffold application/PR receiver authority. Their path,
# spelling, and multiplicity are count-checked in self_test; every other direct
# tinyland-inc/blahaj reference remains forbidden.
V2_ROLE_SCHEMA = Path("docs/schemas/tinyland-repo-manifest.v2.schema.json")
EXPECTED_V2_GENERIC_SUBSTRATE_REFS = Counter(
    {
        '"cluster_substrate_authority": { "const": "tinyland-inc/blahaj" },': 2,
        '"mail_substrate_authority": { "const": "tinyland-inc/blahaj" },': 1,
        '"receiver": { "const": "tinyland-inc/blahaj" },': 1,
    }
)

FORBIDDEN_PATHS = {
    ".github/workflows/lane-env.yml",
    ".github/workflows/production-admission.yml",
    "config/production-admission.example.json",
    "config/substrate-boundary-allowlist.json",
    "docs/schemas/blahaj-dispatch.schema.json",
    "docs/schemas/lane-ttl-reap-dispatch.schema.json",
    "docs/schemas/public-preview-dispatch.schema.json",
    "scripts/check-production-admission.mjs",
    "scripts/lane-dispatch.py",
    "tofu/dynamic-spoke-deploy-target.tf",
}

PATTERNS = {
    "repo-ref": re.compile(r"tinyland-inc/blahaj", re.IGNORECASE),
    "path-reach": re.compile(r"(\.\./|~/git/|/git/)blahaj\b", re.IGNORECASE),
    "state-key": re.compile(
        r'(?:"key"|\bkey)\s*(?:=|:)\s*"blahaj/', re.IGNORECASE
    ),
    "legacy-ci-template-receiver": re.compile(
        r"tinyland-inc/ci-templates/\.github/workflows/spoke-lane-env\.yml",
        re.IGNORECASE,
    ),
    "legacy-dispatch-token": re.compile(
        r"\bBLAHAJ_DISPATCH_TOKEN\b", re.IGNORECASE
    ),
    "legacy-lane-sender": re.compile(
        r"\bscripts/lane-dispatch\.py\b", re.IGNORECASE
    ),
    "legacy-dispatch-schema": re.compile(
        r"\b(?:blahaj-dispatch|lane-ttl-reap-dispatch|public-preview-dispatch)"
        r"\.schema\.json\b",
        re.IGNORECASE,
    ),
}


def tracked_files() -> list[Path]:
    out = subprocess.run(
        ["git", "ls-files"],
        cwd=REPO, capture_output=True, text=True, check=True,
    ).stdout.splitlines()
    return [Path(path) for path in sorted(set(out))]


def tracked_code_files() -> list[Path]:
    return [
        path
        for path in tracked_files()
        if path != SELF
        and not any(
            path.as_posix().startswith(prefix)
            for prefix in HISTORICAL_DOC_PREFIXES
        )
    ]


def forbidden_path_violations(files: list[Path]):
    return [
        (str(path), 0, "removed-path", "receiver artifact must remain absent")
        for path in files
        if str(path).casefold() in FORBIDDEN_PATHS
    ]


def is_expected_v2_generic_substrate_ref(rel: Path, line: str) -> bool:
    return (
        rel == V2_ROLE_SCHEMA
        and line.strip() in EXPECTED_V2_GENERIC_SUBSTRATE_REFS
    )


def observed_v2_generic_substrate_refs() -> Counter[str]:
    observed: Counter[str] = Counter()
    for line in (REPO / V2_ROLE_SCHEMA).read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if PATTERNS["repo-ref"].search(stripped):
            observed[stripped] += 1
    return observed


def scan(files: list[Path]):
    violations = []
    for rel in files:
        path = REPO / rel
        try:
            text = path.read_text(errors="replace")
        except (OSError, IsADirectoryError):
            continue
        for lineno, line in enumerate(text.splitlines(), 1):
            for kind, rx in PATTERNS.items():
                if not rx.search(line):
                    continue
                if kind == "repo-ref" and is_expected_v2_generic_substrate_ref(
                    rel, line
                ):
                    continue
                record = (str(rel), lineno, kind, line.strip()[:120])
                violations.append(record)
    return violations


def self_test() -> None:
    cases = {
        "repo-ref": 'uses: Tinyland-Inc/Blahaj/.github/workflows/x.yml@main',
        "path-reach": 'source = "../blahaj/tofu/modules/thing"',
        "state-key": '"KeY": "BLAHAJ/mail/terraform.tfstate"',
        "legacy-ci-template-receiver": (
            "uses: tinyland-inc/ci-templates/.github/workflows/"
            "SPOKE-LANE-ENV.yml@v2.11.0"
        ),
        "legacy-dispatch-token": "blahaj_dispatch_token: forbidden",
        "legacy-lane-sender": "Scripts/Lane-Dispatch.py",
        "legacy-dispatch-schema": "PUBLIC-PREVIEW-DISPATCH.SCHEMA.JSON",
    }
    for kind, sample in cases.items():
        if not PATTERNS[kind].search(sample):
            raise SystemExit(f"self-test FAILED: {kind!r} not detected")
    clean = 'key = "tinyland-infra/attic/terraform.tfstate"  # fine'
    if any(rx.search(clean) for rx in PATTERNS.values()):
        raise SystemExit("self-test FAILED: false positive on clean line")
    active_surfaces = {str(path) for path in tracked_code_files()}
    expected_active_surfaces = {
        ".agents/skills/tinyland-whoami/SKILL.md",
        ".bazelrc",
        ".claude-plugin/marketplace.json",
        ".github/dependabot.yml",
        ".github/lanes.example.json",
        ".github/rulesets/default-branch.json",
        "AGENTS.md",
        "BUILD.bazel",
        "docs/CI-SCHEMA.md",
        "docs/patterns/production-convergence.md",
        "docs/schemas/lanes.schema.json",
        "flake.lock",
        "package.json",
        "README.md",
        "static/agent-map.md",
    }
    missing_surfaces = expected_active_surfaces - active_surfaces
    if missing_surfaces:
        raise SystemExit(
            "self-test FAILED: active authority surfaces evade scanning: "
            + ", ".join(sorted(missing_surfaces))
        )
    tracked = {str(path) for path in tracked_files()}
    expected_historical = {
        path
        for path in tracked
        if any(path.startswith(prefix) for prefix in HISTORICAL_DOC_PREFIXES)
    }
    observed_historical = tracked - active_surfaces - {str(SELF)}
    if observed_historical != expected_historical:
        raise SystemExit(
            "self-test FAILED: active tracked surfaces evade scanning: "
            + ", ".join(sorted(observed_historical - expected_historical))
        )
    for current_authority_path in (
        "docs/CI-SCHEMA.md",
        "docs/patterns/production-convergence.md",
        "docs/schemas/lanes.schema.json",
    ):
        if any(
            current_authority_path.startswith(prefix)
            for prefix in HISTORICAL_DOC_PREFIXES
        ):
            raise SystemExit(
                "self-test FAILED: current authority doc classified as historical: "
                + current_authority_path
            )
    observed_refs = observed_v2_generic_substrate_refs()
    if observed_refs != EXPECTED_V2_GENERIC_SUBSTRATE_REFS:
        raise SystemExit(
            "self-test FAILED: v2 generic substrate reference set drifted: "
            f"expected {dict(EXPECTED_V2_GENERIC_SUBSTRATE_REFS)!r}; "
            f"observed {dict(observed_refs)!r}"
        )
    forbidden = forbidden_path_violations([Path(".github/workflows/LANE-ENV.YML")])
    if not forbidden:
        raise SystemExit("self-test FAILED: deleted lane workflow path is not rejected")
    print("substrate-boundary self-test passed")


def main() -> int:
    if "--self-test" in sys.argv:
        self_test()
        return 0
    violations = forbidden_path_violations(tracked_files()) + scan(tracked_code_files())
    if violations:
        print(f"\nsubstrate-boundary FAILED: {len(violations)} removed or direct "
              f"receiver reach(es) remain; application and PR lifecycle must "
              f"be owned by the product owner overlay:",
              file=sys.stderr)
        for rel, lineno, kind, frag in violations:
            location = f"{rel}:{lineno}" if lineno else rel
            print(f"  [{kind}] {location}: {frag}", file=sys.stderr)
        return 1
    print("substrate-boundary validation passed (0 removed or direct receiver reaches)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
