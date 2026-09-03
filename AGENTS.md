# Agent contract — Great Falls Tool Bus public microsite

## Role and authority

This private repository builds the public static site at
`greatfallstoolbus.org`. It owns reviewed public page copy, build-time `.svx`
daily logs, the static build graph, and a candidate OCI publisher.

It owns no member records, auth, payments, mail administration, private
content, DNS, Cloudflare state, cluster state, or GitOps apply authority. The
browser may submit the public contact form to the separately owned
`forms.latoolb.us` API. This repo neither implements nor administers that API.

The production image identity is exactly
`ghcr.io/great-falls-tool-bus/gftb-site`. Publishing a `sha-<40 hex SHA>` image
does not deploy it. Infra selection, digest pinning, apex cutover, served
readback, and rollback remain outside this repo.

## Public-content boundary

Public daily-log frontmatter is exactly:

- required: `date`, `title`, `summary`, `tags`, `published`
- optional: `updated`, plus the flat featured-image group `image`,
  `image_alt`, `image_caption`, `image_aspect` (src/lib/featured-image-schema.ts;
  the goals frontmatter carries the same group). `image` and `image_alt`
  travel together; `image` must be a site-relative `static/` path with a
  leak-scan-classified extension, and a `published: true` entry's image must
  resolve to a committed asset or the manifest build (and `just check`)
  fails. A draft's image may name its future `static/` path while the bytes
  wait in `src/content/log/_assets-pending/<slug>/`; draft alt/caption copy
  joins the leak-scan denylist.

Every file in `src/content/log/` is public build input. Entries render only
with `published: true`; a `published: false` file is an operator-pending
TODO(jess) draft (restoration addendum B1.2) that the loader excludes from
every rendered surface — a draft is still leak-scanned and is never a place
to park private text.

