#!/usr/bin/env python3
"""R575 closure test for //:lint_suite (TIN-7477, design contract test 2).

`just lint-closure` analyzes //:lint_suite in a fresh output base with a fresh
repository cache, recording every fetch as a BEP event (`bazel vendor` writes
no BEP), then vendors it into a fresh vendor directory, and fails unless:

  (a) no npm sources repository (aspect_rules_js++npm+npm__*) exists beside
      the __links repositories: every package of the lint closure links from
      the P1 payload module, so none was downloaded from npm;
  (b) no fetch event names registry.npmjs.org or nodejs.org;
  (c) every npm_replace_package tag of npm_payload.MODULE.bazel is named by a
      vendored __links repository, so each replacement is the one in use;
  (d) no chromium_nix repository was fetched (critique N1): only //:e2e_test
      resolves the Chromium toolchain.

--vendor-dir, --repository-cache and --output-base reuse given directories
(they must be empty unless --offline). --offline is the form for a host without network:
it skips the vendor run and checks an existing vendor directory with
`build --nobuild --repository_disable_download`. Extra arguments after `--`
go to Bazel (for example --override_module for a local payload probe).
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
NPM_PREFIX = "aspect_rules_js++npm+npm__"
FORBIDDEN_HOSTS = ("registry.npmjs.org", "nodejs.org")
TAG = re.compile(
    r'^npm\.npm_replace_package\(package = "(?P<key>[^"]+)", '
    r'replacement = "@xoxd_npm_gftb_site_lint//:(?P<target>[^"]+)"\)$',
    re.MULTILINE,
)


def fresh_dir(given: str | None, label: str, allow_full: bool) -> Path:
    if given:
        path = Path(given).resolve()
        path.mkdir(parents=True, exist_ok=True)
        if not allow_full and any(path.iterdir()):
            raise SystemExit(f"lint-closure: {label} {path} must be empty")
        return path
    return Path(tempfile.mkdtemp(prefix=f"gftb-lint-closure-{label}-", dir=os.environ.get("TMPDIR")))


def fetch_urls(bep: Path) -> list[str]:
    urls = []
    if not bep.exists():
        return urls
    for line in bep.read_text(encoding="utf-8").splitlines():
        event = json.loads(line)
        fetch = event.get("id", {}).get("fetch")
        if fetch and "url" in fetch:
            urls.append(fetch["url"])
    return urls


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--vendor-dir")
    parser.add_argument("--repository-cache")
    parser.add_argument("--output-base")
    parser.add_argument("--bazel", default=os.environ.get("BAZEL", "bazelisk"))
    parser.add_argument("--offline", action="store_true")
    parser.add_argument("bazel_args", nargs="*")
    args = parser.parse_args()

    vendor = fresh_dir(args.vendor_dir, "vendor", allow_full=args.offline)
    cache = fresh_dir(args.repository_cache, "repository-cache", allow_full=args.offline)
    output_base = fresh_dir(args.output_base, "output-base", allow_full=args.offline)
    bep = Path(tempfile.mkdtemp(prefix="gftb-lint-closure-bep-", dir=os.environ.get("TMPDIR"))) / "bep.json"
    startup = [args.bazel, f"--output_base={output_base}", "--batch"]
    common = [f"--repository_cache={cache}", *args.bazel_args]
    if args.offline:
        steps = [["build", "--nobuild", "--repository_disable_download", f"--vendor_dir={vendor}",
                  f"--build_event_json_file={bep}", *common, "//:lint_suite"]]
    else:
        steps = [
            ["build", "--nobuild", f"--build_event_json_file={bep}", *common, "//:lint_suite"],
            ["vendor", f"--vendor_dir={vendor}", *common, "//:lint_suite"],
        ]
    env = {**os.environ, "ASPECT_TOOLS_TELEMETRY": "off"}
    status = 0
    for step in steps:
        print("lint-closure:", " ".join(startup + step), flush=True)
        status = subprocess.run(startup + step, cwd=ROOT, env=env).returncode
        if status != 0:
            break
    failures = []
    if status != 0:
        failures.append(f"bazel exited {status}")

    names = sorted(p.name for p in vendor.iterdir() if p.is_dir()) if vendor.exists() else []
    sources = [n for n in names if n.startswith(NPM_PREFIX) and not n.endswith("__links")]
    links = [n for n in names if n.startswith(NPM_PREFIX) and n.endswith("__links")]
    if sources:
        failures.append(f"(a) {len(sources)} npm sources repositories were vendored, first {sources[0]}")
    if not links:
        failures.append("(a) no __links repository was vendored, so the check would be vacuous")

    urls = fetch_urls(bep)
    if not args.offline and not urls:
        failures.append("(b) the cold analysis recorded no fetch event, so the check would be vacuous")
    bad = [u for u in urls if any(host in u for host in FORBIDDEN_HOSTS)]
    if bad:
        failures.append(f"(b) {len(bad)} fetch events name npm or nodejs.org, first {bad[0]}")

    tags = TAG.findall((ROOT / "npm_payload.MODULE.bazel").read_text(encoding="utf-8"))
    named = set()
    for name in links:
        defs = vendor / name / "defs.bzl"
        if defs.exists():
            named.update(re.findall(r"xoxd_npm_gftb_site_lint\+?//:([A-Za-z0-9_.@+-]+)", defs.read_text(encoding="utf-8")))
    unused = sorted(target for _, target in tags if target not in named)
    if not tags:
        failures.append("(c) npm_payload.MODULE.bazel has no replacement tags")
    if unused:
        failures.append(f"(c) {len(unused)} replacement tags are named by no __links repository, first {unused[0]}")

    chromium = [n for n in names if "chromium_nix" in n]
    if chromium:
        failures.append(f"(d) the lint vendor fetched {chromium[0]}")

    print(
        json.dumps(
            {
                "vendor_dir": str(vendor),
                "output_base": str(output_base),
                "bep": str(bep),
                "npm_sources_repositories": len(sources),
                "npm_links_repositories": len(links),
                "fetch_events": len(urls),
                "forbidden_fetch_events": len(bad),
                "replacement_tags": len(tags),
                "replacement_tags_in_use": len(tags) - len(unused),
                "chromium_nix_repositories": len(chromium),
            },
            sort_keys=True,
        )
    )
    for failure in failures:
        print(f"lint-closure: FAIL {failure}", file=sys.stderr)
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
