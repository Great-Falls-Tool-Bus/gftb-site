# Operating rules

These rules bind every change to this repository, whoever makes it. How to
contribute (fork, signed commits, hooks, gate receipt) is in
[CONTRIBUTING.md](../CONTRIBUTING.md).

## Role and authority

This public repository builds the public static site at
`greatfallstoolbus.org`. It owns reviewed public page copy, build-time `.svx`
daily logs, the static build graph, and a candidate OCI publisher.

The source is public under the 2026-09-09 operator ruling, which supersedes
the earlier instruction to keep `gftb-site` private. Internal tooling, member
data, private mail, and private list archives stay outside this repository.

It owns no member records, auth, payments, mail administration, private
content, DNS, Cloudflare state, cluster state, or GitOps apply authority. The
browser may submit the public contact form and the work session RSVP dialog
to the separately owned `forms.latoolb.us` API (the RSVP since operator
interview 2026-10-02: it posts to `/api/contact` as a contact message whose
name starts with `RSVP ` and whose message carries `Slot: <id>`; no
acknowledgement is sent). This repo neither implements nor administers that
API.

The production image identity is exactly
`ghcr.io/great-falls-tool-bus/gftb-site`. Publishing a `sha-<40 hex SHA>` image
does not deploy it. Infra selection, digest pinning, apex cutover, served
readback, and rollback stay outside this repo: the attended release is the
`web-release-*` recipes of `great-falls-tool-bus-infra`, run from a clean
checkout of that repo's `main`.

## Public-content boundary

Public daily-log frontmatter is exactly:

- required: `date`, `title`, `summary`, `tags`, `published`
- optional: `updated`, plus the flat featured-image group `image`,
  `image_alt`, `image_caption`, `image_aspect`
  (`src/lib/featured-image-schema.ts`; the goals frontmatter carries the same
  group). `image` and `image_alt` travel together; `image` must be a
  site-relative `static/` path with a leak-scan-classified extension, and a
  `published: true` entry's image must resolve to a committed asset or the
  manifest build (and `just check`) fails. A draft's image may name its future
  `static/` path while the bytes wait in
  `src/content/log/_assets-pending/<slug>/`; draft alt and caption copy joins
  the leak-scan denylist.

Every file in `src/content/log/` is public build input. Entries render only
with `published: true`; a `published: false` file is a draft awaiting
operator review that the loader excludes from every rendered surface. Files
and pull requests on this public repository are readable, including draft PRs
and `published: false` entries. Draft states do not make source private. A
draft is still leak-scanned and is never a place to park private text.
Drafted copy from automated tools ships only as a `published: false` draft.

Never publish tracker IDs, PR numbers, commit SHAs, tracker pointers,
credentials, member information, private locations, or internal operational
notes. The public site must not expose agent indexes, JavaScript source maps,
developer docs, or private list archives. One repository pointer is
sanctioned: the SourceLink "Edit this page" affordance links this repo's own
page sources (`/edit/`, `/blob/`, the advisory form) through the generated
`src/lib/generated/source-map.json`, drift-gated by `just source-map-check`,
and the home Notes & Goals surface extends the same exception to per-row
`/edit/` links and the `/tree/` collection link (operator ruling 2026-09-08).
The repo's PR, issue and commit surfaces stay banned
(`scripts/lib/leak-scan-rules.json`). `discuss@latoolb.us` is the public
discussion list and archive; `keyholders@latoolb.us` is a private role list
whose archive is not public.

## Entrypoints and stack

- Use `just <recipe>` for every operation. Do not invoke pnpm, Vite, or Bazel
  directly outside the Justfile. Enter through `nix develop` or direnv.
- `just setup` installs dependencies and the shared git hooks.
- `just build` materializes `//:scanned_build`: the adapter-static `//:build`
  output copied and leak-scanned inside one Bazel action. A scan failure
  yields no declared output, and `//:deployment_bundle` can package only that
  scanned tree. A published tree that has never been scanned is not
  publishable.
- `just check` also builds `//:scanned_build`, so the leak scan over the
  publishable tree is part of the merge gate (operator ruling 2026-10-02).
- `just check` runs the cacheable `//:ci_validation_suite`: the
  schema/conformance contract, current-source Gitleaks, generated
  source/log/goal manifest drift checks, hermetic actionlint, ESLint,
  Prettier, Svelte checks, unit tests, and Chromium acceptance specs over the
  declared static build, plus a byte comparison of `.githooks/` against the
  organization copy. The browser target needs a provisioned Chromium; it never
  installs a browser or attaches to an ambient preview. A passing browser
  target is not a deployed look at the site. The suite also carries the
  served-artifact proof for the tinyvectors pin
  (`//:served_tinyvectors_test`): `MODULE.bazel` is the package's only
  resolution, and output from an off-graph `vite build` is never evidence.
