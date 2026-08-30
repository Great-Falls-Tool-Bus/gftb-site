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

# CI ENFORCEMENT: run by ci-templates spoke-ci.yml@v3.1.0 job `flywheel-build`,
# step "Static site build" (line 266-267: `nix develop --command just build`),
# and again by job `playwright` (line 375: `just test-e2e` -> playwright.config.ts
# webServer -> `just preview-e2e` -> `build`).
#
# leak-scan is the LAST step on purpose: it can only run against a materialized
# artefact, and a published tree that has never been scanned must not be
# publishable. Wiring it here (rather than into `just ci`, which no template job
# invokes) is what makes the gate actually execute on a pull request.
# Materialization is publish-once: the destination must be absent, and any
# existing output or transaction residue fails closed and remains untouched.
build:
    cd {{ root }} && bazelisk build //:build
    cd {{ root }} && python3 scripts/bazel_output.py materialize --source bazel-bin/build --destination build
    cd {{ root }} && {{ just_executable() }} leak-scan build

build-ci:
    cd {{ root }} && bazelisk build --config=ci-cached --remote_cache="${BAZEL_REMOTE_CACHE:-}" --remote_download_outputs=toplevel //:build
    cd {{ root }} && python3 scripts/bazel_output.py materialize --source bazel-bin/build --destination build
    cd {{ root }} && {{ just_executable() }} leak-scan build

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

format: format-nix
    cd {{ root }} && pnpm exec prettier --write .

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
      .bazelrc .bazelrc.flywheel .github/workflows BUILD.bazel MODULE.bazel flake.nix 2>/dev/null; then \
      echo "endpoint-check: forbidden endpoint literal found" >&2; exit 1; \
    else echo "endpoint-check: no cache, executor, or private-network endpoint literals"; fi

# Derive the page/post source map (demo #94 pattern; addendum B1.2 wires the
# "Edit this page" affordance per log post). The former "no source-map
# artifacts" posture was the stub's; the agent-surface bans it also carried
# (no /agent route, no llms.txt, no agent-map.md) remain below.
source-map-build:
    cd {{ root }} && node scripts/build-source-map.mjs

source-map-check: source-map-build
    @cd {{ root }} && git diff --exit-code -- src/lib/generated/source-map.json || { echo "source-map-check: src/lib/generated/source-map.json drifted; commit the regenerated map" >&2; exit 1; }
    @cd {{ root }} && test ! -d src/routes/agent && test ! -e static/llms.txt && test ! -e static/agent-map.md
    @echo "source-map-check: map is current; no agent surfaces"

# Derive src/lib/generated/log-manifest.ts from src/content/log/*.svx —
# PUBLISHED entries only (B1 fix, PR #33 review: an eager glob over every
# entry, published or not, shipped every draft's prose to every visitor).
# src/lib/public-logs.ts imports this file and nothing else content-shaped,
# so an unpublished draft has no path into the client bundle. Mirrors
# source-map-build/-check exactly.
log-manifest-build:
    cd {{ root }} && node scripts/build-log-manifest.mjs

log-manifest-check: log-manifest-build
    @cd {{ root }} && git diff --exit-code -- src/lib/generated/log-manifest.ts || { echo "log-manifest-check: src/lib/generated/log-manifest.ts drifted; commit the regenerated manifest" >&2; exit 1; }
    @echo "log-manifest-check: manifest is current"

entrypoint-contract:
    cd {{ root }} && python3 scripts/test-bazel-cutover-contracts.py

