# GFTB microsite CI and artifact contract

This is the live CI contract for `Great-Falls-Tool-Bus/gftb-site`.

## Validation

`.github/workflows/ci.yml` calls the pinned v3 Tinyland spoke workflow. On pull
requests, the repo-local `qa-look` job then checks out the exact head SHA, runs
`just qa-packet`, and uploads its screenshots and receipts for the required
human LOOK. The stable `merge-gate` status requires both the complete reusable
workflow and `qa-look` to succeed.

Local and CI operations enter through Just. `just check` covers repository
conformance, secret and endpoint scans, build-entrypoint contracts, Prettier,
ESLint, Svelte checks, and unit tests. `just build` produces one adapter-static
artifact through Bazel. `.github/lanes.json` is the v4 source action plan: it
names only real finite Bazel targets and one abstract execution capability per
action. It contains no provider or lifecycle configuration and remains inactive
until an
immutable v4 ci-templates caller is released and pinned.

## Flywheel

The current v3 spoke is shared-cache-backed compatibility transport.
`.bazelrc.flywheel` is endpoint-free; runtime attachment remains outside this
repository. The v4 plan requests `rbe-linux-x86_64` for `//:build` and
`//:ci_validation_suite`; it does not select a runner or provider. Until the v4
caller executes those actions through REAPI, a cache hit is not
remote-execution proof. Container publication is not an action in the plan.

## Candidate image

`.github/workflows/container-ghcr.yml` packages the exact Bazel-built static
artifact into:

`ghcr.io/great-falls-tool-bus/gftb-site:sha-<40-character commit SHA>`

The source repository remains private. Publication starts with the package's
default private visibility. After a reviewed publish, the operator lane may
make only this web image package public, then must prove an anonymous manifest
lookup and digest pull. The publisher uses only the ambient GitHub token, has
no mutable `latest`/production tag, and sends no deployment dispatch. This repo
must not carry a registry credential or Kubernetes image-pull secret.
Consumers select an immutable digest only after independent pull/serve QA.
The image generates `/health.sha` during packaging from the exact
`BUILD_COMMIT_SHA`; served readback must equal the expected 40-character SHA.
It also preserves the existing production probe at `/health` (`200`, body
`ok`); `/healthz` remains an equivalent compatibility probe.

## Explicit non-authorities

This repo has no Pages deploy, DNS mutation, Cloudflare mutation, GitOps apply,
member/auth/payment backend, or mail administration lane. Package publication
is not apex cutover or served proof.
