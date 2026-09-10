# Great Falls Tool Bus public static site
set dotenv-load
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

dev:
    cd {{ root }} && bazelisk run //:dev

dev-open:
    cd {{ root }} && bazelisk run //:dev -- --open

# Local/operator materialization of the same fail-closed //:scanned_build graph
# packaged by //:deployment_bundle. The action fabric executes the finite plan
# through the compiled client; this recipe is not a CI or execution fallback.
#
# //:scanned_build copies //:build and leak-scans that copy in one Bazel action.
# A failed scan yields no declared output, so an unscanned build cannot reach
# this recipe or the owner publication transaction.
# Materialization is publish-once: the destination must be absent, and any
# existing output or transaction residue fails closed and remains untouched.
build:
    cd {{ root }} && bazelisk build //:scanned_build
    cd {{ root }} && python3 scripts/bazel_output.py materialize --source bazel-bin/scanned-build --destination build

preview port="4173": build
    cd {{ root }} && python3 scripts/bazel_output.py preview --port {{ port }}

# Release the build JVM before Chromium starts inside the bounded ARC runner.
preview-e2e port="4173": build
    cd {{ root }} && bazelisk shutdown
    cd {{ root }} && python3 scripts/bazel_output.py preview --port {{ port }}

preview-only port="4173":
    cd {{ root }} && python3 scripts/bazel_output.py preview --port {{ port }}

clean:
    rm -rf {{ root }}/build {{ root }}/.svelte-kit {{ root }}/.bundle-stats

typecheck:
    cd {{ root }} && bazelisk test //:svelte_check_test

typecheck-watch:
    cd {{ root }} && bazelisk run //:svelte_check_bin -- --watch

lint:
    cd {{ root }} && bazelisk test //:lint_suite

[positional-arguments]
format *paths=".": format-nix
    cd {{ root }} && pnpm exec prettier --write -- "$@"

format-nix:
    cd {{ root }} && nixfmt flake.nix

format-check: format-check-nix
    cd {{ root }} && bazelisk test //:prettier_check_test

format-check-nix:
    cd {{ root }} && nixfmt --check flake.nix

test-unit:
    cd {{ root }} && bazelisk test //:unit_tests

test-coverage:
    cd {{ root }} && bazelisk build //:unit_test_coverage
    cd {{ root }} && python3 scripts/bazel_output.py materialize --source bazel-bin/coverage --destination coverage --required-path index.html

test-e2e:
    cd {{ root }} && if command -v nix >/dev/null 2>&1; then \
      nix develop .#playwright --command just _playwright-run; \
    else \
      just _playwright-run; \
    fi

playwright-ensure:
    cd {{ root }} && pnpm exec playwright install chromium
    cd {{ root }} && if [[ "$(uname -s)" == "Linux" ]]; then \
      command -v auto-patchelf >/dev/null; \
      test -x "${PLAYWRIGHT_NIX_PATCHELF:?Playwright Nix patchelf contract is required}"; \
      chromium_executable="$(node -e 'const { chromium } = require("@playwright/test"); process.stdout.write(chromium.executablePath())')"; \
      chromium_dir="$(dirname "$(dirname "$chromium_executable")")"; \
      cache_root="$(dirname "$chromium_dir")"; \
      revision="${chromium_dir##*-}"; \
      headless_dir="${cache_root}/chromium_headless_shell-${revision}"; \
      test -d "$headless_dir"; \
      IFS=: read -r -a playwright_libraries <<<"${PLAYWRIGHT_NIX_LIBRARY_PATH:?Playwright Nix library contract is required}"; \
      PATH="$(dirname "$PLAYWRIGHT_NIX_PATCHELF"):$PATH" auto-patchelf --preserve-origin --paths "$headless_dir" --libs "${playwright_libraries[@]}"; \
      mapfile -d '' -t headless_executables < <(find "$headless_dir" -type f \( -name chrome-headless-shell -o -name headless_shell \) -perm -0100 -print0); \
      test "${#headless_executables[@]}" -eq 1; \
      patched_interpreter="$("$PLAYWRIGHT_NIX_PATCHELF" --print-interpreter "${headless_executables[0]}")"; \
      test "$patched_interpreter" = "${PLAYWRIGHT_NIX_DYNAMIC_LINKER:?Playwright Nix loader contract is required}"; \
      browser_version="$(env -u LD_LIBRARY_PATH "${headless_executables[0]}" --version)"; \
      test -n "$browser_version"; \
      printf 'Playwright browser ABI contract: %s via %s\n' "$browser_version" "$patched_interpreter"; \
    fi

