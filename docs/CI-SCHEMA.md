# GFTB microsite CI and artifact contract

This is the live CI contract for `Great-Falls-Tool-Bus/gftb-site`.

## Validation

`.github/workflows/ci.yml` is a thin v4 caller. It dispatches exactly the two
actions in `.github/lanes.json` through ci-templates commit
`32e39ced0008edf4564ebeb173a5e8fbf069e28f` (signed immutable release
`v5.1.0`). It contains no runner, provider, endpoint, cache mode, tenant,
credential, local-execution, or fallback choice. The generic
`gf-v4-dispatch` edge is provisioned by the adopting organization, not selected
by this repository.

Local developer operations enter through Just. `just check` selects the exact
cacheable `//:ci_validation_suite` used by v4: schema/conformance and immutable
caller contracts, current-source Gitleaks, generated source/log/goal manifest
drift checks, checksummed actionlint, Prettier, ESLint, Svelte checks, and unit
tests. `just build` materializes `//:scanned_build`, the one adapter-static
artifact copied and leak-scanned in a single Bazel action. Those local recipes
are not CI or v4 evidence.
`.github/lanes.json` is the ActionPlan/v4 schema-3 source plan. It names only
real finite Bazel targets, one abstract execution capability, and one closed
result disposition per action. It contains no provider or lifecycle
configuration.

`tinyland.repo.json` is the schema-v2 consumer declaration. It identifies the
consumer-owned `Great-Falls-Tool-Bus/great-falls-tool-bus-infra` overlay and
the microsite's finite contact POST, but no provider supply, runner, endpoint,
placement, binding status, or execution fallback. Its schema bytes are pinned
to signed `tinyland-inc/site.scaffold` PR #163 head
`0abc7f9e93bf4b84c7550684c38fbf822eab7cd0` (SHA-256
`9f60d0934e23f1f2437faade24630249b77c303b00d92cf372d1a4fc5252d83c`).

## Flywheel

The v4 plan requests `rbe-linux-x86_64` for `//:ci_validation_suite` and
`//:deployment_bundle`; it does not select a runner or provider. `validate` is
status-only. `site-build` declares that the regular files in the deployment
bundle's `default` output group are exported as one bounded
`ActionOutputSet/v1`; neither the workflow nor this repository rediscovers
outputs. `//:deployment_bundle` depends only on `//:scanned_build`, so a leak
scan failure produces no exportable bundle for GF-I09. The adopting
organization's `-infra` overlay owns its consumer demand declaration. GF core
owns types, verification, resolution, and scheduling, but no GFTB instance.
Provider supply and placement remain opaque to this repository. Until the v4
caller executes these actions through REAPI, this carrier proves source shape
only. Container publication is not an action in the plan.

## Candidate image

`.github/workflows/container-ghcr.yml` packages the exact Bazel-built static
artifact into:

`ghcr.io/great-falls-tool-bus/gftb-site:sha-<40-character commit SHA>`

The source repository is public under the 2026-09-09 operator ruling in
[AGENTS.md](../AGENTS.md#role-and-authority), which supersedes the earlier
private-source requirement. Source visibility does not establish image-package
visibility. After a reviewed publish, the operator lane may make only this web
image package public, then must prove an anonymous manifest lookup and digest
pull. The publisher uses only the ambient GitHub token, has no mutable
`latest`/production tag, and sends no deployment dispatch. This repo must not
carry a registry credential or Kubernetes image-pull secret.
Consumers select an immutable digest only after independent pull/serve QA.
The image generates `/health.sha` during packaging from the exact
`BUILD_COMMIT_SHA`; served readback must equal the expected 40-character SHA.
It also preserves the existing production probe at `/health` (`200`, body
`ok`); `/healthz` remains an equivalent compatibility probe.

## Explicit non-authorities

This repo has no Pages deploy, DNS mutation, Cloudflare mutation, GitOps apply,
member/auth/payment backend, or mail administration lane. Package publication
is not apex cutover or served proof.
