# Changelog

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning: [SemVer 2.0](https://semver.org/).

## [Unreleased]
- docs(research): maximize-Bazel-SSOT packaging + dogfooding roadmap (docs/research/bazel-ssot-packaging-dogfooding-2026-07.md)
- feat(conformance): report-only Bazel-SSOT anti-pattern checks (TIN-2672 phase 1)

### Added

- Add a REPORT-ONLY Bazel-SSOT anti-pattern scan
  (`scripts/check-bazel-ssot-report-only.py`), wired into
  `scripts/check-conformance.sh` and surfaced through `just scaffold-doctor`.
  It WARNs (never fails, always exits 0) on the two anti-patterns named by
  `docs/research/bazel-ssot-packaging-dogfooding-2026-07.md` P4: an in-house
  `@tummycrypt/@tinyland` `package.json` dependency declared as `workspace:*`
  or a vendored tarball/producer-tree path, and a `pkg_tar`/container
  packaging target whose tags mix or omit pieces of the two disjoint
  packaging classes. This is phase 1 (detect-only); a follow-up flips it to
  hard-fail once the fleet has had a chance to react to the drift it
  surfaces.
- Ship the optional adapter-node `container_image_context` Bazel target
  (backport from the greatfallstoolbus.org reference), promoting it from a
  reserved `BUILD.bazel` comment into a brand-neutral cache-only `pkg_tar`. It
  keeps the disjoint cache-only tag shape (`container-image-and-push` +
  `gloriousflywheel-cache-only` + `no-remote-exec`, never `flywheel-eligible`)
  and stays additive and inert under the adapter-static default via a
  `glob(allow_empty = True)` input set, only packaging a real image context once
  a spoke flips to adapter-node.
### Changed

- Give the Playwright CI web server a ten-minute startup budget for a cold
  canonical Bazel build while retaining the three-minute local budget. The
  adapter-aware `just preview` path remains the only E2E server entrypoint.
- Keep the GitHub Pages artifact lane inside the sanctioned `tinyland-nix` ARC
  pool, retain a self-contained `just check-ci` publication gate, scope
  Pages/OIDC authority to the deploy job, pin the shared Nix setup action to
  `v2.9.0`, and use `just build-ci` to avoid duplicating the Bazel output tree
  into a local disk cache on CI.
- Ingest the four in-house `@tummycrypt/*` packages Bazel-only (TIN-2838):
  graph-link `vite-plugin-a11y`, `vite-plugin-skeleton-colors`,
  `tinyland-color-utils`, and `tinyvectors` from their bazel-registry `:pkg`
  targets (`TINYLAND_HOUSE_PACKAGES` in `BUILD.bazel`) instead of resolving them
  as npm specifiers. Drops the four `package.json` dependencies and regenerates
  `pnpm-lock.yaml` to zero `@tummycrypt` references. Canonical Just/package
  entrypoints now execute finite Bazel targets; `just build` builds `//:build`
  and transactionally materializes its declared output, so plugins and runtime
  imports resolve directly from Bazel without first-party `node_modules`
  hydration.
  Pins `tummycrypt_tinyvectors` to `0.3.4` (the mothership's proven,
  already-published version; the `0.3.0` `:pkg` cannot build under the Bazel
  sandbox) — a version selection, not an in-place edit of a shipped module.
  Adds `magic-string ^0.30.0`, the a11y plugin's sole third-party runtime dep
  now that the graph-linked `:pkg` ships only `dist/`. Rewrites conformance
  item 13 (`scripts/check-inhouse-package-parity.py`) from exact-version parity
  to the Bazel-only invariant, and updates the truth surfaces (`MODULE.bazel`,
  `AGENTS.md`, `CLAUDE.md`, `docs/CI-SCHEMA.md`,
  `docs/research/bazel-ssot-packaging-dogfooding-2026-07.md`).
- Add adapter-aware transactional materialization (`index.html` for static,
  `index.js` for adapter-node), adapter-aware preview execution, stamped Bazel
  build metadata, and static/node cutover contracts. Both sanctioned adapters
  live in the frozen third-party graph; partial rebrands and interrupted output
  swaps are recoverable, Playwright uses the selected runtime, and static
  preview strips the configured `BASE_PATH`. The repo remains
  shared-cache-backed; routine executor-backed RBE stays blocked under TIN-2851.

### Removed

- Retire the non-blocking Bazel-bundle byte-identity probe (TIN-2671 phase 1):
  `scripts/bazel-bundle-identity-probe.sh`, the `just bundle-identity-probe`
  recipe, and the `bundle-identity-probe` CI job. After the TIN-2838 cutover
  both `//:build` and `just build` consume the same Bazel-graph-linked packages,
  so the npm-vs-Bazel divergence the probe guarded can no longer occur;
  `docs/decisions/bazel-bundle-byte-identity-probe.md` is marked superseded.
  `//:deployment_bundle` / `just bundle` remain as the deterministic
  deployment-tarball packaging class.

## [0.3.0] - 2026-07-08

### Added

- Add the view/edit-source subsystem, including a committed source map and drift
  gate so scaffolded sites can expose file provenance without hand-maintained
  route metadata.
- Add responsive image helpers, a `Picture` component, intrinsic-size manifest
  handling, and image optimization ergonomics for future static spokes.
- Add a Bazel `deployment_bundle` package class with cache-only tag discipline
  for static deployment bundle proofing.
- Document reusable Great Falls Tool Bus patterns for the design canon,
  on-cluster adapter-node hosting, multi-agent orchestration, community mailing
  lists and archives, and community-contact intake.

### Changed

- Update the scaffold's own provenance to `v0.2.0` and advance the shared
  spoke CI template pin to `v2.9.0`.
- Expand reusable UX guidance with the harvested glass, motion, image, source,
  and navigation patterns.

### Fixed

- Portal the mobile drawer out of the glass AppBar stacking context, add a
  semantic z-index scale, fix the template drawer and theme switcher layering,
  and add an iPhone SE regression spec.
- Gate PR CI on substrate-boundary validation and add the scaffold-side
  substrate-boundary conformance checks.
- Exclude ignored local agent/browser artifacts from formatter and working-tree
  secrets scans so validation covers the scaffold instead of nested workspace
  clones.

## [0.2.0] - 2026-07-02

### Changed

- Tag the post-uplift scaffold contract covering exact-pin guards, performance
  recipes, rune idioms, remote verbs, dynamic-spoke adapter mode, GitHub Pages
  deploy posture, remote build hermeticity, and cache enrollment updates.

### Fixed

- Forward GloriousFlywheel `BAZEL_REMOTE_INSTANCE_NAME` through the Bazel
  wrapper so tenant-scoped REAPI tokens do not fall back to Bazel's `default`
  instance.

## [0.1.0] - 2026-06-23

### Added

- First versioned `site.scaffold` release surface, including a release workflow
  that cuts immutable `vMAJOR.MINOR.PATCH` tags, moves the floating `vMAJOR`
  tag with an explicit remote lease, and creates GitHub Releases from this
  changelog.
- Release operator runbook documenting the required `release: vX.Y.Z` commit
  shape and tag immutability rules.

### Changed

- Promote the scaffold package version to `0.1.0` so SBOM/source-version output
  matches the first taggable scaffold release.
- Correct spoke state guidance to stay provider-neutral: state keys target the
  operator-provisioned S3-compatible backend, while spokes must not hard-code a
  backend provider. Tinyland's current internal RustFS deployment remains
  separate from trusted RBE CAS/action-cache/publication authority.