_playwright-run: playwright-ensure
    cd {{ root }} && just _playwright-test

_playwright-test:
    cd {{ root }} && if [[ "$(uname -s)" == "Linux" ]]; then \
      test -r "${FONTCONFIG_FILE:?Playwright Linux requires the Nix font contract}"; \
      family="$(fc-match --format='%{family}' sans-serif)"; \
      grep -qi 'DejaVu' <<<"$family"; \
      printf 'Playwright font contract: %s via %s\n' "$family" "$FONTCONFIG_FILE"; \
    fi
    cd {{ root }} && env -u LD_LIBRARY_PATH pnpm exec playwright test

secrets-scan-dir:
    cd {{ root }} && gitleaks dir --config .gitleaks.toml --redact --verbose .

secrets-scan:
    cd {{ root }} && gitleaks git --config .gitleaks.toml --redact --verbose .

endpoint-check:
    @cd {{ root }} && if grep -RInE '(grpc|grpcs)://|https?://[^[:space:]"]*(bazel-cache|reapi)|10\.[0-9]+\.[0-9]+\.[0-9]+' \
      --exclude-dir=.git --exclude-dir=.direnv --exclude-dir=node_modules --exclude='*.lock' \
      .bazelrc .github/workflows BUILD.bazel MODULE.bazel flake.nix 2>/dev/null; then \
      echo "endpoint-check: forbidden endpoint literal found" >&2; exit 1; \
    else echo "endpoint-check: no cache, executor, or private-network endpoint literals"; fi

# Derive the page/post source map (demo #94 pattern; addendum B1.2 wires the
# "Edit this page" affordance per log post). The former "no source-map
# artifacts" posture was the stub's; the agent-surface bans it also carried
# (no /agent route, no llms.txt, no agent-map.md) remain below.
source-map-build:
    cd {{ root }} && node scripts/build-source-map.mjs

source-map-check:
    cd {{ root }} && bazelisk test //:source_map_drift_test

# Derive src/lib/generated/log-manifest.ts from src/content/log/*.svx —
# PUBLISHED entries only (B1 fix, PR #33 review: an eager glob over every
# entry, published or not, shipped every draft's prose to every visitor).
# src/lib/public-logs.ts imports this file and nothing else content-shaped,
# so an unpublished draft has no path into the client bundle. Mirrors
# source-map-build/-check exactly.
log-manifest-build:
    cd {{ root }} && node scripts/build-log-manifest.mjs

log-manifest-check:
    cd {{ root }} && bazelisk test //:log_manifest_drift_test

# Derive src/lib/generated/goals-manifest.ts from src/content/goals/*.md,
# PUBLISHED entries only: the log-manifest pattern for the home page's
# near-term goals, help asks, and member benefits (operator ruling 2026-08-31).
goals-manifest-build:
    cd {{ root }} && node scripts/build-goals-manifest.mjs

goals-manifest-check:
    cd {{ root }} && bazelisk test //:goals_manifest_drift_test

entrypoint-contract: conformance

workflow-validate:
    cd {{ root }} && bazelisk test //:workflow_validation_test

repo-manifest-validate: conformance

skills-validate:
    cd {{ root }} && python3 scripts/validate-skills.py

inhouse-package-parity:
    cd {{ root }} && python3 scripts/check-inhouse-package-parity.py

conformance:
    cd {{ root }} && bazelisk test //:bazel_output_contract_test

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

# Leak scan over a built artefact. scripts/check-build-output.mjs is a thin
# runner over scripts/lib/leak-scan.mjs — the same module src/lib/leak-scan.test.ts
# exercises, so the gate and its tests are one implementation, not two.
#
# Local artifact validation. The v4 build action requests //:deployment_bundle,
# which can package only //:scanned_build, through the compiled client.
#
# Fails closed in three ways: a missing/empty directory is not a pass (exit 2), a
# file whose extension the scanner has no verdict for is not a pass (exit 2), and
# any finding is a failure (exit 1). Set GFTB_LEAK_SCAN_DENY to add operator-held
# literals; never commit them.
# Stamped-artifact leak-scan (review B1 regression row). A local `just build`
# stamps the literal 'unknown', so the footer provenance branch never renders
# and the ordinary artifact scan cannot see what a PUBLISH-lane build emits:
# .github/workflows/container-ghcr.yml sets BUILD_COMMIT_SHA, and its `build`
# dependency materializes //:scanned_build — so a stamped-only finding
# red-lines the OCI lane. This recipe closes that blind spot: build with a FIXED
# fake sha (constant on purpose —
# the stamped stable-status is identical across runs, so caches still hit
# when sources are unchanged), prove the stamp actually rendered, and scan
# the scanned Bazel output in place. No second tree is materialized or cleaned.
leak-scan-stamped:
    cd {{ root }} && BUILD_COMMIT_SHA=deadbeefdeadbeefdeadbeefdeadbeefdeadbeef bazelisk build //:scanned_build
    cd {{ root }} && grep -q "deadbee" bazel-bin/scanned-build/index.html

