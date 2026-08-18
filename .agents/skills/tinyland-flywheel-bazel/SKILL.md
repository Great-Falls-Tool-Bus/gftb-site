---
name: tinyland-flywheel-bazel
description: Maintain the GFTB cache-first Bazel and GloriousFlywheel graph. Use for BUILD.bazel, MODULE.bazel, Bazel rc files, Flywheel wrappers, CI runner inputs, target tags, deployment bundles, or the static OCI context.
---

# GFTB Flywheel Bazel

Read `AGENTS.md`, `docs/CI-SCHEMA.md`, `Justfile`, both Bazel rc files, and the
Flywheel wrapper before editing. Use `just <recipe>` for every operation.

Cache and executor endpoints, auth headers, and upload authority are runtime
inputs only. Flywheel commands fail closed without a valid profile and remote
cache. Cache hits are not remote-execution proof. PR cache uploads stay off.

Only proved, hermetic classes receive `flywheel-eligible`: the SvelteKit build,
unit tests, and deterministic deployment bundle. Browser smoke remains
candidate-only. Dev servers and image assembly/push are never executor
eligible. The `container_image_context` target must use
`gloriousflywheel-cache-only` plus `no-remote-exec` and omit
`flywheel-eligible`.

The only GFTB ARC runner label is `tinyland-nix`; default, heavy, and KVM CI
inputs all map to it. Do not create a new runner class.

After graph edits run `just inhouse-package-parity`, `just bazel-graph`,
`just conformance`, and `just check`. Run wrapper-mediated remote proofs only
when their runtime profile is available; do not claim raw local Bazel as RBE.
