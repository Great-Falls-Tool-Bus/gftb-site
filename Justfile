# Great Falls Tool Bus public static site
set shell := ["bash", "-euo", "pipefail", "-c"]

root := justfile_directory()

_default:
    @just --list --unsorted

setup:
    cd {{ root }} && pnpm install --frozen-lockfile

deps-lock:
    cd {{ root }} && pnpm install --lockfile-only

flake-lock:
    cd {{ root }} && nix flake lock

# The image-custodied client owns admission, source binding, remote execution,
# and export qualification. A result destination must be new and absolute;
# the client refuses an existing directory rather than replacing evidence.
build result_dir=(root + "/.gf-site-build-result"):
    cd {{ root }} && /usr/local/bin/gf-action-client run --plan .github/lanes.json --action site-build --source-sha "$(git rev-parse HEAD)" --result-dir "{{ result_dir }}"

# These names select the same finite validation action; they do not create
# independently scheduled jobs or a local test/build path.
typecheck: check

lint: check

format-check: check

test-unit: check

secrets-scan-dir: check

endpoint-check: check

format: format-nix
    cd {{ root }} && pnpm exec prettier --write .

format-nix:
    cd {{ root }} && nixfmt flake.nix

# Derive the page/post source map (demo #94 pattern; addendum B1.2 wires the
# "Edit this page" affordance per log post). The former "no source-map
# artifacts" posture was the stub's; the agent-surface bans it also carried
# (no /agent route, no llms.txt, no agent-map.md) remain below.
source-map-build:
    cd {{ root }} && node scripts/build-source-map.mjs

source-map-check: check

# Derive src/lib/generated/log-manifest.ts from src/content/log/*.svx —
# PUBLISHED entries only (B1 fix, PR #33 review: an eager glob over every
# entry, published or not, shipped every draft's prose to every visitor).
# src/lib/public-logs.ts imports this file and nothing else content-shaped,
# so an unpublished draft has no path into the client bundle. Mirrors
# source-map-build/-check exactly.
log-manifest-build:
    cd {{ root }} && node scripts/build-log-manifest.mjs

log-manifest-check: check

# Derive src/lib/generated/goals-manifest.ts from src/content/goals/*.md,
# PUBLISHED entries only: the log-manifest pattern for the home page's
# near-term goals, help asks, and member benefits (operator ruling 2026-08-31).
goals-manifest-build:
    cd {{ root }} && node scripts/build-goals-manifest.mjs

goals-manifest-check: check

entrypoint-contract: conformance

workflow-validate: check

repo-manifest-validate: conformance

skills-validate: check

inhouse-package-parity: check

conformance: check

