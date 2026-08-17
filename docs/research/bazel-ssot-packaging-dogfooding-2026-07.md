# Maximize-Bazel-SSOT: Packaging Dogfooding Roadmap

Status: doctrine + phased roadmap. The doctrine is authoritative now; the phases
are tracked as the Linear tickets cross-linked below.

Date: 2026-07-08

Provenance: session 1f91b703, 2026-07-08 Bazel-SSOT thrust.

Linear: TIN-2668, TIN-2669, TIN-2670, TIN-2671, TIN-2672 (net-new this thrust),
building on the mothership keystones TIN-2647 and TIN-1721 (PR #616).

## Purpose

The fleet already treats Bazel as the graph of record for build and test
proofs. The gap this document closes is packaging: taking the same discipline
one step past `bazel build`/`bazel test` so the bytes a spoke SHIPS are also
graph-addressable, cache-provable, and version-honest. "Maximize Bazel SSOT"
means every packaged artifact in the fleet is a derivation of the Bazel graph,
never an independent thing that happens to agree with it.

This is a dogfooding roadmap. site.scaffold is the template; it must lead, not
lag. Today one spoke (GFTB) is ahead of the template on packaging, and the
template itself carries a documented-but-unshipped image class. That inversion
is the first thing the roadmap corrects.

## Doctrine

Three rules govern the whole surface. They are already the operative model in
`docs/CI-SCHEMA.md` (see especially the Flywheel binding contract, section 4);
this document names them as doctrine so downstream repos can cite them.

### 1. bazel-registry is the version source of truth

`tinyland-inc/bazel-registry` owns the version of every in-house module. A
producer's npm surface (its `package.json` version and its `//:pkg`
`npm_package` output) is a DERIVATION of its Bazel module version, never an
independently maintained number. When the two can drift, they eventually do:
the mothership auth skew (vendored 0.2.2 against a library at 0.5.0, TIN-2647)
is the canonical downstream symptom of an unenforced producer version.
Consumers pin registry-promoted modules through the Bazel module graph, and
their registry-pinned npm specifiers are the exact-pin shadow of that graph
(the MassageIthaca consumer pattern, TIN-2227), not a second opinion.

**Hardened (2026-07-13, operator ruling):** the ingestion surface for org
packages is Bazel, never npm. The exact-pin npm shadow above is a
TRANSITIONAL shape, not the target: now that producers publish only to
`tinyland-inc/bazel-registry`, the shadow can become unreconcilable — the
canonical example is this very template, where `#74` bumped
`tummycrypt_vite_plugin_a11y` / `tummycrypt_vite_plugin_skeleton_colors` to
0.2.3 in `MODULE.bazel` (the CDN-flake-cured republications) while public
npm tops out at 0.2.2, so `package.json` literally cannot follow. The
target consumer shape is graph-linked consumption of registry modules (the
TIN-1721 mothership pattern) with CD shipping the Bazel bytes (TIN-2671);
until a spoke gets there, any graph↔shadow version skew is a defect —
`scripts/check-inhouse-package-parity.py` (conformance item 13) gates it,
and it is correctly RED on this template today. The public npmjs listings of
`@tummycrypt/*` (measured 2026-07-13: ≥8 packages live, all stale, ~15
repos still ingesting via npm ranges) are a liability to retire: migrate
consumers off npm ranges first, then `npm deprecate` with a pointer to the
registry — never unpublish while consumers still resolve from npmjs, and
never publish new org-package versions to npmjs as an "unblock".

### 2. GloriousFlywheel is the cache and RBE authority

GloriousFlywheel owns cache/RBE substrate truth, target-class eligibility,
runner posture, and consumer wrapper semantics. Spokes opt in through
`scripts/gloriousflywheel-bazel.sh`, never by hard-coding endpoints in
`.bazelrc`. Eligibility is not a spoke's decision: a target class reaches the
executor only after it is promoted to `proved` in
`tinyland-inc/GloriousFlywheel/config/rbe-target-eligibility.json` and mirrored
into `lanes.schema.json` under the Flywheel binding contract in CI-SCHEMA
section 4. Remote cache hits, ARC dispatch, and GitHub-hosted
execution are never counted as RBE.

### 3. Two disjoint packaging tag classes

Packaging targets fall into exactly two tag shapes, and the shapes are
mutually exclusive. The executor tag filter that `.bazelrc.flywheel` applies
(`--build_tag_filters=flywheel-eligible` and the test equivalent) is what makes
the distinction load-bearing.

