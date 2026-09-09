# GFTB microsite CI and artifact contract

This is the source CI contract for `Great-Falls-Tool-Bus/gftb-site`; successful
v4 execution and serving require their separate runtime evidence below.

## Source and release admission

The operator's 2026-09-08 ruling keeps GFTB on GitHub Free. The September 9
public-source ruling supersedes its private-source restriction: files and
draft PRs are readable before website publication. GitHub branch-protection
status, rulesets, and a paid-plan upgrade are not integration or publication
gates. Meta ADR 0014 section 7 and
ADR 0022 Amendment 7 carry the ruling in
[Meta #63](https://github.com/Great-Falls-Tool-Bus/meta/pull/63).

Integration still requires signed commits, independent review of the exact
head, and successful registered remote checks. GF/org admission and release
verification must bind the exact repository, source SHA, workflow identity,
qualified action output, and signed release. A missing or false GitHub branch
protection result does not replace those checks or establish their success.
References to protected canonical `main` mean the exact canonical source
admitted through GF/org checks; they do not add a GitHub branch-protection
prerequisite.

This source clarification establishes no installed verifier, published image,
controller activation, production convergence, or served proof. The existing
workflow identity, owner authority and independent verification boundaries
remain required, including the separate Access and LOOK gates. No new policy
boolean, caller assertion, or consumer execution path supplies that authority.

## Validation

`.github/workflows/ci.yml` is a thin v4 caller. It dispatches exactly the two
actions in `.github/lanes.json` through ci-templates commit
`32e39ced0008edf4564ebeb173a5e8fbf069e28f` (signed immutable release
`v5.1.0`). It contains no runner, provider, endpoint, cache mode, tenant,
credential, local-execution, or fallback choice. The generic
`gf-v4-dispatch` edge is provisioned by the adopting organization, not selected
by this repository.

Developer operations enter through Just and the same image-custodied client
as CI. `just check` selects `validate`; its cacheable
`//:ci_validation_suite` includes schema/conformance and immutable caller
contracts, current-source Gitleaks, generated source/log/goal manifest drift
checks, checksummed actionlint, Prettier, ESLint, Svelte checks, unit tests,
the served TinyVectors package proof, and five Chromium acceptance specs.
The finite browser test uses only the declared build and GF's provisioned
Chromium. It installs no browser, uses no ambient preview, and proves no
deployed environment or LOOK.
`just build` selects `site-build` and exports qualified results into a new
absolute directory; it does not run or materialize a local Bazel build.
The checkout SHA is supplied to the client, which owns source and identity
verification. Neither missing authority nor a missing client permits fallback.
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
outputs. `//:deployment_bundle` takes its public `/srv` subtree only from
`//:scanned_build`, so a leak-scan failure produces no exportable public site
for GF-I09. The bundle adds only the reviewed first-party `Caddyfile`, exact
source marker, and `/tmp` mode required by the runtime contract. The adopting
organization's `-infra` overlay owns its consumer demand declaration. GF core
owns types, verification, resolution, and scheduling, but no GFTB instance.
Provider supply and placement remain opaque to this repository. Until the v4
caller executes these actions through REAPI, this carrier proves source shape
only. Container publication is not an action in the plan.

## Qualified publication

Application-image publication belongs to GF-I09 after the action's qualified
export. This repository no longer has a separate candidate workflow or a
local Nix application-image constructor. Its Nix runtime-base definition is
source-independent; its Bazel deployment layer carries the exact application
content. Neither the ActionPlan nor the developer build recipe publishes or
deploys an image.

The source repository is public under the September 9 operator ruling.
That does not establish image-package visibility or pullability. The operator
release lane must prove anonymous manifest lookup and digest pull for the
reviewed public image before cutover. The repository carries no registry pull
secret, cluster credential, production dispatch, or mutable production image tag.
The consumer deployment lifecycle selects qualified immutable results; these
source definitions alone do not prove it is installed or serving.

The existing source-marker action projects Bazel's native `BUILD_EMBED_LABEL`
into the exact deterministic `health.sha` file. The GF client binds that label
to the accepted source SHA. Vite build/analyze consume only the projected file,
with stamping disabled: fresh host/time status cannot invalidate the larger
actions. The adapter validates the marker and exposes only its seven-character
prefix to page bundles. Missing or malformed identity fails the build.

The deployment bundle also installs that file at `/srv/health.sha`, outside
the leak-scanned page tree. Caddy serves its full 40-character SHA publicly at
`/health.sha`; it is not private. Served readback must equal the expected SHA.
It also preserves the existing production probe at `/health` (`200`, body
`ok`); `/healthz` remains an equivalent compatibility probe.

## Explicit non-authorities

This repo has no Pages deploy, DNS mutation, Cloudflare mutation, GitOps apply,
member/auth/payment backend, or mail administration lane. Package publication
is not apex cutover or served proof.
