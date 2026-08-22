#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT"

pass=0
fail=0
ok() { printf '  ✓ %s\n' "$1"; pass=$((pass + 1)); }
no() { printf '  ✗ %s\n' "$1"; fail=$((fail + 1)); }
check() { if eval "$1"; then ok "$2"; else no "$2"; fi; }

echo "GFTB minimal-spoke conformance"

check "python3 scripts/validate-lanes.py >/dev/null" "lanes manifest validates"
check "python3 scripts/validate-lanes.py --schema docs/schemas/tinyland-repo-manifest.schema.json --instance tinyland.repo.json >/dev/null" "repo manifest validates"
check "python3 scripts/check-inhouse-package-parity.py >/dev/null" "first-party package is Bazel-only"
check "python3 scripts/validate-skills.py >/dev/null" "repo skills validate"

check "grep -q 'adapter-static' svelte.config.js && ! grep -q 'adapter-node' package.json svelte.config.js" "adapter-static is the only adapter"
check "jq -e '.devDependencies[\"@skeletonlabs/skeleton\"] == \"5.0.0\" and .devDependencies[\"@skeletonlabs/skeleton-svelte\"] == \"5.0.0\"' package.json >/dev/null" "Skeleton 5 pair is exact-pinned"
check "grep -q 'spoke-ci.yml@v2.13.0' .github/workflows/ci.yml" "CI template is pinned"
for input in default_runner_class heavy_runner_class kvm_runner_class; do
  check "grep -q \"${input}: tinyland-nix\" .github/workflows/ci.yml" "${input} maps to tinyland-nix"
done

image='ghcr.io/great-falls-tool-bus/gftb-site'
check "jq -e --arg image '$image' '.spoke.image_repository == \$image' .github/lanes.json >/dev/null" "lane metadata names the exact private package"
check "grep -q '$image' Justfile && grep -q '$image' flake.nix" "publisher and image recipe fix the package identity"
check "grep -q 'packages: write' .github/workflows/container-ghcr.yml" "candidate publisher has scoped package write authority"
check "! grep -q 'codex/\\*\\*' .github/workflows/container-ghcr.yml && grep -q 'expected_sha' .github/workflows/container-ghcr.yml" "package writes are main-only or exact-SHA attended dispatch"
check "grep -q 'sha-\${BUILD_COMMIT_SHA}' Justfile && grep -q 'sha-\${commitSha}' flake.nix" "candidate tag binds the full commit SHA"
check "grep -q 'health.sha' flake.nix && grep -q 'file_server' flake.nix && test ! -e static/health.sha" "image generates an exact served-source marker"
check "! grep -RqiE '(repository_dispatch|latest|production[-_ ]dispatch)' .github/workflows/container-ghcr.yml Justfile flake.nix" "publisher has no deploy dispatch or mutable production tag"
check "test ! -e .github/workflows/deploy-pages.yml && ! grep -RqlE --exclude=check-conformance.sh '(actions/deploy-pages|CF_PAGES_COMMIT_SHA)' .github/workflows Justfile scripts flake.nix" "GitHub Pages is absent"

check "grep -q 'name = \"deployment_bundle\"' BUILD.bazel && grep -q 'name = \"container_image_context\"' BUILD.bazel" "Bazel exposes bundle and image-context targets"
check "grep -q 'container-image-publish: build container-image-context' Justfile" "publisher enters through Just and the Bazel context"
check "test -f .gitleaks.toml && grep -q 'gitleaks dir' Justfile && grep -q 'gitleaks git' Justfile && grep -q 'gitleaks' flake.nix" "secret scanning is reproducible"
check "test -f .bazelrc.flywheel && ! grep -qE '(remote_cache|remote_executor)=((grpc|https?)://)' .bazelrc .bazelrc.flywheel" "Bazel configuration contains no endpoint"

# TIN-3914: this org's CI runs only on the GF cache-fronted ARC fleet. No job
# this repository owns may name a GitHub-hosted label at any runs-on nesting.
check "! grep -RqiE '(^|[^a-z0-9_-])(ubuntu|macos|windows)-[a-z0-9.]+' .github/workflows" "no GitHub-hosted runner label in .github/workflows"

for dead in \
  .claude-plugin plugins modules tofu \
  docs/release docs/research docs/spec docs/deploy docs/patterns docs/decisions \
  src/lib/projection static/llms.txt static/agent-map.md \
  .github/rulesets scripts/bazel/run-playwright-static-smoke.mjs \
  .github/workflows/pulse-ingest.yml .github/workflows/release.yml; do
  check "test ! -e '$dead'" "dead carrier absent: $dead"
done

# src/lib/generated left the dead-carrier list with addendum B1.2: it is the
# live home of the route->source map behind the SourceLink edit-this-page
# affordance (demo #94), regenerated and drift-gated by `just source-map-check`.
check "test -s src/lib/generated/source-map.json" "source map present for the SourceLink affordance (B1.2)"

public_hits=$(grep -RInE '(TIN-[0-9]+|Linear|github\.com/.+/(pull|commit)/|\bPR #[0-9]+)' src/content src/routes 2>/dev/null || true)
if [[ -z "$public_hits" ]]; then ok "public content contains no internal work pointers"; else no "public content contains internal work pointers"; printf '%s\n' "$public_hits"; fi

check "test -f static/vendor/altcha/altcha.js && test -f static/vendor/altcha/LICENSE" "contact proof-of-work asset retains its license"
check "! find static -type f -name '*.md' -print -quit | grep -q ." "public static tree contains no developer Markdown"
# The contact surface lives on its own page (B1.4: the demo /contact
# architecture, restored); the root's row 8 still names the public discuss
# list while the private keyholders boundary is explained beside the form.
check "grep -q 'forms.latoolb.us' src/lib/components/ContactForm.svelte && grep -q 'discuss@latoolb.us' src/routes/+page.svelte && grep -q 'keyholders@latoolb.us' src/routes/contact/+page.svelte" "contact and list boundaries are explicit"

echo "summary: ${pass} pass, ${fail} fail"
(( fail == 0 ))