workflow-validate:
    cd {{ root }} && actionlint .github/workflows/*.yml

lanes-validate:
    cd {{ root }} && python3 scripts/validate-lanes.py

repo-manifest-validate:
    cd {{ root }} && python3 scripts/validate-lanes.py --schema docs/schemas/tinyland-repo-manifest.schema.json --instance tinyland.repo.json

skills-validate:
    cd {{ root }} && python3 scripts/validate-skills.py

inhouse-package-parity:
    cd {{ root }} && python3 scripts/check-inhouse-package-parity.py

conformance:
    cd {{ root }} && bash scripts/check-conformance.sh

flywheel-enrollment-contract-check:
    cd {{ root }} && bash scripts/flywheel-enrollment-contract-test.sh

# Byte-reproducibility proof for the printed apex QR: regenerate the code from
# the canonical URL and compare it to the committed artefact. The unit suite
# decodes the same file; this proves the generator still produces those bytes.
#
# CI ENFORCEMENT: reached through `just check`, run by ci-templates
# spoke-ci.yml@v3.1.0 job `flywheel-test`, step at line 291
# (`nix develop --command just check`), which lists qr-verify as a dependency.
#
# The `<!-- Created with qrencode X.Y.Z ... -->` provenance line is stripped from
# BOTH sides before comparing. It records the encoder build, not the symbol, so a
# nixpkgs patch bump of qrencode would otherwise break this gate for every
# developer with an opaque `cmp: differ: byte N`. Every module, dimension and
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
    qrencode --type=SVG --svg-path --level=H --margin=2 --size=4 --output="$tmp/apex.svg" "https://greatfallstoolbus.org/"
    strip_provenance='/^<!-- Created with qrencode /d'
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
           bazelisk test //:unit_tests --test_output=all --test_filter='printed apex QR'
         then update QR_SHA256 in src/lib/qr-code.test.ts to the new hash deliberately.
         Do not update the golden hash without a decode that still yields the apex URL:
         nobody can proofread a printed QR code by eye.
    GUIDANCE
      exit 1
    fi
    echo "qr-verify: $committed matches a fresh qrencode run (encoder-version comment ignored, $(grep -c '' "$tmp/committed.stripped") lines compared)"

# Leak scan over a built artefact. scripts/check-build-output.mjs is a thin
# runner over scripts/lib/leak-scan.mjs — the same module src/lib/leak-scan.test.ts
# exercises, so the gate and its tests are one implementation, not two.
#
# CI ENFORCEMENT: run as the last step of `just build` (see the comment there),
# which ci-templates spoke-ci.yml@v3.1.0 executes in job `flywheel-build`
# (line 267) and, transitively, in job `playwright` (line 375).
#
# Fails closed in three ways: a missing/empty directory is not a pass (exit 2), a
# file whose extension the scanner has no verdict for is not a pass (exit 2), and
# any finding is a failure (exit 1). Set GFTB_LEAK_SCAN_DENY to add operator-held
# literals; never commit them.
# Stamped-artifact leak-scan (review B1 regression row). A local `just build`
# stamps the literal 'unknown', so the footer provenance branch never renders
# and the ordinary artifact scan cannot see what a PUBLISH-lane build emits:
# .github/workflows/container-ghcr.yml sets BUILD_COMMIT_SHA, and its `build`
# dependency ends in leak-scan — so a stamped-only finding red-lines the OCI
# lane on the next push to main while every PR gate stays green. This recipe
# closes that blind spot: build with a FIXED fake sha (constant on purpose —
# the stamped stable-status is identical across runs, so caches still hit
# when sources are unchanged), prove the stamp actually rendered, and scan
# the Bazel output in place. No second tree is materialized or cleaned.
# Wired into `check`/`check-ci` so it runs per PR.
leak-scan-stamped:
    cd {{ root }} && BUILD_COMMIT_SHA=deadbeefdeadbeefdeadbeefdeadbeefdeadbeef bazelisk build //:build
    cd {{ root }} && grep -q "deadbee" bazel-bin/build/index.html
    cd {{ root }} && {{ just_executable() }} leak-scan bazel-bin/build

leak-scan build_dir="build":
    cd {{ root }} && node scripts/check-build-output.mjs {{ build_dir }}

# Repeatable QA evidence packet for one build, ready to paste into a review.
#
# PR CI GATE: the repo-local `qa-look` job invokes this recipe at the exact
# pull-request head and uploads `qa-packet/<sha>/` for the human LOOK. The
# directory remains git-ignored. The recipe has no recursive deletion: output
# is fixed to `qa-packet/<sha>` and an existing packet fails closed. This is also
# the reviewer/operator entrypoint, and it deliberately re-runs the gates
# rather than trusting a green tick from an earlier tree — the receipt in
# INDEX.md has to describe the SAME bytes the screenshots were taken of.
#
# Order matters: `build` materializes and leak-scans the artefact, `check` runs
# the four repo gates, then Bazel is shut down and `preview-only` serves those
# already-built bytes on ITS OWN port. Playwright CI keeps `preview-e2e: build`
# for its fresh job. The acceptance suite is pointed at the QA preview through
# playwright.qa-packet.config.ts, so this recipe never competes for the CI port
# and never silently rebuilds or reuses another lane's server.
# playwright.config.ts, which CI reads, is untouched.
#
# A failing acceptance suite does not abort the capture — a packet that shows
# what a regression looks like is the point — but the recipe still exits non-zero.
qa-packet port="3355":
    #!/usr/bin/env bash
    set -euo pipefail
    cd {{ root }}
    receipts_parent="${TMPDIR:-/tmp}"
    case "$receipts_parent" in
      /*) ;;
      *) echo "qa-packet: TMPDIR must be absolute" >&2; exit 1 ;;
    esac
    receipts="$(mktemp -d "${receipts_parent%/}/gftb-qa-receipts.XXXXXXXX")"
    [[ -n "$receipts" && -d "$receipts" ]] || {
      echo "qa-packet: mktemp did not create a receipts directory" >&2
      exit 1
    }
    receipts_parent="$(dirname "$receipts")"
    preview_pid=""
    kill_tree() {
      local pid="$1" child
      for child in $(pgrep -P "$pid" 2>/dev/null || true); do kill_tree "$child"; done
      kill "$pid" 2>/dev/null || true
    }
    cleanup() {
      if [[ -n "$preview_pid" ]]; then
        kill_tree "$preview_pid"
        wait "$preview_pid" 2>/dev/null || true
      fi
      if [[ -z "$receipts" || ! -d "$receipts" || "$(dirname "$receipts")" != "$receipts_parent" || "$(basename "$receipts")" != gftb-qa-receipts.* ]]; then
        echo "qa-packet: refusing unsafe receipts cleanup target" >&2
        return 1
      fi
      rm -f -- "$receipts/build.log" "$receipts/check.log" "$receipts/preview.log" "$receipts/e2e.json"
      rmdir -- "$receipts"
    }
    trap cleanup EXIT

    # A build failure aborts: there is no artefact to photograph. A gate failure
    # does not — a packet showing what the failure looks like is the point.
    {{ just_executable() }} build 2>&1 | tee "$receipts/build.log"
    check_status=0
    {{ just_executable() }} check 2>&1 | tee "$receipts/check.log" || check_status=$?

    bazelisk shutdown
    {{ just_executable() }} preview-only {{ port }} >"$receipts/preview.log" 2>&1 &
    preview_pid=$!
    for attempt in $(seq 1 300); do
      if (exec 3<>/dev/tcp/127.0.0.1/{{ port }}) 2>/dev/null; then break; fi
      if ! kill -0 "$preview_pid" 2>/dev/null; then
        echo "qa-packet: the preview exited before it started listening on {{ port }}" >&2
        cat "$receipts/preview.log" >&2
        exit 1
      fi
      sleep 1
      if [[ "$attempt" == "300" ]]; then
        echo "qa-packet: the preview never started listening on {{ port }}" >&2
        exit 1
      fi
    done

    e2e_status=0
    if command -v nix >/dev/null 2>&1; then
      nix develop .#playwright --command {{ just_executable() }} _qa-packet-e2e {{ port }} "$receipts/e2e.json" || e2e_status=$?
    else
      {{ just_executable() }} _qa-packet-e2e {{ port }} "$receipts/e2e.json" || e2e_status=$?
    fi

"    capture_args=(
      --port {{ port }}
      --build-log "$receipts/build.log"
      --check-log "$receipts/check.log"
      --e2e-json "$receipts/e2e.json"
    )
    if command -v nix >/dev/null 2>&1; then
      nix develop .#playwright --command node scripts/qa-packet.mjs "${capture_args[@]}"
    else
      node scripts/qa-packet.mjs "${capture_args[@]}"
    fi"

    if [[ "$check_status" != "0" || "$e2e_status" != "0" ]]; then
      echo "qa-packet: the packet was captured, but a gate failed (check exit $check_status, acceptance suite exit $e2e_status)" >&2
      exit 1
    fi

_qa-packet-e2e port json: playwright-ensure
    cd {{ root }} && env -u LD_LIBRARY_PATH QA_PACKET_BASE_URL="http://127.0.0.1:{{ port }}" \
      PLAYWRIGHT_JSON_OUTPUT_NAME="{{ json }}" \
      pnpm exec playwright test --config playwright.qa-packet.config.ts --reporter=json

# Per-image pixel diff between two packets produced by `just qa-packet`.
# Both arguments must be exact `qa-packet/<40hex>` directories in this
# checkout. Output is fixed under `qa-packet/diff/` and never replaces an
# existing diff. The comparison runs inside the same pinned Chromium rather than
# pulling `pixelmatch`/`pngjs` into package.json; see scripts/qa-packet-diff.mjs.
qa-packet-diff baseline candidate *options:
    cd {{ root }} && node scripts/qa-packet-diff.mjs {{ baseline }} {{ candidate }} {{ options }}

# CI ENFORCEMENT: ci-templates spoke-ci.yml@v3.1.0 job `flywheel-test`, line 291
# (`nix develop --command just check`), once per lane in .github/lanes.json.
# //:local_validation_suite carries //:unit_tests, so the acceptance unit gates
# (design-token-contrast, qr-code, leak-scan, public-log-build-contract) run on
# every pull request through this recipe.
check: flywheel-enrollment-contract-check secrets-scan-dir endpoint-check source-map-check log-manifest-check entrypoint-contract workflow-validate qr-verify conformance leak-scan-stamped
    cd {{ root }} && bazelisk test //:local_validation_suite
    @echo "All checks passed."

check-ci: flywheel-enrollment-contract-check secrets-scan-dir endpoint-check source-map-check log-manifest-check entrypoint-contract workflow-validate qr-verify conformance leak-scan-stamped
    cd {{ root }} && bazelisk test --config=ci //:local_validation_suite
    @echo "All CI artifact checks passed."

# Local convenience aggregate. NOTE: no ci-templates job invokes `just ci` — the
# template calls `just setup`, `just build`, `just check` and `just test-e2e`
# individually — so nothing may be enforced ONLY from here. `test-e2e` performs
# its own scanned fresh build through `preview-e2e`; materializing `build` first
# would violate the publish-once output contract.
ci: check test-e2e

sbom out_dir="build/sbom":
    cd {{ root }} && mkdir -p "{{ out_dir }}" && version="$(jq -r '.version' package.json)" && \
      syft scan dir:. --source-name gftb-site --source-version "$version" \
        --exclude './.git/**' --exclude './.direnv/**' --exclude './node_modules/**' \
        --exclude './build/**' --exclude './.svelte-kit/**' --exclude './bazel-*' \
        -o cyclonedx-json="{{ out_dir }}/gftb-site.cyclonedx.json" \
        -o spdx-json="{{ out_dir }}/gftb-site.spdx.json"

flywheel-enroll *args:
    cd {{ root }} && bash scripts/flywheel-enroll.sh {{ args }}

flywheel-doctor:
    cd {{ root }} && bash scripts/flywheel-doctor.sh

flywheel-verify:
    cd {{ root }} && bash scripts/flywheel-verify.sh

cache-contract-strict:
    cd {{ root }} && GF_BAZEL_SUBSTRATE_MODE="$(jq -r '.enrollment.substrateMode' tinyland.repo.json)" GF_BAZEL_RUNNER_LABELS="${GF_BAZEL_RUNNER_LABELS:-tinyland-nix}" bash scripts/cache-attachment-contract.sh --strict

flywheel-build target="//:build":
    cd {{ root }} && bash scripts/gloriousflywheel-bazel.sh build {{ target }}

flywheel-test target="//:ci_validation_suite":
    cd {{ root }} && bash scripts/gloriousflywheel-bazel.sh test {{ target }}

flywheel-fetch target="//...":
    cd {{ root }} && bash scripts/gloriousflywheel-bazel.sh fetch {{ target }}

# Cache-first Bazel test pass over the flywheel-eligible gates. //:unit_tests is
# in the default set because it carries the acceptance suite and is tagged
# `flywheel-eligible` in BUILD.bazel (so it is cache-eligible under
# --config=ci-cached exactly like the other three).
flywheel-check *targets="//:eslint_test //:prettier_check_test //:svelte_check_test //:unit_tests":
    cd {{ root }} && GF_BAZEL_SUBSTRATE_MODE=shared-cache-backed GF_BAZEL_REMOTE_UPLOAD=false BAZEL_REMOTE_EXECUTOR= bash scripts/gloriousflywheel-bazel.sh test --config=ci-cached {{ targets }}

bundle target="//:deployment_bundle":
    cd {{ root }} && bash scripts/gloriousflywheel-bazel.sh build {{ target }}

container-image-context:
    cd {{ root }} && bazelisk build //:container_image_context

# Linux-only, daemonless candidate publication. Builds through the canonical
# Bazel entrypoint, then packages the materialized static artifact with Nix.
container-image-publish: build container-image-context
    #!/usr/bin/env bash
    set -euo pipefail
    cd {{ root }}
    [[ "$(uname -s)" == "Linux" ]] || { echo "container-image-publish requires the Linux tinyland-nix carrier" >&2; exit 2; }
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
