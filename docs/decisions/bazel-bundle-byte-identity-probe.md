# DESIGN: Bazel-bundle byte-identity probe (TIN-2671 phase 1)

> **SUPERSEDED (2026-07-14, TIN-2838).** The probe has been RETIRED. It compared
> the Bazel `//:deployment_bundle` against the pnpm/Vite `build/` directory to
> learn whether the two ingestion paths agreed before flipping CD to the Bazel
> bytes (TIN-2671 phase 3). TIN-2838 made the four in-house `@tummycrypt/*`
> packages Bazel-only (graph-linked; no npm specifier), so the pnpm path can no
> longer build them from npm. Both the sandboxed `//:build` and the CD-facing
> `just build` now use the SAME Bazel action: `just build` invokes `bazel build
> //:build` and transactionally materializes its declared output. The
> divergence this probe guarded — npm-ingested vs Bazel-ingested bytes — can no
> longer occur, because there is no npm-ingested build anymore.
> `scripts/bazel-bundle-identity-probe.sh`, the `just bundle-identity-probe`
> recipe, and the `bundle-identity-probe` CI job were all removed.
> `//:deployment_bundle` and `just bundle` remain as the deterministic
> deployment-tarball packaging class. This document is retained as a record of
> the phase-1 rationale.

- **Status:** SUPERSEDED by TIN-2838 (see banner above). Was: shipped,
  non-blocking, additive.
- **Date:** 2026-07-08 (superseded 2026-07-14)
- **Linear:** TIN-2671 (phase 1 of 3; superseded by TIN-2838)
- **Related:** [`docs/research/bazel-ssot-packaging-dogfooding-2026-07.md`](../research/bazel-ssot-packaging-dogfooding-2026-07.md)
  section "P3 - Close the loop: CD ships the Bazel bytes", and
  [`docs/CI-SCHEMA.md`](../CI-SCHEMA.md) section 4 (Flywheel binding contract,
  `deployment-bundle-packaging` proved class).

## Historical problem

`//:deployment_bundle` (added by PR #65, `BUILD.bazel`) packages the static
SvelteKit build (`//:build`) into a deterministic `pkg_tar` via the
GloriousFlywheel wrapper. It is a proved, cache- and executor-eligible target
class. At the time of this phase-1 design, CD used a separate in-repo Vite
action and uploaded that `build/` directory to GitHub Pages. The Bazel bundle
and deployed artifact had not been compared, so Bazel covered a build action
that was not yet the shipping action. The post-TIN-2838 entrypoint patch closes
that historical gap by making `//:build` canonical.

TIN-2671's end state (phase 3) is CD provably shipping the Bazel bytes, with a
byte-identity gate that **fails** CD on drift. Flipping CD's actual deploy
path is the risky move: it changes production behavior on every push to
`main`. This PR is deliberately **not** that. It is phase 1: build the proof
surface first, and learn whether the two pipelines already agree, before
anything is allowed to gate on it.

## What this PR adds

1. **`scripts/bazel-bundle-identity-probe.sh`** - builds
   `//:deployment_bundle` via `scripts/gloriousflywheel-bazel.sh` (the same
   wrapper every other `flywheel-*` recipe uses), extracts the resulting
   tarball, and compares its content-hash manifest against the existing
   `build/` directory (the same directory CD's `upload-pages-artifact` step
   reads). A mismatch prints a `WARNING` and a short diff; a match prints
   `OK`. Every exit path is `0`.
2. **`just bundle-identity-probe`** - the documented recipe wrapping the
   script, so an operator or agent can run the comparison locally on an
   enrolled shell (`just flywheel-enroll` first).
3. **`bundle-identity-probe` job in `.github/workflows/ci.yml`** - runs the
   probe on every push/PR to `main`, `continue-on-error: true`, `runs-on:
   ubuntu-latest`. It is **not** part of the source gates described in
   `docs/CI-SCHEMA.md` section 6, so it can never block a merge.

## Why it is safe

- **Never fails.** `scripts/bazel-bundle-identity-probe.sh` has no exit path
  that returns non-zero: no cache, a Bazel build error, a missing artifact, a
  missing `build/` directory, and a real byte mismatch are all handled as a
  `NOTICE`/`WARNING` followed by `exit 0`. `continue-on-error: true` on the CI
  job is a second, redundant guard in case that contract is ever violated by a
  future edit.
- **Public-repo-safe.** The job runs on `ubuntu-latest`, the same hosted
  runner class `deploy-pages.yml` and `substrate-boundary` already use. It
  needs no self-hosted runner, no new secret, and no cluster reachability.
  Fork PRs get the same graceful skip as any other environment without
  `BAZEL_REMOTE_CACHE`.
- **Graceful with no remote cache.** `BAZEL_REMOTE_CACHE` is unset on
  `ubuntu-latest` today (it is exported by the cluster's `nix-setup` action
  inside the vendored `ci-templates` reusable workflow, which this job does
  not use). The probe checks for it up front and skips with a notice rather
  than invoking the wrapper (which itself fails closed without an endpoint).
  Wiring a cache-reachable runner class for this specific job is an explicit
  follow-up, not something this PR invents.
- **Does not touch CD.** `.github/workflows/deploy-pages.yml` is unmodified.
  Nothing here changes what gets built, packaged, or published for a real
  deploy.
- **Never writes to the shared cache.** The probe exports
  `GF_BAZEL_REMOTE_UPLOAD=false` explicitly before invoking the wrapper.

## Historical expected divergence

At the time, `vite.config.ts` embedded `GITHUB_SHA` / `BUILD_COMMIT_SHA` /
`CF_PAGES_COMMIT_SHA` into the build for the view/edit-source affordance, and
`svelte.config.js` reads `BASE_PATH` for GitHub Pages project-path hosting.
Both are ambient-environment inputs. The Bazel action (`js_run_binary` in
`BUILD.bazel`) is hermetic and does not currently forward either. To avoid
that noise dominating the signal, this probe's CI job deliberately does
**not** set `BASE_PATH` for its own `just build` step, so both sides of the
comparison build under the same (empty) base path. This isolates the
question phase 1 needed answered: did the Bazel-wrapped Vite pipeline produce
the same bytes as the separate in-repo Vite pipeline,
independent of env-parameterization? A diff limited to a commit-sha string is
expected and is not evidence the two pipelines disagree; a diff in asset
content, file set, or hashing of anything else is the real signal to
investigate.

## Phasing

| Phase | Ticket | Scope |
|---|---|---|
| 1 (this PR) | TIN-2671 | Non-blocking probe: build both, compare, report. No CD change. |
| 2 | TIN-2671 | Forward the env inputs (`BASE_PATH`, commit sha) into the Bazel action so the comparison is apples-to-apples against the real CD build, not just the default-env build. |
| 3 | TIN-2671 | Flip `deploy-pages.yml` to build/extract `//:deployment_bundle` and publish that tree; turn the probe into a required, failing gate on drift. |

Phase 2 and phase 3 are out of scope here and are not scaffolded by this PR
beyond the ticket reference above.