leak-scan build_dir="build":
    cd {{ root }} && node scripts/check-build-output.mjs {{ build_dir }}

# Local entrypoint for the exact cacheable suite selected by the protected v4
# `validate` action. //:deployment_bundle independently enforces the scanned
# artifact boundary selected by `site-build`.
check:
    cd {{ root }} && bazelisk test //:ci_validation_suite
    @echo "All checks passed."

check-ci:
    cd {{ root }} && bazelisk test --config=ci //:ci_validation_suite
    @echo "All CI artifact checks passed."

# Local convenience aggregate. The v4 dispatcher does not invoke it.
ci: check test-e2e

sbom out_dir="build/sbom":
    cd {{ root }} && mkdir -p "{{ out_dir }}" && version="$(jq -r '.version' package.json)" && \
      syft scan dir:. --source-name gftb-site --source-version "$version" \
        --exclude './.git/**' --exclude './.direnv/**' --exclude './node_modules/**' \
        --exclude './build/**' --exclude './.svelte-kit/**' --exclude './bazel-*' \
        -o cyclonedx-json="{{ out_dir }}/gftb-site.cyclonedx.json" \
        -o spdx-json="{{ out_dir }}/gftb-site.spdx.json"

container-image-context:
    cd {{ root }} && bazelisk build //:container_image_context

# Linux-only, daemonless candidate publication. Builds through the canonical
# Bazel entrypoint, then packages the materialized static artifact with Nix.
container-image-publish: build container-image-context
    #!/usr/bin/env bash
    set -euo pipefail
    cd {{ root }}
    [[ "$(uname -s)" == "Linux" ]] || { echo "container-image-publish requires Linux" >&2; exit 2; }
    : "${GHCR_USER:?GHCR_USER is required}"
    : "${GHCR_TOKEN:?GHCR_TOKEN is required}"
    export BUILD_COMMIT_SHA="${BUILD_COMMIT_SHA:-$(git rev-parse HEAD)}"
    [[ "$BUILD_COMMIT_SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "BUILD_COMMIT_SHA must be 40 lowercase hex characters" >&2; exit 2; }
    export BUILD_COMMIT_REF="${BUILD_COMMIT_REF:-$(git rev-parse --abbrev-ref HEAD)}"
    export BUILD_DATE="$(git show -s --format=%cI "$BUILD_COMMIT_SHA")"
    export IMAGE_REF="ghcr.io/great-falls-tool-bus/gftb-site"
    export APP_BUILD="$PWD/build"
    nix run --impure .#image.copyToRegistry -- --dest-creds "${GHCR_USER}:${GHCR_TOKEN}"
    echo "published ${IMAGE_REF}:sha-${BUILD_COMMIT_SHA} (resolve and consume by digest)"

sync:
    cd {{ root }} && bazelisk build //:sveltekit_types
    cd {{ root }} && python3 scripts/bazel_output.py materialize --source bazel-bin/.svelte-kit --destination .svelte-kit --required-path tsconfig.json

analyze:
    cd {{ root }} && bazelisk build //:analyze
    cd {{ root }} && python3 scripts/bazel_output.py materialize --source bazel-bin/build-analyze --destination build
    cd {{ root }} && python3 scripts/bazel_output.py materialize --source bazel-bin/.bundle-stats --destination .bundle-stats --required-path stats.html

qr-generate:
    cd {{ root }} && mkdir -p static/qr && qrencode --type=SVG --svg-path --level=H --margin=2 --size=4 --output=static/qr/greatfallstoolbus-apex.svg "https://greatfallstoolbus.org/"

bazel-graph:
    cd {{ root }} && bazelisk mod graph

bazel-query target="//:ci_validation_suite":
    cd {{ root }} && bazelisk query "{{ target }}"

info:
    @echo "Site: greatfallstoolbus.org"
    @echo "Repo: Great-Falls-Tool-Bus/gftb-site"
    @echo "Root: {{ root }}"
