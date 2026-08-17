# Great Falls Tool Bus public static site
set dotenv-load := true
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

build:
    cd {{ root }} && bazelisk build //:build
    cd {{ root }} && python3 scripts/bazel_output.py materialize --source bazel-bin/build --destination build

build-ci:
    cd {{ root }} && bazelisk build --config=ci-cached --remote_cache="${BAZEL_REMOTE_CACHE:-}" --remote_download_outputs=toplevel //:build
    cd {{ root }} && python3 scripts/bazel_output.py materialize --source bazel-bin/build --destination build

preview port="4173": build
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

test-e2e: playwright-ensure
    cd {{ root }} && if [ "${CI:-}" = "true" ] && command -v nix >/dev/null 2>&1; then \
      nix develop .#playwright --command pnpm exec playwright test; \
    else \
      pnpm exec playwright test; \
    fi

playwright-ensure:
    cd {{ root }} && if [ "${CI:-}" = "true" ] && command -v nix >/dev/null 2>&1; then \
      echo "Using Nix Chromium"; \
    else \
      pnpm exec playwright install chromium; \
    fi

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

source-map-check:
    @cd {{ root }} && test ! -e src/lib/generated/source-map.json && test ! -d src/routes/agent && test ! -e static/llms.txt && test ! -e static/agent-map.md
    @echo "source-map-check: no public developer/source-map artifacts"

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

check: flywheel-enrollment-contract-check secrets-scan-dir endpoint-check source-map-check entrypoint-contract workflow-validate conformance
    cd {{ root }} && bazelisk test //:local_validation_suite
    @echo "All checks passed."

check-ci: flywheel-enrollment-contract-check secrets-scan-dir endpoint-check source-map-check entrypoint-contract workflow-validate conformance
    cd {{ root }} && bazelisk test --config=ci //:local_validation_suite
    @echo "All CI artifact checks passed."

ci: check build test-e2e

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

flywheel-check *targets="//:eslint_test //:prettier_check_test //:svelte_check_test":
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
