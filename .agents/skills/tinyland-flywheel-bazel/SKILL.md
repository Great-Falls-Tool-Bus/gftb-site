---
name: tinyland-flywheel-bazel
description: Maintain the GFTB v4 Bazel action plan and its remotely executable targets. Use when editing BUILD.bazel, MODULE.bazel, .github/lanes.json, or the thin ci-templates v4 caller; not for provider placement, endpoints, runners, tenant registration, or local cache wrappers.
---

# GFTB v4 Bazel actions

Read `AGENTS.md`, `docs/CI-SCHEMA.md`, `.github/lanes.json`, and the Bazel
targets named by the plan before editing.

## Boundary

- The app repository owns finite Bazel actions and their abstract Core.dhall
  capability requirements.
- The GFTB `-infra` overlay owns GFTB's consumer demand declaration.
- GF core owns types, verification, resolution, and scheduling, but no GFTB
  instance.
- Provider supply and placement are opaque to both consumer repositories.

Never add runner labels, pools, nodes, endpoints, credentials, instance names,
or lifecycle/publication policy to `.github/lanes.json`. Never edit a
producer-owned consumer registry to enroll GFTB.

## CI shape

`.github/workflows/ci.yml` contains one thin reusable-workflow call per action
name. The released reusable workflow invokes `gf-action-client run`; this Draft
is not evidence that the client is installed, an owner overlay is admitted, or
an action executed remotely. Those missing authorities fail closed. Do not add
a v3, hosted, local, cache-only, DinD, wrapper, or shell-based execution
alternative.

Local `just` recipes are developer tools only. Their success is not v4, cache,
or remote-execution evidence.

## Graph changes

Keep action targets finite, workspace-local, and remotely executable. Image
publication, browser sessions, developer servers, cluster apply, and other
side effects do not belong in the action plan. Validate through registered
Just/Bazel entrypoints; do not add a guard script to defend the plan.