Never publish Linear IDs, PR numbers, commit SHAs, tracker pointers,
credentials, member information, private locations, or internal operational
notes. The public site must not expose agent indexes, JavaScript source maps,
developer docs, or private list archives. One repository pointer is
sanctioned (B1.2, demo #94): the SourceLink "Edit this page" affordance links
this repo's own page sources (`/edit/`, `/blob/`, the advisory form) through
the generated `src/lib/generated/source-map.json`, drift-gated by
`just source-map-check`; the repo's PR/issue/commit surfaces stay banned
(`scripts/lib/leak-scan-rules.json`). `discuss@latoolb.us` is the public discussion
list and archive; `keyholders@latoolb.us` is a private role list whose archive
is not public.

## Entrypoints and stack

- Use `just <recipe>` for every operation. Do not invoke pnpm, Vite, or Bazel
  directly outside the Justfile.
- Enter through `nix develop` / direnv. CI runs Just inside Nix.
- `just build` produces the adapter-static site under `build/` through Bazel,
  then leak-scans it (see below). A published tree that has never been scanned
  is not publishable.
- `just check` chains eleven repo gates — flywheel-enrollment-contract-check,
  secrets-scan-dir, endpoint-check, source-map-check, log-manifest-check,
  goals-manifest-check, entrypoint-contract, workflow-validate, qr-verify,
  conformance, leak-scan-stamped — then runs `//:local_validation_suite`
  (bazel-output contract, eslint, prettier, svelte-check, unit tests).
- `just conformance` validates the live minimal-spoke contract.
- `just qr-verify` cross-checks the pinned payload URL against
  `package.json`'s `homepage`, then regenerates the printed apex QR with the
  pinned qrencode invocation and byte-compares the committed SVG, stripping
  only the exact `<!-- Created with qrencode X.Y.Z ... -->` provenance
  comment so an encoder patch bump is not a false failure. Independent decode
  verification is a manual scan, per the recipe's failure guidance.
- CORRECTION (2026-09-03, operator ruling): the former `just qa-packet` /
  `qa-packet-diff` recipes and the PR `qa-look` CI job were excised. They were
  an evidence-packet capture pipeline (screenshot matrix + receipt uploaded as
  a CI artifact), not a LOOK — no routable QA environment ever existed in that
  flow. The name `qa-look` is reserved for the PullRequestEnvironment/v1
  consumer flow: a routable, tailnet-only, reapable, exact-head QA environment
  per pull request plus the operator LOOK ("the pr-N lane IS the QA
  evidence"). See `docs/qa-look.md`. The browser acceptance suite
  (`just test-e2e`, `preview-e2e`, `playwright.config.ts`, `e2e/`) is
  unaffected.
- `just leak-scan` runs the rules in `scripts/lib/leak-scan-rules.json` over a
  built artefact. `scripts/check-build-output.mjs` is a thin runner over
  `scripts/lib/leak-scan.mjs`, the same module `src/lib/leak-scan.test.ts`
  exercises: one implementation, tested once. It fails closed — a missing or
  empty directory, or a file whose extension is in neither `TEXT_EXTENSIONS`
  nor `SKIP_EXTENSIONS`, is a failure, not a pass. Set `GFTB_LEAK_SCAN_DENY`
  to add operator-held literals; never commit them.
- `scripts/lib/*` is acceptance-test-only and deliberately outside `src/lib`:
  the leak ruleset carries credential-detection regexes and must never be
  reachable from a client bundle. `eslint.config.ts` forbids `src/**` from
  importing it and `src/lib/leak-scan.test.ts` asserts the same from the other
  side.
- Skeleton and Skeleton Svelte are exact-pinned at `5.0.0`, following the
  proven Svelte 5 pattern in `jesssullivan.github.io`. Do not restore the
  Skeleton 4 compatibility shim.
- GloriousFlywheel is cache-first. Endpoints and credentials come only from
  the runtime environment. Do not create runners or hard-code cache/executor
  endpoints.
- Org ARC jobs use `tinyland-nix`; both reusable-workflow heavy and KVM inputs
  are explicitly mapped to that available class.

### Which CI job runs which gate

CI is `tinyland-inc/ci-templates/.github/workflows/spoke-ci.yml@v3.1.0`. Every
gate below is named with the job and line that executes it, so a gate can never
again be described as enforced when nothing runs it:

| Gate | spoke-ci.yml job | Line |
| --- | --- | --- |
| `just check` — conformance, endpoint, secrets, entrypoint, `qr-verify`, and `//:local_validation_suite` (which carries `//:unit_tests`, the acceptance unit gates) | `flywheel-test` | 291 |
| `just build` — Bazel static build, then `just leak-scan build` | `flywheel-build` | 267 |
| `just build` again, transitively, as the Playwright web server | `playwright` | 375 |
| `just test-e2e` — the browser acceptance suite | `playwright` | 375 |
| `bazelisk mod graph`, `bazelisk build //:node_modules` | `bazel-graph` | 307, 311 |
| gitleaks over full history | `secrets-scan` | 115 |

`just ci` is a local convenience aggregate. **No template job invokes it**, so
nothing may be enforced only from there.

## Deployment and package safety

`.github/workflows/container-ghcr.yml` may publish only the immutable candidate
tag for its exact commit. It has no production dispatch and no infra, DNS, or
edge credentials. GitHub Pages workflows are forbidden. A merge, green CI, or
successful package push is not served-site proof.

Source stays private. The operator release lane may make only the reviewed web
image package public after publication, then must prove anonymous manifest and
digest pull. Do not add registry credentials or image-pull secrets here.

## Delete-after-rewire policy

The repository tip contains only live carriers. When a path becomes obsolete:

1. Map every reference from AGENTS, Just, CI, Bazel, skills, schemas, tests,
   licenses, and deployment contracts.
2. Rewire those live consumers to the chosen replacement.
3. Delete the superseded Markdown, script, generated copy, JSON, fixture, and
   workflow in the same change. Git history is the recovery mechanism.
4. Run `just source-map-check`, `just endpoint-check`, `just secrets-scan-dir`,
   `just conformance`, `just check`, and `just build` before landing.

Do not keep historical evidence directories, research notes, examples, public
agent artifacts, or unused scaffolding “just in case.” Do not delete a schema
or script while any live entrypoint still references it.

## Multi-agent and git posture

- One lead session holds merge authority. Other sessions may open PRs but do
  not merge or close work owned by another session.
- Sync and scan open PRs before starting a lane. File fences win.
- Preserve unrelated dirty worktree changes.
- Use signed commits; never add AI attribution.
- This repo stays private until an explicit visibility decision.

## Licenses and assets

Software is zlib-licensed; written GFTB content is CC BY-SA 4.0. Visual and
vendored-code provenance lives in `NOTICE` and `docs/attribution.md`.

## GFTB SSOT grounding (binding; pointers only — content lives at each SSOT)

Ground every change in these authorities and cite the specific section/ticket
in the PR's Authority table. Reviews check citation-conformance first.
Decisions are decided-by-default: search these before writing "open question".

- meta `Great-Falls-Tool-Bus/meta` @ origin/main (ALWAYS fetch; stale local
  checkouts have produced false not-founds):
  - `spec/launch-member-v0-system-2026-08-16.md` — the contract (public site
    §3, forms §10).
  - `decisions/0014`, `decisions/0015` — ratified ADRs.
  - `spec/gftb-citylink-palette-2026-08-17.md` + `spec/gftb-citylink-palette/`
    — palette: Appendix A = numbers; `gen_board.py` role table = application;
    parity disagreement with `src/lib/theme/palette.ts` = stop condition.
  - `diagrams/launch-member-v0/*.mmd` — the design ontology.
- Demo site = design decisions in code: `greatfallstoolbus.org` repo @ main —
  commits #87, #90, #94; `src/lib/motion.svelte.ts`, `src/lib/nav-items.ts`,
  `src/app.css`, `src/lib/data/cells.ts`, `src/routes/contact/`. Port, never
  reinvent. CORRECTION (2026-09-03): `src/lib/data/cells.ts` and
  `src/routes/contact/` no longer exist on that repo's main (deleted in its
  commit 23d9513); this repo's own `src/routes/contact/` and its tests are now
  the contact-surface truth. The three surviving pointers stand.
- Linear: initiative "Great Falls Tool Bus — Launch" + document "GFTB launch
  operating map" (milestone spine, SLAs, WIP rule live THERE). Read issue
  descriptions AND comment threads.
- `site.scaffold` = machinery only, never GFTB design authority.
- Standing operator rulings (each recorded in meta/Linear; one line here as a
  tripwire): bus permanently parked; vocabulary application/intake (never
  enrollment/ingest/catalog/steward); Maine/TIN-3905 operator-only; forms
  always PoW-gated on their own page; agent-drafted copy ships only as
  `published: false` TODO drafts.
