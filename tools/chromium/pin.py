"""Refresh or check tools/chromium/nix-paths.json (R583, TIN-7477).

`just chromium-pin` runs this with --write: it evaluates the flake output
packages.<system>.e2e-chromium for each pinned system, records each store
path and the Chromium revision, and realises the output for this host. The
revision must equal the Chromium revision the locked @playwright/test drives
(playwright-core browsers.json); //:e2e_test re-checks that at run time
against the linked package, and this script refuses a flake whose revision
differs from the expected one recorded here.
Without --write it only checks that the file matches the flake.
"""

import argparse
import json
import platform
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PINS = ROOT / "tools/chromium/nix-paths.json"
SYSTEMS = ("x86_64-linux", "aarch64-darwin")
HOST = {("Linux", "x86_64"): "x86_64-linux", ("Darwin", "arm64"): "aarch64-darwin"}


def nix_eval(attr: str) -> str:
    return subprocess.run(
        ["nix", "eval", "--raw", f"{ROOT}#{attr}"], check=True, capture_output=True, text=True
    ).stdout.strip()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--write", action="store_true")
    args = parser.parse_args()
    current = json.loads(PINS.read_text(encoding="utf-8"))
    expected_revision = current["playwright_chromium_revision"]
    fresh = {"playwright_chromium_revision": expected_revision, "systems": {}}
    for system in SYSTEMS:
        revision = nix_eval(f"packages.{system}.e2e-chromium.revision")
        if revision != expected_revision:
            print(
                f"chromium-pin: the flake's {system} Chromium is revision {revision}, but the locked "
                f"@playwright/test drives {expected_revision}; move nixpkgs-playwright, not the pin",
                file=sys.stderr,
            )
            return 1
        fresh["systems"][system] = {"store_path": nix_eval(f"packages.{system}.e2e-chromium.outPath")}
    if not args.write:
        if fresh != current:
            print("chromium-pin: tools/chromium/nix-paths.json is stale; run `just chromium-pin`", file=sys.stderr)
            return 1
        print("chromium-pin: tools/chromium/nix-paths.json matches the flake")
        return 0
    PINS.write_text(json.dumps(fresh, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    host = HOST.get((platform.system(), platform.machine()))
    if host:
        # The out-link is the GC root that keeps the pinned store path alive
        # (gitignored and bazelignored); without it a Nix GC removes the
        # browser and @chromium_nix refuses to resolve.
        subprocess.run(
            ["nix", "build", "--out-link", str(ROOT / ".e2e-chromium"), f"{ROOT}#packages.{host}.e2e-chromium"],
            check=True,
        )
    print(f"chromium-pin: wrote {PINS.relative_to(ROOT)}; realised {host or 'nothing for this host'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