- **`deployment_bundle` (executor-safe).** A hermetic `rules_pkg` package of the
  static production build. Tags: `deployment-bundle-packaging` plus
  `flywheel-eligible`. Because it is hermetic and belongs to a proved class, it
  runs under both cache-first (`config=flywheel`) and executor-backed
  (`config=flywheel-executor`) modes.
- **`container_image_context` (cache-only, never executor).** The image build
  context for an adapter-node spoke. Tags: `gloriousflywheel-cache-only` plus
  `no-remote-exec`, and it DELIBERATELY OMITS `flywheel-eligible`. Image
  assembly and push are blocked at the GloriousFlywheel manifest layer
  (`container-image-and-push`), so the target must never reach a remote
  executor even though its unchanged inputs stay cacheable. The executor
  tag filter excludes it by construction; cache-first mode still serves a
  cached result.

The invariant: an image-context target that ever carries `flywheel-eligible` is
a defect, because it would expose a manifest-blocked class to the executor.
Enforcing that shape is P4 below.

## Current scorecard

| Repo | Consumes via Bazel graph | `deployment_bundle` | `container_image_context` | Verdict |
|---|---|---|---|---|
| GFTB (great-falls-tool-bus) | yes | yes | yes | Maximized. Ahead of the template. |
| site.scaffold | yes | yes | reserved comment only | Template LAGS its own doctrine on image-context. |
| massage-ithaca-portal | yes (clean, exact-pin) | no | no | Consumes-clean but packages-nothing. |
| mothership (tinyland.dev) | mixed (`workspace:*` + vendored) | via rules_img path | via rules_img path | The anti-dogfooding case, fixed by TIN-1721 / PR #616. |

Notes on each row:

- **GFTB** proved both packaging classes in production, including the cache-only
  image context with the correct tag pair. It is the reference implementation
  and the reason the shapes in the doctrine are concrete rather than
  speculative.
- **site.scaffold** ships `//:deployment_bundle` (correctly tagged
  `deployment-bundle-packaging` + `flywheel-eligible`) but only DESCRIBES
  `container_image_context` in a reserved comment in the root `BUILD.bazel`. A
  template that documents a class it does not ship cannot be the source of truth
  for that class. P1 corrects this (TIN-2669).
- **massage-ithaca-portal** is the strongest consumer story in the fleet
  (exact-pin `@tummycrypt` deps plus `just inhouse-package-parity`, TIN-2227)
  yet packages nothing through Bazel: no `deployment_bundle`, no image context.
  Its production bytes are therefore not cache-addressable. P1 brings it to
  packaging parity (TIN-2670).
