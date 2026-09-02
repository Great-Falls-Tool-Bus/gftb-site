# GFTB microsite CI and artifact contract

This is the live CI contract for `Great-Falls-Tool-Bus/gftb-site`.

## Validation

`.github/workflows/ci.yml` is a thin v4 caller. It dispatches exactly the two
actions in `.github/lanes.json` through the exact released ci-templates source at
`0067a1f0e16012ea91d0602b7d185e534774cadb` (signed immutable release
`v5.0.0`). It contains no runner, provider, endpoint, cache mode, tenant,
credential, local-execution, or fallback choice.

Local developer operations enter through Just. `just check` covers repository
conformance, secret and endpoint scans, build-entrypoint contracts, Prettier,
ESLint, Svelte checks, and unit tests. `just build` produces one adapter-static
artifact through Bazel. Those local recipes are not CI or v4 evidence.
`.github/lanes.json` is the ActionPlan/v4 schema-3 source plan. It names only
real finite Bazel targets, one abstract execution capability, and one closed
result disposition per action. It contains no provider or lifecycle
configuration.

## Flywheel

The v4 plan requests `rbe-linux-x86_64` for `//:ci_validation_suite` and
`//:deployment_bundle`; it does not select a runner or provider. `validate` is
status-only. `site-build` declares that the regular files in the deployment
bundle's `default` output group are exported as one bounded
`ActionOutputSet/v1`; neither the workflow nor this repository rediscovers
outputs. The adopting organization's `-infra` overlay owns its consumer demand
declaration. GF core owns types, verification, resolution, and scheduling, but
no GFTB instance. Provider supply and placement remain opaque to this
repository. Until the v4 caller executes these actions through REAPI, this
carrier proves source shape only. Container publication is not an action in
the plan.

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