# Byte-reproducibility proof for the printed apex QR: regenerate the code from
# the canonical URL and compare it to the committed artefact. The pinned URL is
# first cross-checked against package.json's `homepage` — the independent pin
# the retired decode test held — so a payload typo needs a coordinated edit in
# two files to pass. Independent DECODE verification is a manual scan, per the
# failure guidance below.
#
# Local consequence of the same source tree consumed by the finite v4 actions.
# The protected suite pins the operator-approved SVG bytes, payload, and
# parameters cacheably; this recipe additionally reproduces the bytes with
# qrencode for a maintainer changing the approved artifact.
#
# The `<!-- Created with qrencode X.Y.Z ... -->` provenance line is stripped from
# BOTH sides before comparing. It records the encoder build, not the symbol, so a
# nixpkgs patch bump of qrencode would otherwise break this gate for every
# developer with an opaque `cmp: differ: byte N`. The strip is anchored to the
# exact comment shape (only the version digits may vary): anything else on that
# line survives into the byte-compare and fails it. Every module, dimension and
# path command is still compared exactly.
qr-verify:
    #!/usr/bin/env bash
    set -euo pipefail
    cd {{ root }}
    committed="static/qr/greatfallstoolbus-apex.svg"
    umask 077
    tmp="$(mktemp -d)"
    tmp_parent="$(dirname -- "$tmp")"
    tmp_name="$(basename -- "$tmp")"
    [[ -n "$tmp" && -d "$tmp" && ! -L "$tmp" && -O "$tmp" && "$(stat -c '%a' -- "$tmp")" == "700" ]] || {
      echo "qr-verify: mktemp did not create a private owned directory" >&2
      exit 1
    }
    cleanup() {
      if [[ -z "$tmp" || ! -d "$tmp" || -L "$tmp" || ! -O "$tmp" || "$(dirname -- "$tmp")" != "$tmp_parent" || "$(basename -- "$tmp")" != "$tmp_name" || "$(stat -c '%a' -- "$tmp")" != "700" ]]; then
        echo "qr-verify: refusing unsafe temporary-directory cleanup target" >&2
        return 1
      fi
      rm -f -- "$tmp/apex.svg" "$tmp/committed.stripped" "$tmp/fresh.stripped" "$tmp/diff"
      rmdir -- "$tmp"
    }
    trap cleanup EXIT
    pinned_url="https://greatfallstoolbus.org/"
    homepage="$(python3 -c 'import json; print(json.load(open("package.json"))["homepage"])')"
    if [[ "${homepage}/" != "$pinned_url" ]]; then
      echo "qr-verify: pinned payload URL ($pinned_url) does not match package.json homepage ($homepage) — the two pins must agree" >&2
      exit 1
    fi
    qrencode --type=SVG --svg-path --level=H --margin=2 --size=4 --output="$tmp/apex.svg" "$pinned_url"
    strip_provenance='\|^<!-- Created with qrencode [0-9][0-9]*\.[0-9][0-9]*\.[0-9][0-9]* (https://fukuchi\.org/works/qrencode/index\.html) -->$|d'
    sed "$strip_provenance" "$committed" >"$tmp/committed.stripped"
    sed "$strip_provenance" "$tmp/apex.svg" >"$tmp/fresh.stripped"
    if ! diff -u "$tmp/committed.stripped" "$tmp/fresh.stripped" >"$tmp/diff"; then
      # The module path is one very long line; truncate it so the guidance below
      # is not pushed off the top of a CI log.
      echo "--- committed (a) vs fresh qrencode run (b), long lines truncated to 160 columns ---" >&2
      cut -c1-160 "$tmp/diff" | head -40 >&2
      cat >&2 <<'GUIDANCE'
    qr-verify FAILED: the committed printed QR is not what `just qr-generate` now produces.
    The encoder-version comment line is already ignored, so this is a real difference
    in the symbol, its geometry, or the encoder's output format.

    What to do:
      1. Did the payload change? The canonical apex URL is pinned in BOTH
         `just qr-generate` and `just qr-verify`. It must stay https://greatfallstoolbus.org/.
      2. Did the encoder parameters change? They are pinned to
         --type=SVG --svg-path --level=H --margin=2 --size=4 in both recipes.
      3. If the difference is intended, regenerate and RE-PROVE the artefact:
           just qr-generate
           just qr-verify
         then scan the regenerated code with a real reader and confirm it still
         yields the apex URL: nobody can proofread a printed QR code by eye.
    GUIDANCE
      exit 1
    fi
    echo "qr-verify: $committed matches a fresh qrencode run (encoder-version comment ignored, $(grep -c '' "$tmp/committed.stripped") lines compared)"

# The export action can only package the already scanned public TreeArtifact.
leak-scan: build

check:
    cd {{ root }} && /usr/local/bin/gf-action-client run --plan .github/lanes.json --action validate --source-sha "$(git rev-parse HEAD)"

check-ci: check

# Both actions use the same fabric as CI; this does not add a browser action.
ci: check build

sbom out_dir="build/sbom":
    cd {{ root }} && mkdir -p "{{ out_dir }}" && version="$(jq -r '.version' package.json)" && \
      syft scan dir:. --source-name gftb-site --source-version "$version" \
        --exclude './.git/**' --exclude './.direnv/**' --exclude './node_modules/**' \
        --exclude './build/**' --exclude './.svelte-kit/**' --exclude './bazel-*' \
        -o cyclonedx-json="{{ out_dir }}/gftb-site.cyclonedx.json" \
        -o spdx-json="{{ out_dir }}/gftb-site.spdx.json"

qr-generate:
    cd {{ root }} && mkdir -p static/qr && qrencode --type=SVG --svg-path --level=H --margin=2 --size=4 --output=static/qr/greatfallstoolbus-apex.svg "https://greatfallstoolbus.org/"

info:
    @echo "Site: greatfallstoolbus.org"
    @echo "Repo: Great-Falls-Tool-Bus/gftb-site"
    @echo "Root: {{ root }}"