- **mothership** consumed `@tummycrypt/*` twice, through a `workspace:*` pnpm
  path that gated production and a Bazel module graph that did not. That is the
  anti-dogfooding case: the graph and the shipped bytes could disagree. TIN-1721
  (PR #616) moves it to graph-link plus a rules_img production image, and
  TIN-2647 sequences the vendored-auth adoption that the version SSOT requires.

## Phased plan

The phases are ordered by risk retired per unit of work. P0 buys integrity;
P4 makes the whole thing self-defending.

### P0 - Integrity floor

Fix the version skew and stand up the producer parity gates so the version SSOT
(doctrine rule 1) is actually true at the producer, not merely asserted.

- **Auth version skew:** TIN-2647 sequences the mothership vendored-auth
  adoption (0.2.2 to 0.4.0 to 0.5.0) so the consumer stops disagreeing with the
  registry.
- **Producer parity gate (net-new): TIN-2668.** A producer-side check that
  fails closed when a module's Bazel version does not equal its `//:pkg`
  `npm_package` version and its `package.json` version, across the four
  critical-path producers (auth, fingerprint, otel, auth-pg). This is the
  recurrence guard: it prevents the next TIN-2647 from being authored at all.
  It is distinct from TIN-2483 (shared toolchain-preamble drift) and TIN-2227
  (consumer exact-pin); it guards the PRODUCER's emitted version.

### P1 - Template parity: scaffold image-context and MI packaging

Make the template lead and bring the strongest consumer up to packaging parity.

- **scaffold `container_image_context` (net-new): TIN-2669.** Turn the reserved
  comment into a real, optional, opt-in target with the correct cache-only tag
  pair and a matching target-class row in CI-SCHEMA section 4 and
  `lanes.schema.json`. Dormant by default (adapter-static remains the house
  default per the on-cluster-adapter-node-hosting decision, TIN-2544).
- **MI packaging parity (net-new): TIN-2670.** Add `rules_pkg`,
  `//:deployment_bundle`, and `//:container_image_context` to
  massage-ithaca-portal, adopting the reusable scaffold shape once TIN-2669
  lands. MI runs adapter-node in production, so it exercises both classes.

### P2 - Mothership graph-link keystone

Complete the move from `workspace:*` plus vendored packages to pure Bazel module
authority for the mothership, with a Bazel-built production image.

- **TIN-1721 (PR #616):** graph-link first-party `@tummycrypt/*` from promoted
  modules, repoint the production image to rules_img `//:image`/`//:push`, and
  gate `packages/*` deletion behind the content-diff safety gate.
- **TIN-2647:** the sequenced vendored-auth adoption that P2 depends on. This is
  the keystone: once the mothership is a clean Bazel consumer AND a Bazel-built
  image, the fleet's most complex app validates the whole doctrine.

### P3 - Close the loop: CD ships the Bazel bytes

Make the deployed bytes provably the packaged bytes.

- **Close-the-loop CD (net-new): TIN-2671.** Publish the `//:deployment_bundle`
  contents on static spokes and add a byte-identity gate asserting the deployed
  tree equals the Bazel bundle extraction (content hash), failing CD on drift.
  The post-TIN-2838 canonical-entrypoint patch closes the scaffold-side action
  gap: `just build` builds `//:build` and materializes its declared output for
  CD. This proves artifact provenance without claiming routine executor-backed
  RBE, which remains blocked under TIN-2851.
  Adapter-node/container spokes ship the image and are gated by
  `container_image_context` plus the rules_img authority in TIN-1721.

### P4 - Conformance enforcement

Turn the doctrine from prose into a gate every spoke inherits.

- **Conformance checks (net-new): TIN-2672.** Extend `scripts/check-conformance.sh`
  (surfaced through `just scaffold-doctor`) to assert the packaging tag shapes
  (deployment_bundle carries exactly `deployment-bundle-packaging` +
  `flywheel-eligible`; any `container_image_context` carries
  `gloriousflywheel-cache-only` + `no-remote-exec` and never `flywheel-eligible`)
  and to forbid `workspace:*` specifiers for `@tummycrypt/*` and vendored
  `@tummycrypt`/`packages/tinyland-*` producer trees in a consumer spoke. Rolled
  into the fleet conformance contract (TIN-1580) so every spoke inherits it, and
  following the substrate-boundary conformance precedent (TIN-2423).

## Ticket index

| Phase | Ticket | Scope |
|---|---|---|
| P0 | TIN-2647 (existing) | Mothership vendored-auth skew adoption 0.2.2 to 0.4.0 to 0.5.0 |
| P0 | [TIN-2668](https://linear.app/tinyland/issue/TIN-2668) (net-new) | Producer module-version vs npm_package-version parity gate |
| P1 | [TIN-2669](https://linear.app/tinyland/issue/TIN-2669) (net-new) | scaffold optional adapter-node `container_image_context` class |
| P1 | [TIN-2670](https://linear.app/tinyland/issue/TIN-2670) (net-new) | massage-ithaca-portal packaging parity |
| P2 | TIN-1721 / PR #616 (existing) | Mothership graph-link + rules_img production image |
| P3 | [TIN-2671](https://linear.app/tinyland/issue/TIN-2671) (net-new) | Close-the-loop CD, ship the Bazel bytes with byte-identity gate |
| P4 | [TIN-2672](https://linear.app/tinyland/issue/TIN-2672) (net-new) | Conformance: assert packaging tag shapes + forbid `workspace:*`/vendored `@tummycrypt` |

## Related prior work

- `docs/CI-SCHEMA.md` section 4: the Flywheel binding contract and proved-class
  allowlist.
- `docs/decisions/on-cluster-adapter-node-hosting.md` (TIN-2544): the
  MassageIthaca-proven adapter-node hosting shape the image context serves.
- TIN-1580: agent conformance script as fleet contract.
- TIN-2227 / TIN-982 / TIN-89: MassageIthaca consumer parity and the broader
  build/package/publish normalization across the shared stack.
- TIN-2483: fleet toolchain-preamble parity gate (a sibling drift class, not the
  producer version parity of TIN-2668).

## Cutover record: Bazel-only ingestion for site.scaffold (2026-07-14, TIN-2838)

Operator-ratified as a full single-PR cutover, propagating to every sister on
the next scaffold sync. This turns the P4/P3 doctrine above from prose into the
scaffold's actual default: the scaffold no longer runs an npm-shadow ingestion of
its four in-house packages, and its canonical build is Bazel-driven.

What changed:

- **Graph-link, not npm.** `BUILD.bazel` gained `npm_link_package` entries for
  all four packages — `@tummycrypt/vite-plugin-a11y`,
  `@tummycrypt/vite-plugin-skeleton-colors`, `@tummycrypt/tinyland-color-utils`,
  `@tummycrypt/tinyvectors` — each sourced from its registry module's `pkg`
  target and collected into a `TINYLAND_HOUSE_PACKAGES` list wired into every
  target that resolves them (build, svelte-check, eslint, vitest). Mirrors the
  mothership tinyland.dev root `BUILD.bazel`. `package.json` dropped the four
  specifiers (`pnpm-lock.yaml` regenerated to zero `@tummycrypt` references),
  which resolved the previously-unreconcilable 0.2.2-vs-0.2.3 plugin skew
  (public npm topped out at 0.2.2; the registry graph carries 0.2.3) — the skew
  simply no longer exists because npm is no longer a source.
- **tinyvectors pin bumped 0.3.0 -> 0.3.4** (mothership tinyland.dev's proven
  pin). Graph-linking the 0.3.0 `pkg` fails to build: its
  `:tinyvectors_declarations` producer target runs `tsc -p
  tsconfig.declarations.json` with a relative path that does not resolve from the
  external-repo action cwd under the Bazel sandbox (`TS5058: The specified path
  does not exist`). This is a pin selection of an already-published, fixed version
  — not an in-place edit of a shipped registry module — and matches the version
  the mothership already builds. The other three packages graph-link cleanly at
  their existing pins (color-utils 0.2.3, the two plugins 0.2.3).
- **Build resolves the org packages only from the Bazel graph.** `just build`
  invokes `bazel build //:build`; that action consumes direct
  `npm_link_package` labels and its declared output is transactionally
  materialized as `build/`. No first-party package is copied into package-manager
  `node_modules`, and `just setup` installs only third-party lockfile inputs.
- **Build metadata is declared.** `BASE_PATH` and commit identity are emitted by
  the workspace-status command and consumed through the stamped
  `js_run_binary` input. `//:analyze` has distinct declared output directories,
  so it does not create a second producer for `//:build` outputs.
- **Execution claim is bounded.** Canonical local/CI entrypoints are Bazel, but
  `tinyland.repo.json` stays `shared-cache-backed` and routine executor-backed
  RBE remains blocked under TIN-2851. Cache hits are not RBE evidence.
- **One third-party transitive dep surfaced.** `@tummycrypt/vite-plugin-a11y`'s
  `pkg` declares a runtime dep on `magic-string ^0.30.0` (peers `svelte`/`vite`
  are already present). When the plugin was an npm dep, pnpm pulled `magic-string`
  transitively; graph-linked, its `pkg` ships only `dist/`, so the consumer must
  provide `magic-string`. Added to `package.json` `devDependencies` (a third-party
  npm package, NOT an in-house one — the mothership lists it identically). The
  other three packages need no added deps.
- **Conformance item 13 reframed.** `scripts/check-inhouse-package-parity.py`
  moved from exact-version-parity to the Bazel-only invariant: NO org-package npm
  specifier may remain in `package.json`, AND every org package must be present
  as `bazel_dep` + `npm_link_package`. Green after the cutover.
- **Byte-identity probe retired.** TIN-2671's probe compared `//:deployment_bundle`
  against a second, independent pnpm/Vite `build/` to learn whether the two
  ingestion paths agreed before flipping CD. After this cutover there is no
  independent npm-sourced build to compare against — `just build` now executes
  `//:build` and materializes its declared output. The divergence the probe
  guarded can no longer occur. The script, recipe, and non-blocking CI job
  were removed; `docs/decisions/bazel-bundle-byte-identity-probe.md` is marked
  superseded. `//:deployment_bundle` / `just bundle` remain.
- **Out of scope (later, operator-gated):** npm-registry `deprecate` of the four
  retired specifiers. This PR does not touch npmjs.

Producer note: three of the four producers graph-link cleanly at their existing
pins; `tinyvectors` needed a pin bump to 0.3.4 (see above). No producer source was
edited — consumer-side wiring plus a version selection only.