- No GitHub Actions workflow runs on push or pull request (operator ruling
  2026-09-28). The pre-merge gate is a `just check` receipt from a Linux lab
  host, posted on the PR. `just ci` is a local convenience, not CI evidence.
- `just conformance` enters the registered `//:bazel_output_contract_test`.
- `just qr-verify` cross-checks the pinned payload URL against
  `package.json`'s `homepage`, then regenerates the printed apex QR with the
  pinned qrencode invocation and byte-compares the committed SVG, stripping
  only the qrencode provenance comment.
- `just leak-scan` runs the rules in `scripts/lib/leak-scan-rules.json` over a
  built artefact through `scripts/lib/leak-scan.mjs`, the same module
  `src/lib/leak-scan.test.ts` exercises. It fails closed: a missing or empty
  directory, or a file whose extension is in neither `TEXT_EXTENSIONS` nor
  `SKIP_EXTENSIONS`, is a failure. Set `GFTB_LEAK_SCAN_DENY` to add
  operator-held literals; never commit them.
- `PUBLIC_TAILNET_PROBE_URL` (the footer button's tailnet probe) ships in the
  public bundle; it is a name, not a secret. Operator ruling 2026-10-05
  ("Set, gated by a footer button that opens a modal to ask for permission
  using the skeleton v5 pattern") sets it to
  `https://gftb-probe.taila4c78d.ts.net/v1/tailnet`: that is the Justfile's
  default for the variable and the publish workflow's fallback when the
  repository variable is unset. The site never probes on page load; only the
  modal's own button does. The stamping below is unchanged, and a caller that
  exports a different value (or an empty one) overrides the default:
  `scripts/bazel/workspace-status.sh` validates it (under `LC_ALL=C`, so
  `[a-z]` is ASCII only) as exactly `https://<node>.<tailnet>.ts.net/<path>`
  and stamps it as `STABLE_BUILD_TAILNET_PROBE_URL`; the Vite build reads it
  from that stamp through `scripts/bazel/build-metadata.mjs`, and
  `//:scanned_build` (also stamped, same reader) allows exactly that one host
  and no other tailnet name or private address. Unset, the build names no
  tailnet host. The publish workflow passes the repository variable of the
  same name. A malformed exported value is never echoed or stamped: the
  status command (which runs on every `bazel build` and `bazel test`) prints a
  warning and stamps `__INVALID__`, so unrelated targets keep working while
  `//:build` and `//:scanned_build` fail until the value is fixed or unset. A
  direct `just leak-scan` reads the caller's variable instead of a stamp and,
  when it finds a tailnet name, says the tree may have been built with a
  different value. The 2026-10-03 "Verify live first" hold on setting the
  variable is superseded by the 2026-10-05 ruling above.
- `scripts/lib/*` is acceptance-test-only and deliberately outside `src/lib`:
  the leak ruleset carries credential-detection regexes and must never be
  reachable from a client bundle. `eslint.config.ts` forbids `src/**` from
  importing it and `src/lib/leak-scan.test.ts` asserts the same from the other
  side.
- Skeleton and Skeleton Svelte are exact-pinned at `5.0.1`. Do not restore the
  Skeleton 4 compatibility shim.
- `.github/lanes.json` is the source-only ActionPlan/v4 schema-3 plan: finite
  Bazel targets, one abstract REAPI capability demand, and one closed result
  disposition per action. `validate` requests `test //:ci_validation_suite`;
  `site-build` requests `build //:deployment_bundle`, which depends on
  `//:scanned_build`, never directly on `//:build`.
- `tinyland.repo.json` is the schema-v2 consumer instance. The house schema in
  `docs/schemas/tinyland-repo-manifest.v2.schema.json` is vendored
  byte-for-byte from the signed `site.scaffold` schema at commit
  `0abc7f9e93bf4b84c7550684c38fbf822eab7cd0`, SHA-256
  `9f60d0934e23f1f2437faade24630249b77c303b00d92cf372d1a4fc5252d83c`. It
  contains no execution pool, binding state, provider, runner, endpoint,
  placement, or fallback field.

## Home presentation layer

Three enhancement layers sit on the home page, all additive over served HTML
that is complete without them.

- The Notes & Goals windshield wiper (`src/lib/wiper/**` and
  `src/lib/components/{NotesAndGoals,WiperScene,WiperControls}.svelte`) runs
  a GPU ladder `webgpu -> webgl2 -> none`, where `none` is the plain grid.
  Every rung is silent (no console output from a renderer). Reduced motion,
  scripts off, paper and forced colours all render the plain grid of every
  row, which is the rollback surface. Nothing about the wiper is stored.
  Contract pins live in `src/lib/wiper/contract.test.ts`; browser rows in
  `e2e/home-goals.spec.ts` and `e2e/wiper-parity.spec.ts`.
- The work sessions band (`src/lib/components/HoursBand.svelte`,
  `src/lib/hours-{band,format}.ts`; operator interview 2026-10-02) sits
  beneath the hero. Its served HTML is clock-free rule text or the empty
  state; after mount the rows are dated on the visitor's clock and become a
  carousel under 48rem or a right-hand loop at 48rem and up that pauses on
  hover, on focus and by its own button. Reduced motion, forced colours, a
  short list and scripts off all render the static list, and the band clips
  its own overflow. Rows in `e2e/home-hours.spec.ts`. Its RSVP button opens
  the one RSVP dialog (`src/lib/components/RsvpDialog.svelte`,
  `src/lib/rsvp-form.ts`), which posts through the contact relay, falls back
  to a mailto RSVP when the relay cannot be reached, remembers a sent slot in
  memory only and returns focus to the button. Rows in
  `e2e/home-rsvp.spec.ts`. The three forms share one ALTCHA loader,
  `src/lib/altcha-loader.ts`.
- The first-load intro (`src/lib/intro/**`,
  `src/lib/components/{HomeIntro,BusMark}.svelte`, the sync script in
  `src/app.html`, the "Home intro" block in `src/app.css`) lands the work
  sessions band under the header once the Notes & Goals canvases are ready,
  and uses no storage.
  Any input, a hidden tab, a URL fragment, reduced motion, forced colours, or
  any scroll that is not its own cancels it; focus is never moved. Pins in
  `src/lib/intro/contract.test.ts`; rows in `e2e/home-intro.spec.ts`.

### Test hooks

Read from `<html>` (no URL query, no storage):
`data-wiper-tier-max="webgl2|none"` caps the ladder before mount;
`data-intro-off` (or `window.__gftbIntroOff = true` before the sync script
runs) keeps the intro from arming; `data-subscribe-capture-dwell-ms="<n>"`
credits the list-signup capture modal's dwell (n=0 arms it as soon as the
hero is scrolled past) and is read only by that component, which exists only
on a build made with `PUBLIC_SUBSCRIBE_CAPTURE=1` (default off, rehearsal
only). The component publishes its arm decision on
`<html data-subscribe-capture>`. Specs whose scroll-position premises the
intro would break opt out through `e2e/support/intro.ts`.
`window.__gftbHoursFixture`, set before the bundle mounts, stands in for the
published work-session slots after mount; every entry must pass the content
schema and be published, or the band ignores the fixture. The band publishes
its shape on `#hours[data-hours-mode]`.

## Deployment and package safety

`.github/workflows/container-ghcr.yml` may publish only the immutable
candidate tag for its exact commit, by attended dispatch only. It has no
production dispatch and no infra, DNS, or edge credentials. GitHub Pages
workflows are forbidden. A merge, a green gate, or a successful package push
is not proof of what the site serves. The image writes `/health.sha` at
packaging time from the exact `BUILD_COMMIT_SHA`; served readback must equal
the expected 40-character SHA. It also serves `/health` and `/healthz`
(`200`, body `ok`).

Public source does not establish image-package visibility or pullability. The
release lane may make only the reviewed web image package public after
publication, then must prove anonymous manifest and digest pull. Do not add
registry credentials or image-pull secrets here.

## Delete after rewire

The repository tip contains only live carriers. When a path becomes obsolete:

1. Map every reference from docs, Just, Bazel, schemas, tests, licenses, and
   deployment contracts.
2. Rewire those live consumers to the chosen replacement.
3. Delete the superseded Markdown, script, generated copy, JSON, fixture, and
   workflow in the same change. Git history is the recovery mechanism.
4. Run `just source-map-check`, `just endpoint-check`, `just secrets-scan-dir`,
   `just conformance`, `just check`, and `just build` before landing.

Do not keep historical evidence directories, research notes, examples,
agent artifacts, or unused scaffolding "just in case". Do not delete a schema
or script while any live entrypoint still references it.

## Licenses and assets

Software is zlib-licensed; written GFTB content is CC BY-SA 4.0. Visual and
vendored-code provenance lives in `NOTICE` and `docs/attribution.md`.
